import pool from "@/app/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import PostcardDetail from "@/app/components/PostcardDetail";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const result = await pool.query<{ description: string | null; postmark_city: string | null; postmark_state: string | null }>(
    `SELECT description, postmark_city, postmark_state FROM postcards WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return { title: "Postcard Not Found" };
  const pc = result.rows[0];
  const location = [pc.postmark_city, pc.postmark_state].filter(Boolean).join(", ");
  return {
    title: `${pc.description || "Vintage Postcard"}${location ? ` - ${location}` : ""} - Collectibot`,
    description: pc.description || "Vintage postcard scan",
  };
}

export default async function PostcardPage({ params }: Props) {
  const { id } = await params;

  const result = await pool.query<{
    id: number;
    description: string | null;
    publisher: string | null;
    postmark_city: string | null;
    postmark_state: string | null;
    postmark_country: string | null;
    postmark_year: number | null;
    era: string | null;
    artist: string | null;
    subject_tags: string[] | null;
  }>(
    `SELECT id, description, publisher, postmark_city, postmark_state, postmark_country, postmark_year, era, artist, subject_tags
     FROM postcards WHERE id = $1`,
    [id]
  );

  if (result.rows.length === 0) return notFound();
  const pc = result.rows[0];

  const scansRes = await pool.query<{ scan_type: string }>(
    `SELECT scan_type FROM scans WHERE postcard_id = $1`,
    [id]
  );
  const hasFront = scansRes.rows.some(r => r.scan_type === "postcard_front");
  const hasBack = scansRes.rows.some(r => r.scan_type === "postcard_back");

  const cookieStore = await cookies();
  const isAdmin = cookieStore.get("cb_auth")?.value === "Testing123";

  return (
    <div style={{ maxWidth: 700, margin: "40px auto", padding: "0 20px", fontFamily: "system-ui" }}>
      <Link href="/postcards" style={{ color: "#666", textDecoration: "none" }}>&larr; All Postcards</Link>

      <PostcardDetail
        postcard={pc}
        hasFront={hasFront}
        hasBack={hasBack}
        isAdmin={isAdmin}
        cacheBust={Date.now()}
      />
    </div>
  );
}
