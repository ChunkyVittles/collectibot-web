"""
splitter.py — Split landscape comic scans into two portrait halves,
deskew, auto-crop, and add a clean white border.

If an image is landscape (wider than tall), it contains two comics side by side.
Split at the 50% width mark into left (a) and right (b) halves.
Portrait images are left untouched.

All output images are deskewed, cropped tight, and given a 1/2-inch white border.
"""

import logging
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps

log = logging.getLogger("splitter")

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}

CONTENT_THRESHOLD = 245  # Pixels brighter than this are "white/background"
BORDER_INCHES = 0.10     # White border to add on all sides
SCAN_DPI = 300           # Assumed scanner DPI
CENTER_GAP_THRESHOLD = 0.30   # >30% of center columns must be empty to detect two comics


SCANNER_STRIP_PX = 50  # Pixels to chop off top of every scan (damaged scanner housing)
SCANNER_RIGHT_STRIP_PCT = 0.03  # Fraction of width to chop off right side (scanner edge artifact)


def strip_scanner_artifact(img: Image.Image) -> Image.Image:
    """Remove known scanner artifacts and any dark edge pixels.

    1. Chop top 50px (damaged scanner housing) and right 3% (edge artifact).
    2. Then flood-fill inward from all four edges, removing any dark pixels
       until we hit clean white. This catches scanner bed shadows, dark strips,
       and any other edge noise before further processing.
    """
    w, h = img.size
    top = SCANNER_STRIP_PX if h > SCANNER_STRIP_PX else 0
    right_strip = int(w * SCANNER_RIGHT_STRIP_PCT)
    right = w - right_strip if right_strip > 0 else w
    img = img.crop((0, top, right, h))

    # Now remove any remaining dark edge pixels on all sides
    gray = np.array(ImageOps.grayscale(img))
    gh, gw = gray.shape

    # For each edge, scan inward and replace dark pixels with white
    # until we hit a mostly-white row/column (mean brightness > 240)
    white_threshold = 240
    max_strip = int(min(gw, gh) * 0.05)  # Never strip more than 5% per edge

    # Top
    top_strip = 0
    for r in range(min(max_strip, gh)):
        if np.mean(gray[r, :]) < white_threshold:
            top_strip = r + 1
        else:
            break

    # Bottom
    bottom_strip = 0
    for r in range(gh - 1, max(gh - max_strip, 0), -1):
        if np.mean(gray[r, :]) < white_threshold:
            bottom_strip = gh - r
        else:
            break

    # Left
    left_strip = 0
    for c in range(min(max_strip, gw)):
        if np.mean(gray[:, c]) < white_threshold:
            left_strip = c + 1
        else:
            break

    # Right
    right_strip = 0
    for c in range(gw - 1, max(gw - max_strip, 0), -1):
        if np.mean(gray[:, c]) < white_threshold:
            right_strip = gw - c
        else:
            break

    if top_strip or bottom_strip or left_strip or right_strip:
        new_w, new_h = img.size
        img = img.crop((
            left_strip,
            top_strip,
            new_w - right_strip,
            new_h - bottom_strip,
        ))
        log.info(
            f"  Dark edge strip: top={top_strip} bottom={bottom_strip} "
            f"left={left_strip} right={right_strip}"
        )

    return img


def _find_edge_angle(gray, edge="top"):
    """
    Find the angle of a book edge by tracing the boundary between white scanner
    background and the comic book.

    For 'top': scan each column top-down, find first content pixel → fit line.
    For 'left': scan each row left-to-right, find first content pixel → fit line.

    Uses aggressive outlier removal: first pass finds the rough edge with median
    filtering, second pass uses RANSAC-style inlier selection to ignore artwork
    that protrudes beyond the book edge.

    Returns (angle_degrees, num_points) or None.
    """
    h, w = gray.shape

    if edge == "top":
        # For each column, find the topmost non-white pixel
        first_pixels = []
        for col in range(0, w, 2):
            col_data = gray[:, col]
            hits = np.where(col_data < CONTENT_THRESHOLD)[0]
            if len(hits) > 0:
                first_pixels.append((col, hits[0]))

        if len(first_pixels) < 50:
            return None

        xs = np.array([p[0] for p in first_pixels], dtype=np.float64)
        ys = np.array([p[1] for p in first_pixels], dtype=np.float64)

        # The top edge of the book is the HIGHEST (smallest y) consistent line.
        # Artwork sticking up above the edge is rare; shadows/noise below are common.
        # Pass 1: remove points far from the median
        median_y = np.median(ys)
        mad = np.median(np.abs(ys - median_y))
        keep = np.abs(ys - median_y) < max(mad * 2, 30)
        xs, ys = xs[keep], ys[keep]

        if len(xs) < 30:
            return None

        # Pass 2: fit line, remove outliers, refit
        m, b = np.polyfit(xs, ys, 1)
        predicted = m * xs + b
        residuals = np.abs(ys - predicted)
        keep = residuals < np.percentile(residuals, 75)
        xs, ys = xs[keep], ys[keep]

        if len(xs) < 20:
            return None

        m, b = np.polyfit(xs, ys, 1)
        angle = np.degrees(np.arctan(m))
        return angle, len(xs)

    elif edge == "left":
        # For each row, find the leftmost non-white pixel
        first_pixels = []
        for row in range(0, h, 2):
            row_data = gray[row, :]
            hits = np.where(row_data < CONTENT_THRESHOLD)[0]
            if len(hits) > 0:
                first_pixels.append((hits[0], row))

        if len(first_pixels) < 50:
            return None

        xs = np.array([p[0] for p in first_pixels], dtype=np.float64)
        ys = np.array([p[1] for p in first_pixels], dtype=np.float64)

        # Pass 1: the left edge is the LEFTMOST (smallest x) consistent line.
        # Artwork protruding left of the book spine is the main noise source.
        # Use the median x as baseline — points far left of it are protruding art.
        median_x = np.median(xs)
        mad = np.median(np.abs(xs - median_x))
        # Keep points near the median, but bias toward LARGER x values
        # (protruding artwork goes LEFT of the spine = smaller x = outlier)
        keep = (xs > median_x - max(mad * 1.5, 15)) & (xs < median_x + max(mad * 3, 30))
        xs, ys = xs[keep], ys[keep]

        if len(ys) < 30:
            return None

        # Pass 2: fit line, remove outliers, refit
        m, b = np.polyfit(ys, xs, 1)
        predicted = m * ys + b
        residuals = np.abs(xs - predicted)
        keep = residuals < np.percentile(residuals, 70)
        xs, ys = xs[keep], ys[keep]

        if len(ys) < 20:
            return None

        m, b = np.polyfit(ys, xs, 1)
        # Negate: when book rotates clockwise, top edge has positive slope
        # but left edge x-vs-y regression also has positive slope — same direction,
        # so negate to match the top edge's sign convention
        angle = -np.degrees(np.arctan(m))
        return angle, len(ys)

    return None


def deskew(img: Image.Image) -> Image.Image:
    """
    Detect rotation angle from the top and left edges of the comic book.
    Traces the first non-white pixel along each edge and fits a line.
    Top edge → deviation from horizontal. Left edge → deviation from vertical.
    If both are found, average them. If only one, use that.
    """
    gray = np.array(ImageOps.grayscale(img))
    h, w = gray.shape

    # Bail if image is mostly empty
    content_pixels = np.sum(gray < CONTENT_THRESHOLD)
    if content_pixels < 1000:
        return img

    # Detect top edge angle
    top_result = _find_edge_angle(gray, edge="top")

    # Detect left edge angle
    left_result = _find_edge_angle(gray, edge="left")

    top_angle = top_result[0] if top_result else None
    left_angle = left_result[0] if left_result else None

    if top_angle is not None:
        log.info(f"  Deskew: top edge = {top_angle:.1f}° ({top_result[1]} points)")
    if left_angle is not None:
        log.info(f"  Deskew: left edge = {left_angle:.1f}° ({left_result[1]} points)")

    # Combine: average if both found, otherwise use whichever we have
    if top_angle is not None and left_angle is not None:
        angle = (top_angle + left_angle) / 2
        log.info(f"  Deskew: averaged = {angle:.1f}°")
    elif top_angle is not None:
        angle = top_angle
    elif left_angle is not None:
        angle = left_angle
    else:
        log.info("  Deskew: no edges detected, skipping")
        return img

    # Only rotate if meaningful but not extreme
    if abs(angle) < 0.1 or abs(angle) > 20:
        log.info(f"  Deskew: angle {angle:.1f}° outside range, skipping")
        return img

    log.info(f"  Deskew: rotating {angle:.1f}°")

    rotated = img.rotate(
        angle,
        expand=True,
        fillcolor=(255, 255, 255),
        resample=Image.BICUBIC,
    )

    return rotated


def _find_content_block(density: np.ndarray) -> tuple[int, int]:
    """
    Find the main content block, ignoring thin isolated bands (scanner shadows).

    Strategy: find contiguous runs of active pixels (>5% density), then pick
    the longest run. Scanner shadows are thin (10-30px) while the actual comic
    spans hundreds of pixels.
    """
    min_density = 0.05
    n = len(density)

    # Find contiguous runs of active content
    runs = []
    in_run = False
    run_start = 0

    for i in range(n):
        if density[i] > min_density:
            if not in_run:
                run_start = i
                in_run = True
        else:
            if in_run:
                runs.append((run_start, i))
                in_run = False
    if in_run:
        runs.append((run_start, n))

    if not runs:
        return 0, n

    # Pick the longest run — that's the actual comic content
    longest = max(runs, key=lambda r: r[1] - r[0])
    return longest


def _gradient_edge_detection(gray: np.ndarray) -> tuple[int, int, int, int] | None:
    """
    Find the comic's physical edge using gradient magnitude.

    On a flatbed scanner, the comic's thickness creates a subtle shadow line
    at its edges. This shows up as a strong gradient even when both the comic
    and scanner bed are white.

    Returns (top, bottom, left, right) crop coordinates, or None if no clear edges found.
    """
    h, w = gray.shape

    # Compute Sobel gradients
    grad_x = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)

    abs_grad_x = np.abs(grad_x)
    abs_grad_y = np.abs(grad_y)

    # For horizontal edges (top/bottom): look at vertical gradient strength per row
    row_grad = np.mean(abs_grad_y, axis=1)
    # For vertical edges (left/right): look at horizontal gradient strength per column
    col_grad = np.mean(abs_grad_x, axis=0)

    # Threshold: a strong edge line has much higher gradient than background noise
    row_threshold = np.percentile(row_grad, 85)
    col_threshold = np.percentile(col_grad, 85)

    # Find top edge: first strong horizontal gradient line in top 30%
    top = 0
    for r in range(int(h * 0.30)):
        if row_grad[r] > row_threshold:
            top = r
            break

    # Find bottom edge: last strong horizontal gradient line in bottom 30%
    bottom = h
    for r in range(h - 1, int(h * 0.70), -1):
        if row_grad[r] > row_threshold:
            bottom = r + 1
            break

    # Find left edge: first strong vertical gradient line in left 30%
    left = 0
    for c in range(int(w * 0.30)):
        if col_grad[c] > col_threshold:
            left = c
            break

    # Find right edge: last strong vertical gradient line in right 30%
    right = w
    for c in range(w - 1, int(w * 0.70), -1):
        if col_grad[c] > col_threshold:
            right = c + 1
            break

    # Validate: the detected area should be at least 50% of image in both dimensions
    if (right - left) < w * 0.5 or (bottom - top) < h * 0.5:
        return None

    return top, bottom, left, right


def _strip_edge_artifacts(gray: np.ndarray, content: np.ndarray) -> tuple[int, int, int, int]:
    """
    Find crop bounds by identifying the main content block in each axis.

    Scanner shadows create thin isolated bands of low density at image edges.
    We find the longest contiguous run of content rows/cols — that's the comic.
    Thin edge strips and shadows are ignored because they're much shorter.

    For mostly-white images (e.g. white back covers), content density fails
    because the comic's white merges with the scanner bed's white. In that case,
    fall back to gradient-based edge detection which finds the physical shadow
    at the comic's edge.

    Returns (top, bottom, left, right) crop coordinates.
    """
    h, w = gray.shape
    row_density = np.mean(content, axis=1)
    col_density = np.mean(content, axis=0)

    top, bottom = _find_content_block(row_density)
    left, right = _find_content_block(col_density)

    # Check if content-based crop basically failed (covers >90% of image = no real edges found)
    content_fraction = np.mean(content)
    crop_w_frac = (right - left) / w
    crop_h_frac = (bottom - top) / h

    if content_fraction < 0.08 and (crop_w_frac > 0.90 or crop_h_frac > 0.90):
        # Mostly white image — content threshold couldn't find edges
        log.info(f"  Low content ({content_fraction:.1%}), trying gradient edge detection")
        grad_bounds = _gradient_edge_detection(gray)
        if grad_bounds:
            g_top, g_bottom, g_left, g_right = grad_bounds
            log.info(
                f"  Gradient edges: top={g_top} bottom={g_bottom} "
                f"left={g_left} right={g_right}"
            )
            return g_top, g_bottom, g_left, g_right

    return top, bottom, left, right


def crop_to_content(img: Image.Image) -> Image.Image:
    """
    Deskew, crop tightly, then add a clean white border.
    Note: scanner artifact stripping is done once upfront by strip_all_in_directory,
    NOT here — otherwise split halves get double-stripped.
    """
    img = deskew(img)

    gray = np.array(ImageOps.grayscale(img))
    h, w = gray.shape
    content = gray < CONTENT_THRESHOLD

    top, bottom, left, right = _strip_edge_artifacts(gray, content)

    if right <= left or bottom <= top:
        return img

    # Crop tight to content (no padding)
    cropped = img.crop((left, top, right, bottom))

    # Add clean white border
    border_px = int(BORDER_INCHES * SCAN_DPI)
    result = ImageOps.expand(cropped, border=border_px, fill="white")

    return result


def split_if_landscape(image_path: Path) -> list[Path]:
    """
    Check orientation. If landscape, split into two halves.
    All output images are deskewed, cropped, and bordered.
    Returns list of resulting file paths (1 if portrait, 2 if landscape split).
    """
    if image_path.suffix.lower() not in IMAGE_EXTS:
        return [image_path]

    try:
        img = Image.open(image_path)
    except Exception as e:
        log.error(f"Cannot open {image_path.name}: {e}")
        return [image_path]

    width, height = img.size

    # Portrait or square — deskew + crop in place
    if width <= height:
        cropped = crop_to_content(img)
        if cropped.size != img.size:
            cropped.save(image_path, quality=95)
            log.info(f"Processed {image_path.name}: {width}x{height} → {cropped.width}x{cropped.height}")
        cropped.close()
        img.close()
        return [image_path]

    # Landscape — is this one comic or two side by side?
    # Strategy: look for a clear white GAP near the center of the image.
    # Two side-by-side comics will have a valley of low content density between them.
    # A single crooked comic will have continuous content across the center.
    gray_arr = np.array(ImageOps.grayscale(img))
    content_mask = gray_arr < CONTENT_THRESHOLD
    col_density = np.mean(content_mask, axis=0)  # fraction of content per column

    # Check the center 20% of the image for a gap between two comics
    center_start = int(width * 0.40)
    center_end = int(width * 0.60)
    center_density = col_density[center_start:center_end]

    # A gap means columns in the center zone have very little content (<2% of rows)
    gap_cols = np.sum(center_density < 0.02)
    gap_fraction = gap_cols / len(center_density)

    # Also find the minimum density in the center zone
    min_center_density = np.min(center_density) if len(center_density) > 0 else 1.0

    log.info(
        f"{image_path.name}: center gap: {gap_fraction:.0%} of center cols are empty, "
        f"min center density: {min_center_density:.3f}"
    )

    # Two comics: the key signal is a near-zero density column in the center.
    # If min density is essentially 0, even a narrow gap (>5%) means two books.
    # For noisier gaps, require a wider empty zone.
    is_two_comics = (min_center_density < 0.01 and gap_fraction > 0.05) or \
                    (min_center_density < 0.03 and gap_fraction > 0.30)

    if not is_two_comics:
        # Single comic — just deskew and crop the whole image
        log.info(f"Single comic in landscape scan {image_path.name}")
        cropped = crop_to_content(img)
        cropped.save(image_path, quality=95)
        log.info(f"Processed {image_path.name}: {width}x{height} → {cropped.width}x{cropped.height}")
        cropped.close()
        img.close()
        return [image_path]

    # Two comics — find the gap center and split there (not just width/2)
    # The gap is where column density is lowest in the center zone
    gap_region = col_density[center_start:center_end]
    gap_center_offset = np.argmin(gap_region)
    mid = center_start + gap_center_offset
    log.info(f"  Split point: column {mid} (gap center)")
    stem = image_path.stem
    ext = image_path.suffix

    # Insert 'a' and 'b' before the front/back suffix (last char: 1 or 2)
    if stem[-1] in ("1", "2"):
        base = stem[:-1]
        suffix_char = stem[-1]
        left_name = f"{base}a{suffix_char}{ext}"
        right_name = f"{base}b{suffix_char}{ext}"
    else:
        left_name = f"{stem}a{ext}"
        right_name = f"{stem}b{ext}"

    left_path = image_path.parent / left_name
    right_path = image_path.parent / right_name

    # Split, deskew, crop, and border each half
    left_img = crop_to_content(img.crop((0, 0, mid, height)))
    left_img.save(left_path, quality=95)

    right_img = crop_to_content(img.crop((mid, 0, width, height)))
    right_img.save(right_path, quality=95)

    log.info(
        f"Split {image_path.name} ({width}x{height}) → "
        f"{left_name} ({left_img.width}x{left_img.height}) + "
        f"{right_name} ({right_img.width}x{right_img.height})"
    )

    left_img.close()
    right_img.close()
    img.close()

    # Delete the original
    image_path.unlink()

    return [left_path, right_path]


def strip_all_in_directory(directory: Path):
    """Strip top 50px and right 10% from every image file in directory, overwriting in place."""
    for f in sorted(directory.iterdir()):
        if f.suffix.lower() in IMAGE_EXTS:
            img = Image.open(f)
            cropped = strip_scanner_artifact(img)
            if cropped.size != img.size:
                cropped.save(f, quality=95)
                log.info(f"Stripped scanner artifacts from {f.name}")
                cropped.close()
            img.close()


def split_all_in_directory(directory: Path) -> list[Path]:
    """Strip artifacts, then split all landscape images in a directory."""
    # First: strip scanner artifact from every file in place
    strip_all_in_directory(directory)
    # Then: split/deskew/crop
    results = []
    for f in sorted(directory.iterdir()):
        if f.suffix.lower() in IMAGE_EXTS:
            results.extend(split_if_landscape(f))
    return results
