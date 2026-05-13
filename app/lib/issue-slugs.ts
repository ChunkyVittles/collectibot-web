// Single-issue slug pilot map. Will be replaced by a slug column on issues
// when the full migration runs. Until then, just one entry — Conan the
// Barbarian #1 (Marvel, October 1970, issue 23540).
export const SLUG_TO_ID: Record<string, string> = {
  "conan-the-barbarian-1-marvel-1970": "23540",
};

export const ID_TO_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(SLUG_TO_ID).map(([slug, id]) => [id, slug]),
);

export function resolveIssueId(param: string): string {
  return SLUG_TO_ID[param] ?? param;
}

export function slugForIssueId(id: number | string): string | null {
  return ID_TO_SLUG[String(id)] ?? null;
}
