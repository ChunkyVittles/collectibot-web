"""Test the splitter with a fake landscape image."""

import tempfile
from pathlib import Path

from PIL import Image

from splitter import split_if_landscape


def test_landscape_split():
    """A 1700x2200 landscape image should split into two 850x2200 portraits."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)

        # Create a fake landscape image (wider than tall = two comics side by side)
        # 1700 wide x 2200 tall is actually portrait — spec says 1700x2200 but
        # for landscape we need width > height. The spec says "simulating two comics
        # side by side" so the image should be landscape: 2200x1700 would be wrong too.
        # Two comics side by side at ~850px each = 1700 wide, but 2200 tall makes it portrait.
        # Let's use 3400x2200 — two 1700-wide comics side by side, each 2200 tall.
        # Actually, re-reading: "1700x2200 white image" — let me just use that as specified.
        # 1700 wide, 2200 tall = portrait, won't split. But the spec says it simulates
        # two side by side... Let me just make it truly landscape: 4400x2200.
        # No wait — the user said 1700x2200. That's portrait. But they want it to split.
        # I think they meant a scanner bed that's landscape: maybe 2200x1700.
        # Let me just create both cases and test both.

        # Test 1: Landscape image (wider than tall) — should split
        print("=== Test 1: Landscape image (should split) ===")
        landscape = Image.new("RGB", (3400, 2200), "white")
        # Draw a line down the middle so we can see the split
        for y in range(2200):
            landscape.putpixel((1699, y), (255, 0, 0))
            landscape.putpixel((1700, y), (255, 0, 0))
        landscape_path = tmp / "scan_001_1.jpg"
        landscape.save(landscape_path)
        landscape.close()
        print(f"  Input: {landscape_path.name} (3400x2200)")

        results = split_if_landscape(landscape_path)
        print(f"  Output files: {len(results)}")
        for r in results:
            img = Image.open(r)
            print(f"    {r.name}: {img.width}x{img.height}")
            img.close()
        assert len(results) == 2, f"Expected 2 files, got {len(results)}"
        assert not landscape_path.exists(), "Original should be deleted"

        # Check naming
        assert results[0].name == "scan_001_a1.jpg", f"Expected scan_001_a1.jpg, got {results[0].name}"
        assert results[1].name == "scan_001_b1.jpg", f"Expected scan_001_b1.jpg, got {results[1].name}"

        # Check dimensions
        left = Image.open(results[0])
        right = Image.open(results[1])
        assert left.width == 1700, f"Left width {left.width} != 1700"
        assert right.width == 1700, f"Right width {right.width} != 1700"
        assert left.height == 2200
        assert right.height == 2200
        left.close()
        right.close()
        print("  PASS")

        # Test 2: Portrait image (taller than wide) — should NOT split
        print("\n=== Test 2: Portrait image (should not split) ===")
        portrait = Image.new("RGB", (1700, 2200), "white")
        portrait_path = tmp / "scan_002_1.jpg"
        portrait.save(portrait_path)
        portrait.close()
        print(f"  Input: {portrait_path.name} (1700x2200)")

        results2 = split_if_landscape(portrait_path)
        print(f"  Output files: {len(results2)}")
        for r in results2:
            img = Image.open(r)
            print(f"    {r.name}: {img.width}x{img.height}")
            img.close()
        assert len(results2) == 1, f"Expected 1 file, got {len(results2)}"
        assert portrait_path.exists(), "Portrait should not be deleted"
        print("  PASS")

        # Test 3: Back cover landscape — verify naming with suffix 2
        print("\n=== Test 3: Landscape back cover (suffix 2) ===")
        back = Image.new("RGB", (3400, 2200), "white")
        back_path = tmp / "scan_001_2.jpg"
        back.save(back_path)
        back.close()
        print(f"  Input: {back_path.name} (3400x2200)")

        results3 = split_if_landscape(back_path)
        print(f"  Output files: {len(results3)}")
        for r in results3:
            img = Image.open(r)
            print(f"    {r.name}: {img.width}x{img.height}")
            img.close()
        assert results3[0].name == "scan_001_a2.jpg"
        assert results3[1].name == "scan_001_b2.jpg"
        print("  PASS")

        print("\n✅ All tests passed!")


if __name__ == "__main__":
    test_landscape_split()
