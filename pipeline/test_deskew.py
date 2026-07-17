"""Test deskew on all images in ~/collectibot-scans/done/"""

import logging
import os
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(message)s")

from splitter import deskew
from PIL import Image

INPUT_DIR = Path.home() / "collectibot-scans" / "done"
OUTPUT_DIR = Path("/tmp/deskew_test")
OUTPUT_DIR.mkdir(exist_ok=True)

print(f"{'filename':<40} {'angle':>8} {'before':>14} {'after':>14}")
print("-" * 80)

for f in sorted(INPUT_DIR.iterdir()):
    if f.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
        continue

    img = Image.open(f)
    before = f"{img.width}x{img.height}"

    result = deskew(img)
    after = f"{result.width}x{result.height}"

    out_path = OUTPUT_DIR / f"{f.stem}_deskewed.jpg"
    result.save(out_path, quality=95)

    print(f"{f.name:<40} {'—':>8} {before:>14} {after:>14}")

    img.close()
    result.close()

print(f"\nResults saved to {OUTPUT_DIR}")
