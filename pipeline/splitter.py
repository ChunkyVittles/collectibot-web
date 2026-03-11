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
    Uses numpy to find content pixel coordinates and compute the dominant angle
    via a covariance/PCA approach on edge pixels.
    """
    gray = np.array(ImageOps.grayscale(img))

    # Find content pixels (non-white)
    content_mask = gray < CONTENT_THRESHOLD

    # Get coordinates of content pixels
    ys, xs = np.nonzero(content_mask)

    if len(xs) < 100:
        return img

    # Use edge pixels only for better angle detection —
    # erode the mask and XOR to get edges
    from PIL import ImageFilter
    gray_img = ImageOps.grayscale(img)
    # Threshold to binary
    binary = gray_img.point(lambda p: 255 if p < CONTENT_THRESHOLD else 0)
    # Erode to find interior
    eroded = binary.filter(ImageFilter.MinFilter(5))
    # Edge = content minus eroded interior
    edge_arr = np.array(binary).astype(np.int16) - np.array(eroded).astype(np.int16)
    edge_mask = edge_arr > 128

    edge_ys, edge_xs = np.nonzero(edge_mask)

    if len(edge_xs) < 50:
        return img

    # Compute covariance matrix of edge pixel positions
    coords = np.column_stack([edge_xs - edge_xs.mean(), edge_ys - edge_ys.mean()])
    cov = np.cov(coords.T)

    # Eigenvalues/vectors — the principal axis gives orientation
    eigenvalues, eigenvectors = np.linalg.eigh(cov)

    # The eigenvector with the largest eigenvalue is the principal axis
    principal = eigenvectors[:, np.argmax(eigenvalues)]

    # Angle of principal axis relative to horizontal
    angle_rad = np.arctan2(principal[1], principal[0])
    angle_deg = np.degrees(angle_rad)

    # We want the correction angle — how far from perfectly vertical/horizontal
    # Comics are portrait rectangles, so the principal axis should be near vertical (90°)
    # Normalize to a small correction from 0
    if angle_deg > 45:
        correction = angle_deg - 90
    elif angle_deg < -45:
        correction = angle_deg + 90
    else:
        correction = angle_deg

    # Only deskew if meaningful but not extreme
    if abs(correction) < 0.3 or abs(correction) > 15:
        return img

    log.info(f"  Deskew: rotating {correction:.1f}°")

    rotated = img.rotate(
        -correction,  # Negative because rotate() is counter-clockwise
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
