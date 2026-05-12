# AI-generated creator bios — followup spec

Placeholder for a future PR. Not building this now. The structured
`<CreatorAbout />` covers the immediate SEO need; this replaces it with
original prose once the pipeline ships.

## Goal

Original 2–3 paragraph bios for top-N creators, cached in the DB.
Focused on the work documented in our database, not generic biography
material. Avoids the duplicate-content penalty of rendering GCD's
imported bios verbatim.

## Schema additions

```sql
ALTER TABLE creators
  ADD COLUMN bio_rewritten         text,
  ADD COLUMN bio_rewritten_at      timestamptz,
  ADD COLUMN bio_rewritten_sources jsonb;
```

`bio_rewritten_sources` stores the inputs the LLM was given (GCD bio
text, Wikipedia article URL + revision id, structured facts snapshot)
so we can rerun deterministically and audit.

## Selection

Rank creators by total credit count from `issue_credits`. Generate the
top 5,000 first. Reasonable batch sizes: ~200/run, idempotent so a
failed batch can be reattempted without dupes.

## Inputs per creator

- Existing `creators.bio` (token-resolved — GCD wiki-style links
  need to be flattened before sending to the LLM).
- Wikipedia article fetched by exact name match where one exists;
  fall back to disambiguated lookup using `birth_year` /
  `birth_country` when needed.
- Structured facts snapshot from our DB:
    - First/last credit year, peak decade
    - Top 5 publishers with credit counts
    - Top 5 collaborators with shared-credit counts
    - Top 5 series with credit counts
    - Notable key-issue annotations on issues this creator worked on

## Prompt direction

Synthesize original prose focused on the work in our database. 2–3
paragraphs. The structured facts are the spine; the GCD bio and
Wikipedia article are background context for voice and accuracy.

Hard rules the prompt must enforce:

- **Never copy GCD or Wikipedia prose verbatim.** Rewrite in our own
  voice. Reject output exceeding N% similarity to either source via
  shingled-substring check; auto-retry with stricter instruction.
- **Names of works are facts and must stay accurate.** Series titles,
  publisher names, creator names, character names, dates — these are
  not "prose" to rewrite, they're identifiers. Don't paraphrase them.
- **No external links in body prose.** No `<a href="https://...">`
  anywhere in the rendered bio body. Do not link to Wikipedia, GCD,
  or any outside site.
- **Internal Collectibot links are encouraged.** When the prose names
  an entity that has a Collectibot page (creator, series, publisher,
  character), wrap the name in a `<Link href="/...">`. The prompt
  output should be plain text with entity markers (e.g.
  `{{creator:308}}Jack Kirby{{/creator}}`) that a post-processor
  converts to React `<Link>` elements at render time.
- **Factually accurate or omitted.** If a fact can't be cross-verified
  between sources or against our structured data, leave it out. Don't
  hallucinate first appearances, awards, or dates.
- **No verbatim quotes.** No block quotes from any source.

## Output rendering

In `app/creator/[id]/page.tsx`:

- When `creators.bio_rewritten` is non-null, render it as prose
  paragraphs above the credits table. Pass through a small
  post-processor that converts entity markers (`{{creator:308}}...`)
  into `<Link>` elements pointing at Collectibot pages.
- Always render `<CreatorAbout />` underneath the prose (or as the
  sole content when `bio_rewritten` is null). The structured About is
  the permanent fallback — never deprecated.
- Attribution: if any non-trivial fact came from GCD or Wikipedia,
  render a small "Sources" line at the bottom of the bio block,
  outside the prose itself, linking to the source pages. This keeps
  the body link-free while honoring CC-BY / fair-use expectations.

## Admin tooling

- `/admin/creator/[id]` page (new) with:
    - View current `bio_rewritten` + sources.
    - "Regenerate" button — triggers the pipeline for this single
      creator.
    - In-page editor to hand-edit the result and save.
    - "Clear" button — sets `bio_rewritten = NULL`, reverts to
      structured About.

## Open questions

- Which LLM. Claude is the obvious default for tone consistency with
  the rest of Collectibot's content.
- Bot/AI content detection: do we attribute the bios as
  AI-assisted? (Probably yes, in a small line below the prose, for
  trust + future-proofing.)
- Wikipedia licensing — CC-BY-SA. Need a clear policy on whether the
  generated bios are derived works requiring attribution. Likely
  yes; add a "Sources" link block.
