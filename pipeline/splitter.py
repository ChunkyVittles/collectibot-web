"""
splitter.py — Split landscape comic scans into two portrait halves,
then auto-crop each to content bounds with padding.

If an image is landscape (wider than tall), it contains two comics side by side.
Split at the 50% width mark into left (a) and right (b) halves.
Portrait images are left untouched.

All output images are auto-cropped to remove white margins.
"""

import logging
from pathlib import Path

from PIL import Image, ImageOps

log = logging.getLogger("splitter")

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}

CONTENT_THRESHOLD = 250  # Pixels brighter than this are "white/background"
CROP_PADDING = 40        # Pixels of padding to keep around content


def crop_to_content(img: Image.Image) -> Image.Image:
    """
    Crop an image to its content bounds (non-white pixels) with padding.
    Pixels with brightness < 250 are considered content.
    """
    # Convert to grayscale for analysis
    gray = ImageOps.grayscale(img)

    # Invert so content becomes white (>0) and background becomes black (0)
    # Then getbbox() finds the bounding box of non-zero pixels
    # We threshold first: anything < 250 in grayscale is content
    threshold_img = gray.point(lambda p: 255 if p < CONTENT_THRESHOLD else 0)

    bbox = threshold_img.getbbox()

    if bbox is None:
        # Entirely white image, return as-is
        return img

    left, top, right, bottom = bbox

    # Add padding
    width, height = img.size
    left = max(0, left - CROP_PADDING)
    top = max(0, top - CROP_PADDING)
    right = min(width, right + CROP_PADDING)
    bottom = min(height, bottom + CROP_PADDING)

    return img.crop((left, top, right, bottom))


def split_if_landscape(image_path: Path) -> list[Path]:
    """
    Check orientation. If landscape, split into two halves.
    All output images are auto-cropped to content.
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

    # Portrait or square — crop to content in place
    if width <= height:
        cropped = crop_to_content(img)
        if cropped.size != img.size:
            cropped.save(image_path, quality=95)
            log.info(f"Cropped {image_path.name}: {width}x{height} → {cropped.width}x{cropped.height}")
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

    # Crop halves, then auto-crop each to content
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
