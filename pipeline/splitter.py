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

import numpy as np
from PIL import Image, ImageOps

log = logging.getLogger("splitter")

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}

CONTENT_THRESHOLD = 245  # Pixels brighter than this are "white/background"
BORDER_INCHES = 0.5      # White border to add on all sides
SCAN_DPI = 300           # Assumed scanner DPI


def deskew(img: Image.Image) -> Image.Image:
    """
    Detect rotation angle of a comic on a white background and straighten it.
    Scans the left edge of the content to find the leftmost non-white pixel per row,
    then fits a line to those points to determine the skew angle.
    """
    gray = np.array(ImageOps.grayscale(img))
    h, w = gray.shape

    # Binary mask: True where content is
    content_mask = gray < CONTENT_THRESHOLD

    # For each row, find the leftmost content pixel
    left_edges = []
    for row in range(h):
        cols = np.nonzero(content_mask[row])[0]
        if len(cols) > 0:
            left_edges.append((row, cols[0]))

    if len(left_edges) < 20:
        return img

    rows = np.array([p[0] for p in left_edges], dtype=np.float64)
    cols = np.array([p[1] for p in left_edges], dtype=np.float64)

    # The left edge has noise from artwork — use RANSAC-like approach:
    # Sample many pairs, compute angles, take the median
    n = len(rows)
    if n > 200:
        # Sample evenly spaced points for speed
        indices = np.linspace(0, n - 1, 200, dtype=int)
        rows = rows[indices]
        cols = cols[indices]
        n = 200

    # Fit line: col = slope * row + intercept
    # slope tells us the angle — if the left edge is perfectly vertical, slope = 0
    # Use a robust approach: split into top quarter and bottom quarter,
    # take the median x in each, compute angle from those two points
    quarter = max(1, n // 4)
    top_x = np.median(cols[:quarter])
    bottom_x = np.median(cols[-quarter:])
    top_y = np.median(rows[:quarter])
    bottom_y = np.median(rows[-quarter:])

    dy = bottom_y - top_y
    dx = bottom_x - top_x

    if abs(dy) < 1:
        return img

    # Angle of the left edge from vertical
    # A vertical edge has dx=0. Positive dx means tilted clockwise.
    angle_rad = np.arctan2(dx, dy)
    angle_deg = np.degrees(angle_rad)

    # Only deskew if meaningful but not extreme
    if abs(angle_deg) < 0.3 or abs(angle_deg) > 15:
        return img

    log.info(f"  Deskew: rotating {angle_deg:.1f}° (left edge)")

    rotated = img.rotate(
        angle_deg,
        expand=True,
        fillcolor=(255, 255, 255),
        resample=Image.BICUBIC,
    )

    return rotated


def crop_to_content(img: Image.Image) -> Image.Image:
    """
    Deskew, crop tightly to content bounds, then add a clean 1/2-inch white border.
    """
    # Deskew first
    img = deskew(img)

    gray = ImageOps.grayscale(img)

    # Aggressive threshold — anything near-white is background
    threshold_img = gray.point(lambda p: 255 if p < CONTENT_THRESHOLD else 0)

    bbox = threshold_img.getbbox()

    if bbox is None:
        return img

    # Crop tight to content (no padding)
    cropped = img.crop(bbox)

    # Add clean white border — 1/2 inch at scan DPI
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

    # Landscape — split in half
    mid = width // 2
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


def split_all_in_directory(directory: Path) -> list[Path]:
    """Split all landscape images in a directory. Returns all resulting file paths."""
    results = []
    for f in sorted(directory.iterdir()):
        if f.suffix.lower() in IMAGE_EXTS:
            results.extend(split_if_landscape(f))
    return results
