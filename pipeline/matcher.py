"""
matcher.py — Match extracted comic metadata against the Collectibot database.
"""

import re
import os
from itertools import combinations
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env", override=True)


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


def ampersand_variant(title: str) -> str | None:
    """If title contains &, return version with 'and' (or vice versa). None if no change."""
    if "&" in title:
        return re.sub(r'\s*&\s*', ' and ', title)
    if " and " in title.lower():
        return re.sub(r'\s+and\s+', ' & ', title, flags=re.IGNORECASE)
    return None


def strip_punctuation(text: str) -> str:
    """Remove punctuation and collapse whitespace for fuzzy comparison."""
    s = re.sub(r"[^\w\s]", " ", text)
    s = re.sub(r"\s+", " ", s)
    return s.strip().lower()


def keywords_only(text: str) -> str:
    """Extract meaningful keywords, dropping noise words and punctuation.
    'Batman & the Monster Men' → 'Batman Monster Men'
    'Batman: The Monster Men' → 'Batman Monster Men'
    """
    s = re.sub(r"[^\w\s]", " ", text)
    noise = {"the", "and", "of", "a", "an", "in", "on", "for", "with", "from"}
    words = [w for w in s.split() if w.lower() not in noise]
    return " ".join(words)


# Cover decoration phrases — flourishes printed on the cover that are NOT
# part of the actual series title (which lives in the indicia). The matcher
# tries the decoration-stripped title as a fallback so "Marvel Tales
# Featuring Spider-Man" still resolves to GCD's "Marvel Tales".
COVER_DECORATION_RX = re.compile(
    r"\s+(featuring|starring|presents|presenting|introducing)\b.*$",
    re.IGNORECASE,
)


def strip_cover_decoration(title: str) -> str | None:
    """Strip 'featuring X', 'starring X', etc. from the END of a title.

    Returns the trimmed title if a decoration phrase was found and removed,
    or None if no decoration was present (so callers can skip a redundant
    query).
    """
    if not title:
        return None
    trimmed = COVER_DECORATION_RX.sub("", title).strip(" -:!")
    if trimmed and trimmed.lower() != title.strip().lower():
        return trimmed
    return None


def slugify(text: str) -> str:
    """Convert text to a URL-safe slug."""
    s = text.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s)
    return s.strip("-")


def _parse_cover_price(price_str):
    """Parse a printed cover price to a USD float.

    Handles cent prices ('60¢', '75 CENTS', '60c', '.60' → 0.60/0.75) and
    dollar prices ('$1.00', '1.00 USD', '$3.99' → 1.00/3.99). Critically,
    '60¢' must become 0.60 — NOT 60.0 — or it never matches the DB's 0.60.
    """
    if not price_str:
        return None
    s = str(price_str).strip().lower()
    m = re.search(r"(\d+(?:\.\d+)?)", s)
    if not m:
        return None
    try:
        val = float(m.group(1))
    except ValueError:
        return None
    has_dollar = "$" in s
    is_cents = (not has_dollar) and ("¢" in s or "cent" in s or re.search(r"\d\s*c\b", s))
    if is_cents and val >= 1:           # "60¢" → 0.60 (leave an already-decimal alone)
        val /= 100.0
    elif (not has_dollar) and "." not in s and 5 <= val <= 99:
        val /= 100.0                    # bare classic cent price like "60" → 0.60
    return val


def match_issue(front_data: dict, back_data: dict | None = None) -> dict:
    """Match a cover, corroborating title + issue + price.

    Tries the primary title AND any alternate titles the identifier flagged
    (e.g. the big character logo on a reprint series like "Marvel Super Action"
    featuring "The Avengers"). Because _match_one_title price-rejects a candidate
    whose printed price can't line up, the title whose price+issue actually agree
    wins — so a 50¢ book won't be accepted as "Avengers #34" (12¢); it keeps
    looking and lands on the right series. When no price is printed, price simply
    doesn't gate the match. Returns the best matched result, else the primary no-match.
    """
    primary = str(front_data.get("title") or "")
    candidates = [primary]
    for t in (front_data.get("alt_titles") or []):
        t = str(t or "").strip()
        if t and t.lower() not in [c.lower() for c in candidates]:
            candidates.append(t)

    best = None
    fallback = None
    for cand in candidates:
        fd = dict(front_data)
        fd["title"] = cand
        res = _match_one_title(fd, back_data)
        if res.get("matched"):
            if best is None or res.get("confidence", 0) > best.get("confidence", 0):
                best = res
        elif fallback is None:
            fallback = res  # first (primary) no-match, for review context
    return best or fallback or {"matched": False, "confidence": 0,
                                "reason": "No candidates"}


def _match_one_title(front_data: dict, back_data: dict | None = None) -> dict:
    """
    Match extracted metadata against the database for ONE title.
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
    fmt = str(front_data.get("format") or "").strip()
    # Special formats (Annual, Giant-Size, King-Size, Special, …) are usually a
    # SEPARATE series in the DB — e.g. "All-Star Squadron Annual", not the
    # regular ongoing. Search that combined name first so an Annual doesn't
    # collide with (and get price-rejected against) the base series.
    format_title = f"{normalized} {fmt}".strip() if fmt else None

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
                i.price AS db_price,
                i.variant_name AS variant_name
            FROM issues i
            JOIN series s ON i.series_id = s.id
            LEFT JOIN publishers p ON s.publisher_id = p.id
            WHERE s.name ILIKE %s
              AND i.number = %s
            ORDER BY s.year_began ASC
            LIMIT 50
        """
        rows = []
        if format_title:
            # e.g. "All-Star Squadron Annual" — exact then fuzzy
            cur.execute(query, (format_title, issue_number))
            rows = cur.fetchall()
            if not rows:
                cur.execute(query, (f"%{format_title}%", issue_number))
                rows = cur.fetchall()

        if not rows:
            cur.execute(query, (normalized, issue_number))
            rows = cur.fetchall()

        if not rows:
            # Try fuzzy: add % wildcards
            cur.execute(query, (f"%{normalized}%", issue_number))
            rows = cur.fetchall()

        if not rows:
            # Strip cover-decoration phrases (FEATURING X, STARRING X, etc.)
            # — common cover flourishes that aren't part of the series name.
            # "Marvel Tales Featuring Spider-Man" → "Marvel Tales"
            # "Weird War Tales Starring the Creature Commandos!" → "Weird War Tales"
            stripped_deco = strip_cover_decoration(normalized)
            if stripped_deco:
                cur.execute(query, (stripped_deco, issue_number))
                rows = cur.fetchall()
                if not rows:
                    cur.execute(query, (f"%{stripped_deco}%", issue_number))
                    rows = cur.fetchall()

        if not rows:
            # Try &/and variant: "Sable & Fortune" → "Sable and Fortune" or vice versa
            alt = ampersand_variant(normalized)
            if alt:
                cur.execute(query, (alt, issue_number))
                rows = cur.fetchall()
                if not rows:
                    cur.execute(query, (f"%{alt}%", issue_number))
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
                    i.price AS db_price,
                    i.variant_name AS variant_name
                FROM issues i
                JOIN series s ON i.series_id = s.id
                LEFT JOIN publishers p ON s.publisher_id = p.id
                WHERE regexp_replace(lower(s.name), '[^\\w\\s]', ' ', 'g') ILIKE %s
                  AND i.number = %s
                ORDER BY s.year_began ASC
                LIMIT 50
            """
            cur.execute(punct_query, (f"%{stripped}%", issue_number))
            rows = cur.fetchall()

        if not rows:
            # Try no-space variant: covers "grim JACK" → "Grimjack" where the
            # cover renders a single-word title with a visual gap.
            no_space = re.sub(r"\s+", "", normalized)
            if no_space and no_space != normalized:
                cur.execute(query, (no_space, issue_number))
                rows = cur.fetchall()
                if not rows:
                    cur.execute(query, (f"%{no_space}%", issue_number))
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
                    i.price AS db_price,
                    i.variant_name AS variant_name
                FROM issues i
                JOIN series s ON i.series_id = s.id
                LEFT JOIN publishers p ON s.publisher_id = p.id
                WHERE %s ILIKE '%%' || s.name || '%%'
                  AND i.number = %s
                  AND length(s.name) >= 3
                ORDER BY length(s.name) DESC, s.year_began ASC
                LIMIT 50
            """
            cur.execute(reverse_query, (normalized, issue_number))
            rows = cur.fetchall()

        if not rows:
            # Try keywords-only: strip noise words (and, the, of) and match
            # e.g. "Batman and the Monster Men" → keywords "Batman Monster Men"
            # matches DB "Batman: The Monster Men" via fuzzy
            kw = keywords_only(normalized)
            if kw and kw != strip_punctuation(normalized):
                kw_pattern = "%" + "%".join(kw.split()) + "%"
                cur.execute(query, (kw_pattern, issue_number))
                rows = cur.fetchall()

        if not rows:
            # Strip a leading decorative adjective that the cover logo adds but
            # the series name omits: "The Mighty Avengers" → "Avengers",
            # "Invincible Iron Man" → "Iron Man", "Uncanny X-Men" → "X-Men".
            # Only a FALLBACK — real series like "The Incredible Hulk" or
            # "The Amazing Spider-Man" already matched above and never reach here.
            DECORATIVE_ADJ = {
                "mighty", "invincible", "uncanny", "sensational", "spectacular",
                "astonishing", "savage", "fabulous", "incredible", "amazing",
                "immortal", "superior", "all-new", "mighty world of",
            }
            w = normalized.split()
            if len(w) >= 2 and w[0].lower() in DECORATIVE_ADJ:
                deadj = " ".join(w[1:])
                if len(deadj) >= 3:
                    cur.execute(query, (deadj, issue_number))
                    rows = cur.fetchall()
                    if not rows:
                        cur.execute(query, (f"%{deadj}%", issue_number))
                        rows = cur.fetchall()

        if not rows:
            # Try word-dropping: remove one word at a time from the title and
            # search for each shortened version. Handles cases like
            # "Web of Kaine Spider-Man" where "Kaine" is an overlay graphic,
            # not part of the series name "Web of Spider-Man".
            words = normalized.split()
            if len(words) >= 2:
                # Drop 1 word (then 2) — always leave at least one word. Also
                # runs for 2-word titles ("Mighty Avengers" → "Avengers") so
                # ANY decorative word is tried, then confirmed by issue+price.
                max_drop = min(2, len(words) - 1)
                for drop_count in range(1, max_drop + 1):
                    for combo in combinations(range(len(words)), len(words) - drop_count):
                        candidate = " ".join(words[i] for i in combo)
                        if len(candidate) < 3:
                            continue
                        cur.execute(query, (candidate, issue_number))
                        rows = cur.fetchall()
                        if rows:
                            break
                        # Also try fuzzy
                        cur.execute(query, (f"%{candidate}%", issue_number))
                        rows = cur.fetchall()
                        if rows:
                            break
                    if rows:
                        break

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

        # Extract USD price from front data for comparison (cent-aware).
        extracted_usd = _parse_cover_price(front_data.get("price", ""))

        # Edition: "newsstand" (barcode on cover) vs "direct" (logo/no barcode).
        extracted_edition = str(front_data.get("edition") or "").strip().lower()

        # Extract variant from front data for matching
        extracted_variant = str(front_data.get("variant") or "").strip().lower()
        # Normalize common variant labels
        variant_map = {"cvr a": "cover a", "cvr b": "cover b", "cvr c": "cover c",
                       "cvr ri": "cover ri", "ri": "cover ri"}
        extracted_variant_norm = variant_map.get(extracted_variant, extracted_variant)

        for row in rows:
            issue_id, series_id, series_name, db_issue_num, yr_began, yr_ended, pub_name, db_price, db_variant = row
            score = 0

            # Hard filter: reject ONLY on a definite USD-vs-USD price mismatch.
            # This still disambiguates same-name/same-number series (e.g.
            # Punisher 1986 LS at 75¢ vs Punisher 1987 ongoing at $1.50), but
            # — unlike before — it does NOT reject when the DB row has no price
            # or a non-USD price, so a clean title/issue/year match isn't
            # needlessly dumped to review. Price still adds a big score bonus
            # below when it matches.
            if extracted_usd is not None and db_price:
                db_usd_match = re.search(r"([\d.]+)\s*USD", str(db_price))
                if db_usd_match:
                    try:
                        if abs(extracted_usd - float(db_usd_match.group(1))) > 0.01:
                            continue
                    except ValueError:
                        pass

            # Title matching (with punctuation-stripped fallback)
            # Compare against both normalized (The-stripped) and original title
            sn_stripped = strip_punctuation(series_name)
            norm_stripped = strip_punctuation(normalized)
            orig_stripped = strip_punctuation(title)
            if (series_name.lower() == normalized.lower()
                    or sn_stripped == norm_stripped
                    or sn_stripped == orig_stripped):
                score += 50
            elif (normalized.lower() in series_name.lower()
                    or norm_stripped in sn_stripped
                    or orig_stripped in sn_stripped):
                score += 30
            elif (series_name.lower() in normalized.lower()
                    or sn_stripped in norm_stripped
                    or sn_stripped in orig_stripped):
                score += 40  # DB name is contained in extracted title

            # Special-format preference: if this is an Annual/Giant-Size/etc.,
            # strongly prefer the series whose name actually carries that word
            # (e.g. "All-Star Squadron Annual") over the base ongoing series.
            if fmt:
                if fmt.lower() in (series_name or "").lower():
                    score += 25
                else:
                    score -= 15  # base series when we expected the special format

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

            # Price match bonus
            if extracted_usd and db_price:
                db_usd_match = re.search(r"([\d.]+)\s*USD", str(db_price))
                if db_usd_match:
                    try:
                        db_usd = float(db_usd_match.group(1))
                        if abs(extracted_usd - db_usd) < 0.01:
                            score += 30  # Exact price match
                        elif abs(extracted_usd - db_usd) < 0.50:
                            score += 10  # Close price
                    except ValueError:
                        pass

            # Variant matching
            if extracted_variant_norm and db_variant:
                db_variant_norm = db_variant.strip().lower()
                db_variant_norm = variant_map.get(db_variant_norm, db_variant_norm)
                if extracted_variant_norm == db_variant_norm:
                    score += 15  # Exact variant match
                elif extracted_variant_norm in db_variant_norm or db_variant_norm in extracted_variant_norm:
                    score += 10  # Partial variant match (e.g. "B" in "Cover B")
            elif not extracted_variant_norm and db_variant:
                # No variant extracted but DB has one — slight penalty for non-Cover-A
                if "cover a" not in (db_variant or "").lower():
                    score -= 5

            # Newsstand vs Direct edition (read from the cover barcode box).
            # GCD records the newsstand printing as a separate variant. Only
            # prefer the newsstand record when one actually EXISTS among the
            # candidates — otherwise the base/direct record wins on its own,
            # so a book is never mislabeled newsstand when no such variant
            # exists in the database.
            db_var_l = (db_variant or "").lower()
            if extracted_edition == "newsstand":
                if "newsstand" in db_var_l:
                    score += 25
            elif extracted_edition == "direct":
                if "newsstand" in db_var_l:
                    score -= 25  # we're a direct copy — don't pick the newsstand record
                elif (not db_var_l) or "direct" in db_var_l:
                    score += 12  # prefer the plain/Direct record over exotic variants
            # When the cover shows no special variant text, steer away from
            # exotic reprint/exclusive variants (virgin, sketch, foil, DF/Dynamic
            # Forces, blank, etc.) and toward the standard issue.
            if not extracted_variant_norm and any(
                k in db_var_l for k in ("virgin", "sketch", "foil", "dynamic forces",
                                        " df ", "blank", "exclusive", "retailer", "incentive")):
                score -= 20

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
                    "variant_name": db_variant,
                    "edition": ("newsstand" if "newsstand" in db_var_l
                                else (extracted_edition or None)),
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
