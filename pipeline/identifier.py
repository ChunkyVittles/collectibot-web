"""
identifier.py — Send comic cover images to Claude Vision for metadata extraction.
"""

import base64
import json
import sys
import os
from pathlib import Path

import anthropic
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

FRONT_PROMPT = """This is a comic book cover. Extract exactly:
1. Series title (as printed on cover)
2. Issue number (digits only)
3. Publisher name
4. Cover date or year
5. Cover price if visible
6. Cover variant — look carefully for small text like "CVR A", "CVR B", "Cover A", "Cover B", "CVR RI" (retailer incentive), "2nd Printing", "3rd Print", "Variant Edition", etc. Often printed small near the barcode, price, or issue number. Return the variant label exactly as printed, or null if none found
Return as JSON: {"title", "issue_number", "publisher", "year", "price", "variant"}
Return ONLY the JSON object, no markdown fences or extra text."""

BACK_PROMPT = """This is the back cover of a comic book. Extract:
1. Issue date or year if printed
2. Barcode number if visible
3. Price if printed
Return as JSON: {"date", "barcode", "price"}
Return ONLY the JSON object, no markdown fences or extra text."""


def _image_media_type(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
        ".bmp": "image/bmp",
    }.get(ext, "image/jpeg")


def extract_metadata(image_path: Path, prompt: str) -> dict:
    """Send an image to Claude Vision and extract structured metadata."""
    client = anthropic.Anthropic()

    image_data = base64.standard_b64encode(image_path.read_bytes()).decode("utf-8")
    media_type = _image_media_type(image_path)

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=512,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_data,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )

    raw = response.content[0].text.strip()
    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()

    return json.loads(raw)


def identify_front(image_path: Path) -> dict:
    """Extract metadata from a front cover image."""
    return extract_metadata(image_path, FRONT_PROMPT)


def identify_back(image_path: Path) -> dict:
    """Extract metadata from a back cover image."""
    return extract_metadata(image_path, BACK_PROMPT)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python identifier.py <image_path> [front|back]")
        sys.exit(1)

    img = Path(sys.argv[1])
    side = sys.argv[2] if len(sys.argv) > 2 else "front"

    if not img.exists():
        print(f"File not found: {img}")
        sys.exit(1)

    print(f"Identifying {side} cover: {img.name}")
    if side == "back":
        result = identify_back(img)
    else:
        result = identify_front(img)

    print(json.dumps(result, indent=2))
