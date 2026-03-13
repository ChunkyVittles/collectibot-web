"""
matcher.py — Match extracted comic metadata against the Collectibot database.
"""

import re
import os
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")


def get_db_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "5433")),
        dbname=os.getenv("DB_NAME", "collectibot"),
        user=os.getenv("DB_USER", "collectibot"),
        password=os.getenv("DB_PASSWORD", ""),
    )


def normalize_title(title: str) -> str:
    """Strip 'The ' prefix and extra whitespace for matching."""
    t = title.strip()
    if t.lower().startswith("the "):
        t = t[4:]
    return t.strip()


def strip_punctuation(text: str) -> str:
    """Remove punctuation and collapse whitespace for fuzzy comparison."""
    s = re.sub(r"[^\w\s]", " ", text)
    s = re.sub(r"\s+", " ", s)
    return s.strip().lower()


def slugify(text: str) -> str:
    """Convert text to a URL-safe slug."""
    s = text.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s)
    return s.strip("-")


def match_issue(front_data: dict, back_data: dict | None = None) -> dict:
    """
    Match extracted metadata against the database.
    Returns: {matched, confidence, issue_id, series_id, series_name, series_slug, ...}
    """
    title = front_data.get("title", "")
    issue_number = str(front_data.get("issue_number", "")).strip()
    year = front_data.get("year")

    # Try to parse year from various formats
    if year:
        year_match = re.search(r"(\d{4})", str(year))
        year = int(year_match.group(1)) if year_match else None

    # Also check back cover for year
    if not year and back_data and back_data.get("date"):
        year_match = re.search(r"(\d{4})", str(back_data["date"]))
        year = int(year_match.group(1)) if year_match else None

    normalized = normalize_title(title)

    conn = get_db_connection()
    try:
        cur = conn.cursor()

        # Query: match series by name, then find issue by number
        query = """
            SELECT
                i.id AS issue_id,
                s.id AS series_id,
                s.name AS series_name,
                i.number AS issue_number,
                s.year_began,
                s.year_ended,
                p.name AS publisher_name,
                i.price AS db_price
            FROM issues i
            JOIN series s ON i.series_id = s.id
            LEFT JOIN publishers p ON s.publisher_id = p.id
            WHERE s.name ILIKE %s
              AND i.number = %s
            ORDER BY s.year_began ASC
            LIMIT 20
        """
        cur.execute(query, (normalized, issue_number))
        rows = cur.fetchall()

        if not rows:
            # Try fuzzy: add % wildcards
            cur.execute(query, (f"%{normalized}%", issue_number))
            rows = cur.fetchall()

        if not rows:
            # Try punctuation-stripped match: "SPEEDBALL THE MASKED MARVEL" matches "Speedball: The Masked Marvel"
            stripped = strip_punctuation(normalized)
            punct_query = """
                SELECT
                    i.id AS issue_id,
                    s.id AS series_id,
                    s.name AS series_name,
                    i.number AS issue_number,
                    s.year_began,
                    s.year_ended,
                    p.name AS publisher_name,
                    i.price AS db_price
                FROM issues i
                JOIN series s ON i.series_id = s.id
                LEFT JOIN publishers p ON s.publisher_id = p.id
                WHERE regexp_replace(lower(s.name), '[^\\w\\s]', ' ', 'g') ILIKE %s
                  AND i.number = %s
                ORDER BY s.year_began ASC
                LIMIT 20
            """
            cur.execute(punct_query, (f"%{stripped}%", issue_number))
            rows = cur.fetchall()

        if not rows:
            # Try reverse: find series whose name appears within the extracted title
            # e.g. extracted "SPEEDBALL THE MASKED MARVEL" should match series "Speedball"
            reverse_query = """
                SELECT
                    i.id AS issue_id,
                    s.id AS series_id,
                    s.name AS series_name,
                    i.number AS issue_number,
                    s.year_began,
                    s.year_ended,
                    p.name AS publisher_name,
                    i.price AS db_price
                FROM issues i
                JOIN series s ON i.series_id = s.id
                LEFT JOIN publishers p ON s.publisher_id = p.id
                WHERE %s ILIKE '%%' || s.name || '%%'
                  AND i.number = %s
                  AND length(s.name) >= 3
                ORDER BY length(s.name) DESC, s.year_began ASC
                LIMIT 20
            """
            cur.execute(reverse_query, (normalized, issue_number))
            rows = cur.fetchall()

        if not rows:
            return {
                "matched": False,
                "confidence": 0,
                "extracted_title": title,
                "extracted_issue": issue_number,
                "extracted_year": year,
                "reason": "No matching series/issue found",
            }

        # Score each candidate
        best = None
        best_score = 0

        # Extract USD price from front data for comparison
        extracted_price = front_data.get("price", "")
        extracted_usd = None
        if extracted_price:
            usd_match = re.search(r"\$?([\d.]+)\s*(?:us|usd)?", str(extracted_price), re.IGNORECASE)
            if usd_match:
                try:
                    extracted_usd = float(usd_match.group(1))
                except ValueError:
                    pass

        for row in rows:
            issue_id, series_id, series_name, db_issue_num, yr_began, yr_ended, pub_name, db_price = row
            score = 0

            # Title matching (with punctuation-stripped fallback)
            sn_stripped = strip_punctuation(series_name)
            norm_stripped = strip_punctuation(normalized)
            if series_name.lower() == normalized.lower() or sn_stripped == norm_stripped:
                score += 50
            elif normalized.lower() in series_name.lower() or norm_stripped in sn_stripped:
                score += 30
            elif series_name.lower() in normalized.lower() or sn_stripped in norm_stripped:
                score += 40  # DB name is contained in extracted title

            # Issue number matched (already filtered by query)
            score += 25

            # Year match
            if year and yr_began:
                yr_end = yr_ended or yr_began + 50
                if yr_began - 1 <= year <= yr_end + 1:
                    score += 20
                    # Tighter year match
                    if yr_began <= year <= yr_end:
                        score += 5

            # Publisher match
            pub_extracted = front_data.get("publisher", "").lower()
            if pub_name and pub_extracted and pub_name.lower() in pub_extracted:
                score += 10
            elif pub_name and pub_extracted and pub_extracted in pub_name.lower():
                score += 10

            # Price match — strong signal for disambiguating same-title series
            if extracted_usd and db_price:
                db_usd_match = re.search(r"([\d.]+)\s*USD", str(db_price))
                if db_usd_match:
                    try:
                        db_usd = float(db_usd_match.group(1))
                        if abs(extracted_usd - db_usd) < 0.01:
                            score += 30  # Exact price match — very strong signal
                        elif abs(extracted_usd - db_usd) < 0.50:
                            score += 10  # Close price
                    except ValueError:
                        pass

            if score > best_score:
                best_score = score
                best = {
                    "matched": True,
                    "confidence": min(score, 100),
                    "issue_id": issue_id,
                    "series_id": series_id,
                    "series_name": series_name,
                    "series_slug": slugify(series_name),
                    "issue_number": db_issue_num,
                    "year_began": yr_began,
                    "publisher": pub_name,
                    "extracted_title": title,
                    "extracted_issue": issue_number,
                    "extracted_year": year,
                }

        return best or {
            "matched": False,
            "confidence": 0,
            "extracted_title": title,
            "extracted_issue": issue_number,
            "extracted_year": year,
            "reason": "Scoring failed",
        }

    finally:
        conn.close()


if __name__ == "__main__":
    import json, sys

    if len(sys.argv) < 3:
        print('Usage: python matcher.py \'{"title":"...","issue_number":"..."}\' \'{"date":"..."}\'')
        sys.exit(1)

    front = json.loads(sys.argv[1])
    back = json.loads(sys.argv[2]) if len(sys.argv) > 2 else None
    result = match_issue(front, back)
    print(json.dumps(result, indent=2))
