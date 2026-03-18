import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { id, publisher, postmark_city, postmark_state, postmark_country, postmark_year, artist, subject_tags, description, era } = body;

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  await pool.query(
    `UPDATE postcards SET
       publisher = $2,
       postmark_city = $3,
       postmark_state = $4,
       postmark_country = $5,
       postmark_year = $6,
       artist = $7,
       subject_tags = $8,
       description = $9,
       era = $10
     WHERE id = $1`,
    [id, publisher || null, postmark_city || null, postmark_state || null, postmark_country || null, postmark_year || null, artist || null, subject_tags || [], description || null, era || null]
  );

  return NextResponse.json({ ok: true });
}
