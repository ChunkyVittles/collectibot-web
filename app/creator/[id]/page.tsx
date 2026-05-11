import pool from "@/app/lib/db";
import CreatorPageClient from "./CreatorPageClient";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const result = await pool.query<{
    name: string;
    birth_year: number | null;
    death_year: number | null;
    birth_country: string | null;
    bio: string | null;
  }>(
    `SELECT name, birth_year, death_year, birth_country, bio
     FROM creators WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return { title: "Creator Not Found - Collectibot" };
  const c = result.rows[0];

  const years = c.birth_year
    ? ` (${c.birth_year}${c.death_year ? `–${c.death_year}` : ""})`
    : "";
  const title = `${c.name}${years} - Collectibot`;

  const descBits = [`${c.name}${years}`];
  if (c.birth_country) descBits.push(`from ${c.birth_country}`);
  descBits.push("comic book credits and creative contributions");
  const description = descBits.join(", ") + ".";

  return { title, description };
}

export default function Page() {
  return <CreatorPageClient />;
}
