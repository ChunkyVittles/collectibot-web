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
import signal
import shutil
import subprocess
import time
from datetime import datetime
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from watchdog.observers.polling import PollingObserver
from watchdog.events import FileSystemEventHandler

from identifier import identify_front
from matcher import match_issue
from splitter import split_all_in_directory
from uploader import upload_pair

load_dotenv(Path(__file__).parent / ".env", override=True)


def kill_existing_watchers():
    """Kill any other watcher.py processes before starting."""
    current_pid = os.getpid()
    result = subprocess.run(
        ["pgrep", "-f", "watcher.py"],
        capture_output=True, text=True,
    )
    for pid_str in result.stdout.strip().split("\n"):
        if pid_str and int(pid_str) != current_pid:
            try:
                os.kill(int(pid_str), signal.SIGKILL)
                print(f"Killed stale watcher PID {pid_str}")
            except ProcessLookupError:
                pass

INBOX = Path(os.getenv("COLLECTIBOT_INBOX_FOLDER", str(
    Path.home() / "collectibot-scans" / "inbox"
)))
RELAY = Path(os.getenv("COLLECTIBOT_RELAY_FOLDER", str(
    Path.home() / "Desktop" / "BulkLister Scans" / "Relay Completed"
)))
RELAY_DONE = Path(os.getenv("COLLECTIBOT_RELAY_DONE_FOLDER", str(
    Path.home() / "Desktop" / "BulkLister Scans" / "Collectibot Completed"
)))
PROCESSING = Path.home() / "collectibot-scans" / "processing"
DONE = Path.home() / "collectibot-scans" / "done"
REVIEW = Path.home() / "collectibot-scans" / "review"

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}

# Multi-book scans: files are numbered sequentially and paired two-at-a-time —
# odd number = front cover, the next even number = back cover. So 1_1/1_2 = book 1,
# 1_3/1_4 = book 2, 1_5/1_6 = book 3, ... for any number of books scanned at once.
TRAILING_NUM = re.compile(r"^(.*?)(\d+)$")  # stem -> (prefix, number)

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


def _trailing_num(path: Path):
    """From a stem like '1_3' return ('1_', 3); ('name', None) if no trailing digits."""
    m = TRAILING_NUM.match(path.stem)
    if not m:
        return path.stem, None
    return m.group(1), int(m.group(2))


def get_base_name(path: Path) -> str | None:
    """Prefix without the trailing scan number (used only as a log label)."""
    prefix, num = _trailing_num(path)
    return prefix if num is not None else None


def is_front(path: Path) -> bool:
    """Odd trailing number = front cover (1, 3, 5, ...)."""
    _, n = _trailing_num(path)
    return n is not None and n % 2 == 1


def is_back(path: Path) -> bool:
    """Even trailing number = back cover (2, 4, 6, ...)."""
    _, n = _trailing_num(path)
    return n is not None and n % 2 == 0


def slugify(text: str) -> str:
    s = text.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"-+", "-", s)
    return s.strip("-")


def _backup_existing(file_path: Path, overwrites_dir: Path) -> Path | None:
    """Copy file_path into overwrites_dir with a timestamp prefix.

    Returns the backup path, or None if the source didn't exist.
    """
    if not file_path.exists():
        return None
    overwrites_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    backup_path = overwrites_dir / f"{ts}_{file_path.name}"
    shutil.copy2(str(file_path), str(backup_path))
    return backup_path


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
    """Pair scans sequentially within each prefix group: (_1,_2), (_3,_4), (_5,_6)...
    front = odd number, back = the next even number. Handles a whole multi-book
    batch scanned at once (e.g. 1_1..1_40 = 20 books). A front with no matching
    back yet is left for the next poll."""
    groups: dict[str, dict[int, Path]] = {}
    for f in directory.iterdir():
        if f.suffix.lower() not in IMAGE_EXTS:
            continue
        prefix, num = _trailing_num(f)
        if num is None:
            continue
        groups.setdefault(prefix, {})[num] = f

    pairs = []
    for prefix in sorted(groups):
        by_num = groups[prefix]
        for n in sorted(by_num):
            if n % 2 == 1 and (n + 1) in by_num:   # odd = front, next even = back
                pairs.append((by_num[n], by_num[n + 1]))
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

    # Upload to R2 under pending/ prefix so thumbnails work online
    from uploader import get_r2_client, convert_to_webp
    r2 = get_r2_client()
    bucket = os.getenv("R2_BUCKET", "collectibot-scans")

    front_webp = front_path.parent / f"{front_path.stem}.webp"
    back_webp = back_path.parent / f"{back_path.stem}.webp"
    convert_to_webp(front_path, front_webp)
    convert_to_webp(back_path, back_webp)

    r2_front_key = f"pending/{front_webp.name}"
    r2_back_key = f"pending/{back_webp.name}"
    r2.upload_file(str(front_webp), bucket, r2_front_key, ExtraArgs={"ContentType": "image/webp"})
    r2.upload_file(str(back_webp), bucket, r2_back_key, ExtraArgs={"ContentType": "image/webp"})
    front_webp.unlink()
    back_webp.unlink()

    # Move images to review
    review_front = REVIEW / front_path.name
    review_back = REVIEW / back_path.name
    shutil.move(str(front_path), str(review_front))
    shutil.move(str(back_path), str(review_back))

    # Insert into pending_scans (store R2 keys, not local paths)
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
                r2_front_key,
                r2_back_key,
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


def find_relay_pairs(directory: Path) -> list[tuple[Path, Path, dict]]:
    """Find image pairs in the relay folder using JSON sidecars.

    Relay uses _a (front) / _b (back) naming with a JSON sidecar per SKU.
    Returns (front, back, sidecar_data) tuples.
    """
    pairs = []
    for sidecar in sorted(directory.glob("*.json")):
        try:
            data = json.loads(sidecar.read_text())
        except (json.JSONDecodeError, OSError):
            continue

        front_name = data.get("front_image", "")
        back_name = data.get("back_image", "")
        front = directory / front_name
        back = directory / back_name

        if front.is_file() and back.is_file():
            pairs.append((front, back, data))
    return pairs


def process_relay_pair(front: Path, back: Path, sidecar: dict):
    """Process a pre-identified pair from Relay — skip AI, go straight to matching."""
    sku = sidecar.get("sku", front.stem)
    log.info(f"Relay import: {sku} ({sidecar.get('item_type', '?')})")

    # Move to processing
    proc_front = PROCESSING / front.name
    proc_back = PROCESSING / back.name
    sidecar_path = front.parent / f"{sku}.json"
    shutil.move(str(front), str(proc_front))
    shutil.move(str(back), str(proc_back))

    try:
        # If Relay already matched against GCD, use the issue_id directly
        gcd_issue_id = sidecar.get("gcd_issue_id")
        gcd_series_id = sidecar.get("gcd_series_id")
        series_name = sidecar.get("series_name", "")
        issue_number = str(sidecar.get("issue_number", "")).lstrip("#")

        if gcd_issue_id:
            # Fast path: Relay already did the GCD match — look up directly
            log.info(f"  GCD pre-matched: issue_id={gcd_issue_id}")
            conn = get_db_connection()
            try:
                cur = conn.cursor()
                cur.execute("""
                    SELECT i.id, i.number, s.id AS series_id, s.name AS series_name
                    FROM issues i JOIN series s ON i.series_id = s.id
                    WHERE i.id = %s
                """, (gcd_issue_id,))
                row = cur.fetchone()
            finally:
                conn.close()

            if row:
                confidence = 100
                match = {
                    "matched": True,
                    "confidence": confidence,
                    "issue_id": row[0],
                    "series_id": row[2],
                    "series_name": row[3],
                    "series_slug": slugify(row[3]),
                    "issue_number": row[1],
                }
                db_issue = row[1]
                series_name = row[3]
            else:
                log.warning(f"  GCD issue_id {gcd_issue_id} not found in DB, falling back to matcher")
                gcd_issue_id = None  # Fall through to matching

        if not gcd_issue_id:
            # Standard path: match using sidecar metadata
            front_data = {
                "title": series_name or sidecar.get("title", ""),
                "issue_number": issue_number,
                "publisher": sidecar.get("publisher", ""),
                "year": sidecar.get("year", ""),
                "variant": sidecar.get("variant", ""),
                "price": sidecar.get("aspects", {}).get("cover_price", ""),
            }
            log.info(f"  Sidecar data: {json.dumps(front_data)}")

            log.info("  Matching against database...")
            match = match_issue(front_data, None)
            confidence = match.get("confidence", 0)

            if not series_name or not issue_number:
                _send_to_review(
                    sku, proc_front, proc_back, front_data, {}, match,
                    f"relay import — missing {'title' if not series_name else 'issue_number'}",
                )
                if sidecar_path.exists():
                    sidecar_path.unlink()
                return

            if confidence < 80:
                _send_to_review(
                    sku, proc_front, proc_back, front_data, {}, match,
                    f"relay import — low confidence ({confidence}%)",
                )
                if sidecar_path.exists():
                    sidecar_path.unlink()
                return

            series_name = match.get("series_name", series_name)
            db_issue = match.get("issue_number", issue_number)

        proc_front = seo_rename(proc_front, series_name, db_issue, "front")
        proc_back = seo_rename(proc_back, series_name, db_issue, "back")

        # Duplicate guard: if this issue already has scans on disk, don't
        # overwrite. Back up the existing files to overwrites/ as a safety
        # belt and send the new pair to review — most likely a misidentified
        # book that needs human verification.
        dest_front = RELAY_DONE / proc_front.name
        dest_back = RELAY_DONE / proc_back.name
        if dest_front.exists() or dest_back.exists():
            log.warning(
                f"  ⚠️  {series_name} #{db_issue} already has scans — backing up and sending to review"
            )
            overwrites_dir = RELAY_DONE.parent / "overwrites"
            for existing in (dest_front, dest_back):
                backup = _backup_existing(existing, overwrites_dir)
                if backup:
                    log.info(f"  📦 Backed up existing: {backup.name}")
            front_data_for_review = {
                "title": series_name,
                "issue_number": db_issue,
                "publisher": sidecar.get("publisher", ""),
                "year": sidecar.get("year", ""),
                "variant": sidecar.get("variant", ""),
                "price": sidecar.get("aspects", {}).get("cover_price", ""),
            }
            _send_to_review(
                sku, proc_front, proc_back, front_data_for_review, {}, match,
                f"duplicate match — {series_name} #{db_issue} already has scans",
            )
            if sidecar_path.exists():
                sidecar_path.unlink()
            return

        log.info(f"  Uploading (confidence={confidence}%)...")
        result = upload_pair(proc_front, proc_back, match, PROCESSING)
        log.info(f"  Hensley: {result['hensley_front']}")

        # Move originals to Collectibot Completed
        RELAY_DONE.mkdir(parents=True, exist_ok=True)
        shutil.move(str(proc_front), str(RELAY_DONE / proc_front.name))
        shutil.move(str(proc_back), str(RELAY_DONE / proc_back.name))

        # Clean up sidecar
        if sidecar_path.exists():
            sidecar_path.unlink()

        log.info(f"  ✅ Relay import: {series_name} #{db_issue} ({confidence}%)")

    except Exception as e:
        log.error(f"  ❌ Error processing relay pair {sku}: {e}", exc_info=True)
        for p in [proc_front, proc_back]:
            if p.exists():
                shutil.move(str(p), str(RELAY / p.name))


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
        # Identify front cover only — back covers are just associated, not scanned
        log.info(f"  Identifying front: {proc_front.name}")
        front_data = identify_front(proc_front)
        log.info(f"  Front data: {json.dumps(front_data)}")

        # Match against database (no back cover data)
        log.info("  Matching against database...")
        match = match_issue(front_data, None)
        confidence = match.get("confidence", 0)

        # --- Validation gate ---
        title = front_data.get("title")
        issue_number = front_data.get("issue_number")
        year = _resolve_year(front_data, {}, match)

        if not title:
            _send_to_review(base, proc_front, proc_back, front_data, {}, match, "missing title")
            return

        if not issue_number:
            _send_to_review(base, proc_front, proc_back, front_data, {}, match, "missing issue_number")
            return

        if not year:
            _send_to_review(base, proc_front, proc_back, front_data, {}, match, "missing year")
            return

        if confidence < 80:
            _send_to_review(
                base, proc_front, proc_back, front_data, {}, match,
                f"low confidence ({confidence}%)",
            )
            return

        # --- All checks passed: auto-process ---
        series_name = match.get("series_name", title)
        db_issue = match.get("issue_number", issue_number)

        # SEO rename originals
        proc_front = seo_rename(proc_front, series_name, db_issue, "front")
        proc_back = seo_rename(proc_back, series_name, db_issue, "back")

        # Duplicate guard — same logic as process_relay_pair.
        dest_front = DONE / proc_front.name
        dest_back = DONE / proc_back.name
        if dest_front.exists() or dest_back.exists():
            log.warning(
                f"  ⚠️  {series_name} #{db_issue} already has scans — backing up and sending to review"
            )
            overwrites_dir = DONE.parent / "overwrites"
            for existing in (dest_front, dest_back):
                backup = _backup_existing(existing, overwrites_dir)
                if backup:
                    log.info(f"  📦 Backed up existing: {backup.name}")
            _send_to_review(
                base, proc_front, proc_back, front_data, {}, match,
                f"duplicate match — {series_name} #{db_issue} already has scans",
            )
            return

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


def wait_for_stable_files(directory: Path, interval: float = 1.0, required_stable: int = 3, timeout: float = 30.0):
    """Wait until all image files in directory stop changing size.

    Polls every `interval` seconds. Files are considered stable when their
    sizes haven't changed for `required_stable` consecutive checks.
    Gives up after `timeout` seconds with a warning.
    """
    stable_count = 0
    prev_sizes: dict[str, int] = {}
    start = time.time()

    while time.time() - start < timeout:
        current_sizes: dict[str, int] = {}
        for f in directory.iterdir():
            if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"}:
                try:
                    current_sizes[f.name] = f.stat().st_size
                except OSError:
                    pass

        if not current_sizes:
            return  # No image files

        if current_sizes == prev_sizes:
            stable_count += 1
            if stable_count >= required_stable:
                return
        else:
            stable_count = 0

        prev_sizes = current_sizes
        time.sleep(interval)

    log.warning(f"Files in {directory} did not stabilize within {timeout}s — proceeding anyway")


SCANNER_SETTLE_DELAY = 10  # Seconds to wait after files appear before processing


class RelayHandler(FileSystemEventHandler):
    """Watch the relay/ folder for pre-identified pairs from Relay."""
    def on_created(self, event):
        if event.is_directory:
            return
        # Only trigger on JSON sidecars (images arrive first, sidecar last)
        if not event.src_path.endswith(".json"):
            return
        # Brief pause to let any file copies finish
        time.sleep(2)
        while True:
            pairs = find_relay_pairs(RELAY)
            if not pairs:
                break
            try:
                process_relay_pair(pairs[0][0], pairs[0][1], pairs[0][2])
            except Exception as e:
                log.error(f"Relay unhandled error: {e}", exc_info=True)
                break


class InboxHandler(FileSystemEventHandler):
    def on_created(self, event):
        if event.is_directory:
            return
        # Wait until all files stop being written to (scanner temp files)
        wait_for_stable_files(INBOX)
        # Extra delay so user can click accept on scanner UI
        log.info(f"Files stable — waiting {SCANNER_SETTLE_DELAY}s for scanner UI...")
        time.sleep(SCANNER_SETTLE_DELAY)
        # Split any landscape images first
        split_all_in_directory(INBOX)
        # Process pairs one at a time, re-scanning after each
        while True:
            pairs = find_pairs(INBOX)
            if not pairs:
                break
            try:
                process_pair(pairs[0][0], pairs[0][1])
            except Exception as e:
                log.error(f"Unhandled error: {e}", exc_info=True)
                break


def main():
    kill_existing_watchers()

    for d in [INBOX, RELAY, RELAY_DONE, PROCESSING, DONE, REVIEW]:
        d.mkdir(parents=True, exist_ok=True)

    log.info(f"Watching: {INBOX}")
    log.info(f"Watching: {RELAY} (Relay imports)")
    log.info("Drop front/back pairs to begin processing.")
    log.info("Press Ctrl+C to stop.\n")

    # Process any relay pairs already waiting
    while True:
        pairs = find_relay_pairs(RELAY)
        if not pairs:
            break
        try:
            process_relay_pair(pairs[0][0], pairs[0][1], pairs[0][2])
        except Exception as e:
            log.error(f"Relay unhandled error: {e}", exc_info=True)
            break

    # Split any landscape images already in inbox
    split_all_in_directory(INBOX)

    # Process pairs one at a time, re-scanning after each
    while True:
        pairs = find_pairs(INBOX)
        if not pairs:
            break
        try:
            process_pair(pairs[0][0], pairs[0][1])
        except Exception as e:
            log.error(f"Unhandled error: {e}", exc_info=True)
            break

    observer = PollingObserver(timeout=5)
    observer.schedule(InboxHandler(), str(INBOX), recursive=False)
    observer.schedule(RelayHandler(), str(RELAY), recursive=False)
    observer.start()

    try:
        while True:
            time.sleep(10)
            # Periodic check for relay sidecars that events may have missed
            try:
                pairs = find_relay_pairs(RELAY)
                if pairs:
                    log.info(f"Periodic check: found {len(pairs)} relay pair(s)")
                    for front, back, data in pairs:
                        process_relay_pair(front, back, data)
            except Exception as e:
                log.error(f"Relay periodic check error: {e}", exc_info=True)
    except KeyboardInterrupt:
        log.info("Stopping watcher...")
        observer.stop()
    observer.join()


if __name__ == "__main__":
    main()
