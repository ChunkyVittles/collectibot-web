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

load_dotenv(Path(__file__).parent / ".env", override=True)

FRONT_PROMPT = """This is a comic book cover. Extract exactly:
1. Series title — the BASE series name as printed. IMPORTANT: on reprint/anthology comics the true series name is often a SMALLER banner at the very top (e.g. "MARVEL SUPER ACTION", "MARVEL TALES", "MARVEL'S GREATEST COMICS"), while a LARGE character logo below (e.g. "THE AVENGERS") is the reprinted/featured content, NOT the series — prefer the top banner as the title. Exclude any special-format word like ANNUAL/GIANT-SIZE/SPECIAL (those go in field 9). E.g. "ALL-STAR SQUADRON ANNUAL" → title "All-Star Squadron".
2. Issue number (digits only)
3. Publisher name
4. Publication YEAR — the 4-DIGIT year only (e.g. 1983). LOOK CAREFULLY in the small corner/indicia box near the publisher logo, price, or issue number — the year is often printed there in tiny text (e.g. a DC corner box showing "1983"). Also check any date line. If NO 4-digit year is printed anywhere, return null. NEVER put a month name or abbreviation in this field.
5. Cover month — the 3-letter month abbreviation if printed (Jan, Feb, Mar, …), otherwise null.
6. Cover price EXACTLY as printed, including the symbol — e.g. "60¢", "75¢", "$1.00", "$3.99". Keep the cent sign ¢ for cent prices; do NOT convert cents to dollars.
7. Cover variant — small text like "CVR A", "CVR B", "Cover A", "CVR RI" (retailer incentive), "2nd Printing", "3rd Print", "Variant Edition", etc. Often printed small near the barcode, price, or issue number. Return the label exactly as printed, or null if none.
8. Barcode present — is there a real scannable UPC BARCODE (a block of many parallel vertical black lines) printed on the FRONT cover? Return true ONLY if you clearly see that block of vertical bars. A Direct Edition box in the same corner looks similar but contains a DRAWN CHARACTER, a publisher LOGO (e.g. a small Spider-Man head), or a small date/code with NO vertical bars — that is NOT a barcode, return false. When unsure, return false.
9. Special format — if the title treatment prominently includes a special-format word (ANNUAL, GIANT-SIZE, KING-SIZE, SPECIAL, SPECTACULAR, GIANT, TREASURY), return it normalized ("Annual", "Giant-Size", "King-Size", "Special", …). Otherwise null. These almost always indicate a SEPARATE series in the database (e.g. "All-Star Squadron Annual"), so it matters.
10. Alternate titles — a JSON array of any OTHER prominent title text on the cover (the large character logo, a subtitle, etc.) that could plausibly be the series name, so it can be tried if the primary title doesn't match. E.g. for a "Marvel Super Action" cover featuring "The Avengers", return ["The Avengers"]. Empty array [] if none.
Return as JSON: {"title", "issue_number", "publisher", "year", "month", "price", "variant", "barcode_present", "format", "alt_titles"}
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
        model="claude-sonnet-4-6",
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
    """Extract metadata from a front cover image.

    Edition is derived STRICTLY from barcode presence — a newsstand copy must
    have a barcode, so no visible barcode means Direct. We don't trust a fuzzy
    "edition" guess from the model.
    """
    result = extract_metadata(image_path, FRONT_PROMPT)
    result["edition"] = "newsstand" if result.get("barcode_present") is True else "direct"
    return result


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
