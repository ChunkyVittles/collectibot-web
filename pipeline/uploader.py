"""
uploader.py — Convert images to WebP, upload to R2, insert into database.
"""

import os
import shutil
from pathlib import Path

import boto3
import psycopg2
from PIL import Image
from dotenv import load_dotenv

from matcher import slugify

load_dotenv(Path(__file__).parent / ".env")

HENSLEY_DIR = Path("/Users/davidbull/Desktop/Hensley")
MAX_WIDTH = 900
WEBP_QUALITY = 85


def get_r2_client():
    account_id = os.getenv("R2_ACCOUNT_ID")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=os.getenv("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY"),
        region_name="auto",
    )


def get_db_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT", "5433")),
        dbname=os.getenv("DB_NAME", "collectibot"),
        user=os.getenv("DB_USER", "collectibot"),
        password=os.getenv("DB_PASSWORD", ""),
    )


def convert_to_webp(src: Path, dst: Path) -> Path:
    """Convert image to WebP, max 900px wide, 85% quality."""
    img = Image.open(src)
    if img.width > MAX_WIDTH:
        ratio = MAX_WIDTH / img.width
        new_size = (MAX_WIDTH, int(img.height * ratio))
        img = img.resize(new_size, Image.LANCZOS)
    img.save(dst, "WEBP", quality=WEBP_QUALITY)
    return dst


def upload_pair(
    front_path: Path,
    back_path: Path,
    match_result: dict,
    tmp_dir: Path | None = None,
) -> dict:
    """
    Convert both images to WebP, upload to R2, insert into DB, copy to Hensley.
    Returns dict with URLs and DB IDs.
    """
    series_slug = match_result["series_slug"]
    issue_id = match_result["issue_id"]
    issue_number = match_result["issue_number"]

    work_dir = tmp_dir or front_path.parent

    # Convert to WebP
    front_webp = work_dir / f"{issue_id}_F.webp"
    back_webp = work_dir / f"{issue_id}_B.webp"
    convert_to_webp(front_path, front_webp)
    convert_to_webp(back_path, back_webp)

    # R2 paths
    r2_front = f"comics/{series_slug}/{issue_id}_F.webp"
    r2_back = f"comics/{series_slug}/{issue_id}_B.webp"
    bucket = os.getenv("R2_BUCKET", "collectibot-scans")

    # Upload to R2
    r2 = get_r2_client()
    r2.upload_file(str(front_webp), bucket, r2_front, ExtraArgs={"ContentType": "image/webp"})
    r2.upload_file(str(back_webp), bucket, r2_back, ExtraArgs={"ContentType": "image/webp"})

    # Build public URLs
    front_url = f"https://{bucket}.r2.dev/{r2_front}"
    back_url = f"https://{bucket}.r2.dev/{r2_back}"

    # Insert into scans table
    conn = get_db_connection()
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO scans (issue_id, scan_type, image_url, contributor_id, rights_granted)
               VALUES (%s, %s, %s, %s, %s) RETURNING id""",
            (issue_id, "front_cover", front_url, 1, "true"),
        )
        front_scan_id = cur.fetchone()[0]

        cur.execute(
            """INSERT INTO scans (issue_id, scan_type, image_url, contributor_id, rights_granted)
               VALUES (%s, %s, %s, %s, %s) RETURNING id""",
            (issue_id, "back_cover", back_url, 1, "true"),
        )
        back_scan_id = cur.fetchone()[0]

        conn.commit()
    finally:
        conn.close()

    # Copy to Hensley output folder
    hensley_front = HENSLEY_DIR / f"{series_slug}_{issue_number}_F.webp"
    hensley_back = HENSLEY_DIR / f"{series_slug}_{issue_number}_B.webp"
    shutil.copy2(front_webp, hensley_front)
    shutil.copy2(back_webp, hensley_back)

    # Clean up temp webp if in work dir
    if tmp_dir:
        front_webp.unlink(missing_ok=True)
        back_webp.unlink(missing_ok=True)

    return {
        "front_url": front_url,
        "back_url": back_url,
        "front_scan_id": front_scan_id,
        "back_scan_id": back_scan_id,
        "hensley_front": str(hensley_front),
        "hensley_back": str(hensley_back),
    }
