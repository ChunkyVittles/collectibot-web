"""Test: chop top 50 pixels off raw scans and save to /tmp/strip_test/ — nothing else."""

from pathlib import Path
from PIL import Image

INPUT_DIR = Path.home() / "Desktop" / "Comic Covers"
OUTPUT_DIR = Path("/tmp/strip_test")
OUTPUT_DIR.mkdir(exist_ok=True)

STRIP_PX = 50

for f in sorted(INPUT_DIR.iterdir()):
    if f.suffix.lower() not in {".jpg", ".jpeg", ".png"}:
        continue

    img = Image.open(f)
    w, h = img.size

    # Chop top 50 pixels
    cropped = img.crop((0, STRIP_PX, w, h))

    out = OUTPUT_DIR / f.name
    cropped.save(out, quality=95)
    print(f"{f.name}: {w}x{h} → {cropped.size[0]}x{cropped.size[1]}  saved to {out}")

    img.close()
    cropped.close()

print(f"\nResults in {OUTPUT_DIR}")
