"""Test splitter + auto-crop on a real landscape dual-scan."""

import shutil
import tempfile
from pathlib import Path

from PIL import Image

from splitter import split_if_landscape

INPUT_IMAGE = Path("/Users/davidbull/Desktop/Comic Covers/03082026.jpg")
OUTPUT_DIR = Path("/Users/davidbull/Desktop/Projects/Collectibot/collectibot-web/pipeline/test_output")


def main():
    OUTPUT_DIR.mkdir(exist_ok=True)

    # Get original dimensions
    orig = Image.open(INPUT_IMAGE)
    print(f"Original: {INPUT_IMAGE.name} — {orig.width}x{orig.height}")
    orig.close()

    # Copy to a temp dir so we don't modify the original
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        test_file = tmp / "scan_001_1.jpg"
        shutil.copy2(INPUT_IMAGE, test_file)

        # Run splitter (split + crop)
        results = split_if_landscape(test_file)

        print(f"\nSplit into {len(results)} files:\n")

        output_paths = []
        for i, result in enumerate(results):
            img = Image.open(result)
            side = "left" if i == 0 else "right"
            print(f"  {result.name}: {img.width}x{img.height}")

            # Copy to output dir with friendly names
            out_name = f"test_{side}_cropped.jpg"
            out_path = OUTPUT_DIR / out_name
            shutil.copy2(result, out_path)
            output_paths.append(out_path)
            print(f"  → Saved to {out_path}")
            img.close()

        # Summary
        print(f"\nDimension summary:")
        print(f"  Original:      3400x2359 (landscape dual-scan)")
        print(f"  Split halves:  1700x2359 each (before crop)")
        for p in output_paths:
            img = Image.open(p)
            print(f"  {p.name}: {img.width}x{img.height} (after crop)")
            img.close()


if __name__ == "__main__":
    main()
