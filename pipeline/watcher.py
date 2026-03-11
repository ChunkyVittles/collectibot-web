"""
watcher.py — Monitor inbox folder for comic scan pairs and process them.

Auto-processing requires ALL of:
  - extracted title
  - extracted issue_number
  - year (from front cover, back cover, or database match)
  - database match confidence >= 80%

Otherwise the pair goes to review/ with a pending_scans DB row.
"""

import json
import logging
import os
import re
import shutil
import time
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from watchdog.observers.polling import PollingObserver
from watchdog.events import FileSystemEventHandler

from identifier import identify_front, identify_back
from matcher import match_issue
from uploader import upload_pair

load_dotenv(Path(__file__).parent / ".env")

INBOX = Path.home() / "collectibot-scans" / "inbox"
PROCESSING = Path.home() / "collectibot-scans" / "processing"
DONE = Path.home() / "collectibot-scans" / "done"
REVIEW = Path.home() / "collectibot-scans" / "review"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}

# Files ending in 1 = front, ending in 2 = back (e.g. SCAN_1.jpg, SCAN_2.jpg)
FRONT_PATTERN = re.compile(r"1$")  # stem ends with 1
BACK_PATTERN = re.compile(r"2$")   # stem ends with 2

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("watcher")


def get_db_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "5433")),
        dbname=os.getenv("DB_NAME", "collectibot"),
        user=os.getenv("DB_USER", "collectibot"),
        password=os.getenv("DB_PASSWORD", ""),
    )


def get_base_name(path: Path) -> str | None:
    """Strip trailing 1 or 2 to get the shared base name."""
    stem = path.stem
    if FRONT_PATTERN.search(stem):
        return stem[:-1]
    if BACK_PATTERN.search(stem):
        return stem[:-1]
    return None


def is_front(path: Path) -> bool:
    return bool(FRONT_PATTERN.search(path.stem))


def is_back(path: Path) -> bool:
    return bool(BACK_PATTERN.search(path.stem))


def slugify(text: str) -> str:
    s = text.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s)
    return s.strip("-")


def seo_rename(path: Path, title: str, issue_number: str, side: str) -> Path:
    """Rename a file to an SEO-friendly name. Returns the new path."""
    slug = slugify(title)
    issue = str(issue_number).strip().replace(" ", "-")
    new_name = f"{slug}-{issue}-{side}{path.suffix.lower()}"
    new_path = path.parent / new_name
    # Avoid collision
    if new_path.exists() and new_path != path:
        stem = new_path.stem
        new_path = path.parent / f"{stem}-{int(time.time())}{path.suffix.lower()}"
    path.rename(new_path)
    return new_path


def find_pairs(directory: Path) -> list[tuple[Path, Path]]:
    files = [f for f in directory.iterdir() if f.suffix.lower() in IMAGE_EXTS]
    fronts = {}
    backs = {}
    for f in files:
        base = get_base_name(f)
        if base is None:
            continue
        if is_front(f):
            fronts[base] = f
        elif is_back(f):
            backs[base] = f

    pairs = []
    for base, front in fronts.items():
        if base in backs:
            pairs.append((front, backs[base]))
    return pairs


def _resolve_year(front_data: dict, back_data: dict, match: dict) -> int | None:
    """Try to get year from front cover, back cover, or database match."""
    # Front cover year
    year = front_data.get("year")
    if year:
        m = re.search(r"(\d{4})", str(year))
        if m:
            return int(m.group(1))

    # Back cover date
    if back_data and back_data.get("date"):
        m = re.search(r"(\d{4})", str(back_data["date"]))
        if m:
            return int(m.group(1))

    # Database match year
    if match and match.get("year_began"):
        return match["year_began"]

    return None


def _send_to_review(
    base: str,
    front_path: Path,
    back_path: Path,
    front_data: dict,
    back_data: dict,
    match: dict | None,
    reason: str,
):
    """Move pair to review folder, save sidecar JSON, insert pending_scans row."""
    confidence = match.get("confidence", 0) if match else 0

    # Resolve year for the DB row
    year = _resolve_year(front_data, back_data or {}, match or {})

    # SEO rename if we have enough info
    title = front_data.get("title")
    issue = front_data.get("issue_number")
    if title:
        label = title
        suffix = str(issue) if issue else "unknown"
        front_path = seo_rename(front_path, label, suffix, "front")
        back_path = seo_rename(back_path, label, suffix, "back")
        base = slugify(f"{label}-{suffix}")

    # Save sidecar JSON
    sidecar = {
        "front_extraction": front_data,
        "back_extraction": back_data,
        "match_result": match,
        "reason": reason,
    }
    sidecar_path = REVIEW / f"{base}.json"
    sidecar_path.write_text(json.dumps(sidecar, indent=2))

    # Move images to review
    review_front = REVIEW / front_path.name
    review_back = REVIEW / back_path.name
    shutil.move(str(front_path), str(review_front))
    shutil.move(str(back_path), str(review_back))

    # Insert into pending_scans
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO pending_scans
               (front_image_path, back_image_path, extracted_title, extracted_issue,
                extracted_year, extracted_publisher, extracted_price,
                confidence_score, reason_for_review)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
            (
                str(review_front),
                str(review_back),
                front_data.get("title"),
                str(front_data.get("issue_number", "")) or None,
                year,
                front_data.get("publisher"),
                front_data.get("price"),
                confidence,
                reason,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    extracted_title = front_data.get("title", "Unknown")
    extracted_issue = front_data.get("issue_number", "?")
    log.info(f"  ⚠️  Review needed: {extracted_title} #{extracted_issue} ({confidence}%) — {reason}")


def process_pair(front: Path, back: Path):
    """Run the full pipeline on a front/back pair."""
    base = get_base_name(front)
    log.info(f"Processing pair: {base}")

    # Move to processing
    proc_front = PROCESSING / front.name
    proc_back = PROCESSING / back.name
    shutil.move(str(front), str(proc_front))
    shutil.move(str(back), str(proc_back))

    try:
        # Identify front cover
        log.info(f"  Identifying front: {proc_front.name}")
        front_data = identify_front(proc_front)
        log.info(f"  Front data: {json.dumps(front_data)}")

        # Identify back cover
        log.info(f"  Identifying back: {proc_back.name}")
        back_data = identify_back(proc_back)
        log.info(f"  Back data: {json.dumps(back_data)}")

        # Match against database
        log.info("  Matching against database...")
        match = match_issue(front_data, back_data)
        confidence = match.get("confidence", 0)

        # --- Validation gate ---
        title = front_data.get("title")
        issue_number = front_data.get("issue_number")
        year = _resolve_year(front_data, back_data, match)

        if not title:
            _send_to_review(base, proc_front, proc_back, front_data, back_data, match, "missing title")
            return

        if not issue_number:
            _send_to_review(base, proc_front, proc_back, front_data, back_data, match, "missing issue_number")
            return

        if not year:
            _send_to_review(base, proc_front, proc_back, front_data, back_data, match, "missing year")
            return

        if confidence < 80:
            _send_to_review(
                base, proc_front, proc_back, front_data, back_data, match,
                f"low confidence ({confidence}%)",
            )
            return

        # --- All checks passed: auto-process ---
        series_name = match.get("series_name", title)
        db_issue = match.get("issue_number", issue_number)

        # SEO rename originals
        proc_front = seo_rename(proc_front, series_name, db_issue, "front")
        proc_back = seo_rename(proc_back, series_name, db_issue, "back")

        log.info(f"  Uploading (confidence={confidence}%)...")
        result = upload_pair(proc_front, proc_back, match, PROCESSING)
        log.info(f"  Hensley: {result['hensley_front']}")

        # Move originals to done
        shutil.move(str(proc_front), str(DONE / proc_front.name))
        shutil.move(str(proc_back), str(DONE / proc_back.name))

        log.info(f"  ✅ Matched: {series_name} #{db_issue} ({confidence}%)")

    except Exception as e:
        log.error(f"  ❌ Error processing {base}: {e}", exc_info=True)
        for p in [proc_front, proc_back]:
            if p.exists():
                shutil.move(str(p), str(INBOX / p.name))


class InboxHandler(FileSystemEventHandler):
    def on_created(self, event):
        if event.is_directory:
            return
        time.sleep(2)
        pairs = find_pairs(INBOX)
        for front, back in pairs:
            try:
                process_pair(front, back)
            except Exception as e:
                log.error(f"Unhandled error: {e}", exc_info=True)


def main():
    for d in [INBOX, PROCESSING, DONE, REVIEW]:
        d.mkdir(parents=True, exist_ok=True)

    log.info(f"Watching: {INBOX}")
    log.info("Drop front/back pairs to begin processing.")
    log.info("Press Ctrl+C to stop.\n")

    pairs = find_pairs(INBOX)
    for front, back in pairs:
        try:
            process_pair(front, back)
        except Exception as e:
            log.error(f"Unhandled error: {e}", exc_info=True)

    observer = PollingObserver(timeout=5)
    observer.schedule(InboxHandler(), str(INBOX), recursive=False)
    observer.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        log.info("Stopping watcher...")
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
