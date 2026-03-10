import { NextRequest, NextResponse } from "next/server";
import pool from "@/app/lib/db";

type Props = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;

  const creatorRes = await pool.query(
    `SELECT id, name, sort_name, bio, birth_year, birth_city, birth_country, death_year
     FROM creators
     WHERE id = $1`,
    [id]
  );

  if (creatorRes.rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const creator = creatorRes.rows[0];

  const creditsRes = await pool.query(
    `SELECT ic.credit_type,
            i.id AS issue_id, i.number, i.key_date,
            s.id AS series_id, s.name AS series_name,
            p.name AS publisher,
            (SELECT ki.key_comment_1 FROM key_issues ki
             WHERE ki.issue_id = i.id AND ki.key_comment_1 IS NOT NULL
             LIMIT 1) AS key_comment_1
     FROM issue_credits ic
     JOIN issues i ON ic.issue_id = i.id
     JOIN series s ON i.series_id = s.id
     LEFT JOIN publishers p ON s.publisher_id = p.id
     WHERE ic.creator_id = $1
     ORDER BY i.key_date ASC NULLS LAST, s.name, i.number`,
    [id]
  );

  return NextResponse.json({
    creator,
    credits: creditsRes.rows,
    total: creditsRes.rows.length,
  });
}
