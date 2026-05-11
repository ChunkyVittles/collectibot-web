# Collectibot schema audit — Phase 0

Date: 2026-05-11
Database: `collectibot` on `172.234.24.65:5433`
Method: read-only `\d+`, `COUNT(*)`, `ORDER BY id LIMIT 3`, and
`count(col) * 100.0 / count(*)` per column.

---

## TL;DR for Phase 1 scoping

**Schema is much thinner than full GCD.** The import gave us series,
issues, publishers, creators, issue-level credits, characters, and key
issues. **Per-story data, character appearances, reprints, awards,
genres, and series relations were not imported.** Several columns
asked about in the prompt also don't exist (notably `issues.title`,
`series.notes`, `creators.pseudonyms`).

Major Phase 1 implications:

- **Task 1.2 "Stories" section: cannot build.** No `stories` /
  `sequences` table, no `story_credits`. Fall back to `issue_credits`
  grouped by role (which is what already exists on the page).
- **Task 1.2 "Characters appearing": cannot build.** No
  `story_characters` / appearances table. Characters exist as a
  catalog but aren't linked to issues.
- **Task 1.2 "Reprints": cannot build.** No `reprints` table.
- **Task 1.4 /character/[id]: significantly degraded.** The character
  catalog exists (68k rows) but with no appearances link, all the
  meaty sections (Appearances, Co-stars, Created by, First-appearance
  callout) collapse to nothing. Page becomes a stub: name +
  disambiguation + description + year_first_published. Recommend
  deferring this entire tier or building it as catalog-only.
- **Task 1.5 /genre/[slug]: cannot build.** No genres table, no
  `series.genre` column.
- **Task 1.1 "Recurring characters": cannot build.** Same root cause.
- **Task 1.1 "About this series" prose: no source data.** Series has
  no notes / tracking_notes / publication_notes columns. Best we can
  do is a synthesized paragraph from year range + publisher + country
  + format.
- **Variants are usable**: `issues.variant_of_id` is populated on
  9.3% of issues (~240k variant printings).
- **issue_credits is rich** (5.7M rows): writer/penciler/inker/
  colorist/letterer/editor breakouts work great. **There is no
  "cover" credit type** — cover artist must be inferred (fallback:
  use pencillers).
- **key_issues is useful** (230k rows) for issue-detail callouts and
  series-level "Key issues" sections, but only 40% have a
  `key_comment_1`; the other 60% are art credit annotations only.

---

## All public tables

```
characters            68,049
creators             103,580
entities                  11
issue_credits      5,727,459
issues             2,569,488
key_issues           230,408
pending_scans              1
postcards                  2
products                   0
publisher_entity_map       2
publishers            17,468
scans                    616
series               227,083
series_settings            3
users                      1
```

15 tables. No tables exist whose name contains `story`, `reprint`,
`award`, `feature`, `genre`, `indicia`, `brand`, or
`character_appearance`. The only table containing "cover" anywhere is
the `scan_type` enum value `front_cover`/`back_cover` inside `scans`.

---

## Existing tables — full detail

### `series` (227,083 rows)

```
 id              bigint   NOT NULL  PK
 name            text     NOT NULL
 sort_name       text
 year_began      integer
 year_ended      integer
 publisher_id    bigint   FK → publishers(id)
 country         text
 language        text
 format          text
 issue_count     integer  default 0
 is_current      boolean  default false
 gcd_series_id   integer  UNIQUE
```

Indexes: PK on id, btree on publisher_id, unique on gcd_series_id.

**Population:**

| column | populated |
|---|---|
| sort_name | 100.0% |
| year_began | 100.0% |
| year_ended | 88.0% |
| publisher_id | 100.0% |
| country | 100.0% |
| language | 100.0% |
| **format** | **0.0%** (column empty across all 227k rows) |
| issue_count (>0) | 99.2% |
| is_current (true) | 7.1% |

**Sample rows:**

```
id=1   name="Two Hundred Sketches Humorous and Grotesque"  year=1867   country=US     language=en  publisher_id=34945  format=∅
id=2   name="A Bushel of Merry-Thoughts"                   year=1868   country=UK     language=en  publisher_id=34937  format=∅
id=3   name="Ye Veracious Chronicle of Gruff & Pompey..."  year=1870   country=US     language=en  publisher_id=34938  format=∅
```

**Columns asked about but NOT present:**
`notes`, `tracking_notes`, `publication_notes`, `color`, `dimensions`,
`paper_stock`, `binding`, `genre`.

---

### `issues` (2,569,488 rows)

```
 id                bigint        NOT NULL  PK
 series_id         bigint        FK → series(id)
 number            text
 volume            text
 key_date          text           -- "YYYY-MM-00" sortable
 publication_date  text           -- free-form, e.g. "March 1971"
 on_sale_date      text
 price             text           -- e.g. "0.25 USD"
 page_count        numeric(10,3)
 barcode           text
 isbn              text
 variant_of_id     bigint         FK → issues(id) (self)
 variant_name      text
 is_indexed        boolean        default false
 gcd_issue_id      integer        UNIQUE
 cgc_comic_id      integer
```

Indexes: PK, btree on series_id, key_date, barcode, isbn,
variant_of_id, cgc_comic_id; unique on gcd_issue_id.

**Population:**

| column | populated |
|---|---|
| series_id | 100.0% |
| number | 100.0% |
| volume | 10.7% |
| key_date | 39.8% |
| publication_date | 35.8% |
| on_sale_date | 26.8% |
| price | 39.2% |
| page_count | 37.8% |
| barcode | 16.1% |
| isbn | 8.8% |
| variant_of_id | 9.3% (≈ 239k variant printings) |
| variant_name | 11.7% |

**Sample rows:**

```
id=1  series_id=1  number="[nn]"   key_date=1867-00-00  pub_date=1867              price="[none]"  pages=96.000
id=2  series_id=2  number="[nn]"   key_date=1868-00-00  pub_date=1868              price="[none]"  pages=134.000
id=3  series_id=3  number="[nn]"   key_date=1870-00-00  pub_date="[circa 1870's]"  price="[none]"  pages=16.000
```

**Columns asked about but NOT present:**
`title`, `indicia_frequency`, `rating`, `notes`, `editing`,
`brand_id`, `indicia_publisher_id`.

**Important caveat:** key_date and publication_date are TEXT fields,
not timestamps. Format is `YYYY-MM-DD` or `YYYY-MM-00` or free-form.
Year extraction needs regex. ~60% of issues have neither.

---

### `publishers` (17,468 rows)

```
 id                bigint   NOT NULL  PK
 name              text     NOT NULL
 country           text
 year_began        integer
 year_ended        integer
 gcd_publisher_id  integer  UNIQUE
```

**Population:**

| column | populated |
|---|---|
| country | 100.0% |
| year_began | 83.8% |
| year_ended | 40.1% |

**Sample rows:**

```
id=34937  name="Sampson Low"               country=UK  year_began=1848  year_ended=1964
id=34938  name="C.A. Jackson & Co.; ..."   country=US  year_began=1870  year_ended=∅
id=34939  name="Chatto & Windus"           country=UK  year_began=1873  year_ended=1969
```

No `notes` or `description` field. Publisher pages will be a list view
only — name + country + year range + child entities (series, creators).

---

### `creators` (103,580 rows)

```
 id              bigint   NOT NULL  PK
 name            text     NOT NULL
 sort_name       text
 bio             text
 birth_year      integer
 birth_city      text
 birth_country   text
 death_year      integer
 slug            text     UNIQUE
 gcd_creator_id  integer  UNIQUE
```

**Population:**

| column | populated |
|---|---|
| sort_name | 100.0% |
| **bio** | **7.8%** (≈ 8,000 creators with prose) |
| birth_year | 27.5% |
| birth_city | 20.8% |
| birth_country | 41.8% |
| death_year | 9.7% |
| slug | 100.0% |

**Sample rows:**

```
id=308  name="Jack Kirby"  slug=jack-kirby   bio="American comic book artist, widely regarded as one of the medium's major innovators..."  birth=1917  death=1994  birth_country=US
id=309  name="手塚治虫"     slug=手塚治虫       bio="Osamu Tezuka was a Japanese manga artist..."                                                birth=1928  death=1989  birth_country=Japan
id=312  name="Robert Crumb" slug=robert-crumb bio="Robert Crumb is an American comic artist..."                                                birth=1943  death=∅      birth_country=US
```

**Columns asked about but NOT present:**
`death_country`, `notes`, `pseudonyms` / `aliases`.

**Caveat:** the bio coverage (~8k creators) is the long tail of
recognized industry names. Most of the 95k other creators are bare
name+slug records.

---

### `issue_credits` (5,727,459 rows)

```
 id           bigint  NOT NULL  PK
 issue_id     bigint  NOT NULL  FK → issues(id)
 creator_id   bigint  NOT NULL  FK → creators(id)
 credit_type  text    NOT NULL
 credited_as  text                          -- alias used on cover, mostly empty
```

Indexes: PK, btree on issue_id, creator_id, credit_type;
UNIQUE(issue_id, creator_id, credit_type).

**`credit_type` distribution:**

```
inks      1,680,935
pencils   1,673,999
script    1,146,847
colors      687,760
letters     474,454
editing      63,464
```

**No `cover` credit type.** Cover artist must be inferred (the
existing `gcd_lookup` falls back to pencillers).

**Sample rows:**

```
issue_id=1  creator_id=15506  credit_type=inks
issue_id=1  creator_id=15506  credit_type=pencils
issue_id=1  creator_id=15506  credit_type=script
```

`credited_as` is populated only when the cover-printed name differs
from the canonical creator name (e.g. pseudonyms). Most rows have it
blank.

---

### `characters` (68,049 rows)

```
 id                    bigint   NOT NULL  PK
 name                  text     NOT NULL
 sort_name             text
 disambiguation        text
 universe              text
 year_first_published  integer
 description           text
 slug                  text     UNIQUE
 gcd_character_id      integer  UNIQUE
```

**Population:**

| column | populated |
|---|---|
| sort_name | 100.0% |
| disambiguation | 88.4% |
| **universe** | **2.7%** |
| year_first_published | 80.5% |
| description | 25.6% |
| slug | 100.0% |

**Sample rows:**

```
id=1  name="Corto Maltese"  slug=corto-maltese    universe=∅  year_first=1967  description="Corto Maltese è un marinaio avventuroso..."
id=3  name="Corto Maltese"  slug=corto-maltese-3  universe=∅  year_first=1970  description="Corto Maltese est un marin aventurier..."
id=6  name="Space Ghost"    slug=space-ghost      universe=∅  year_first=1967  description="Space Ghost is an interstellar cop based on the Ghost Planet..."  disambiguation="Hanna-Barbera super-hero"
```

**Critical gap:** **no table linking characters to issues**. The
prompt notes this gap was intentional (`character_appearances` was
removed due to corrupt GCD linkages). There is no way to compute
appearances, co-stars, or "first appearance issue" from the current
schema. The catalog exists; the relationships do not.

Some descriptions are non-English (Italian, French, etc.) — language
of description is not flagged.

---

### `key_issues` (230,408 rows)

```
 id             bigint   NOT NULL  PK
 issue_id       bigint   FK → issues(id)
 key_comment_1  text
 key_comment_2  text
 key_comment_3  text
 art_comment_1  text
 art_comment_2  text
 art_comment_3  text
 cgc_comic_id   integer
```

**Population:**

| column | populated |
|---|---|
| issue_id | 100.0% |
| **key_comment_1** | 40.0% |
| key_comment_2 | 16.0% |
| key_comment_3 | 5.7% |
| art_comment_1 | 93.4% |
| art_comment_2 | 83.7% |
| art_comment_3 | 60.3% |

**Sample rows:**

```
issue_id=49111   key_comment_1="\"Season of Mists\" part 5."           art_comments=["Neil Gaiman story","Kelley Jones & Geroge Pratt art","Dave McKean cover"]
issue_id=51903   key_comment_1="Delirium appearance."                   art_comments=["Neil Gaiman story","Jill Thompson & Vince Locke art","Dave McKean cover"]
issue_id=260068  key_comment_1="1st appearance of Allison Mann's clones." art_comments=["Brian K. Vaughan story","Pia Guerra & Jose Marzan Jr. art","Massimo Carnevale cover"]
```

**Implication:** key_issues covers ~9% of all issues (230k / 2.57M).
For Task 1.1's "Key issues" section, filter by `key_comment_1 IS NOT
NULL` — about 92k rows are real key issues, the rest are just
creator-credit annotations harvested from CGC.

**Important:** the art_comment fields often name the cover artist
explicitly (e.g. "Dave McKean cover"). When `issue_credits` has no
cover credit type, parsing art_comment_3 may be the only way to get
the cover artist.

---

### `scans` (616 rows)

```
 id             bigint                    NOT NULL  PK
 issue_id       bigint                    FK → issues(id)
 postcard_id    bigint                    FK → postcards(id)
 scan_type      text
 image_url      text
 contributor_id bigint                    FK → users(id)
 rights_granted text
 uploaded_at    timestamp with time zone  default now()
```

**`scan_type` distribution:**

```
front_cover     306
back_cover      306
postcard_front    2
postcard_back     2
```

So **306 unique issues currently have both front+back cover scans**,
and **2 postcards**. This is the universe of "rich" pages with imagery
right now.

`scans.uploaded_at` is the only `updated_at`-like column anywhere in
the schema — usable for sitemap `lastModified` on pages that link to
scans.

---

### `postcards` (2 rows)

```
 id                bigint   PK
 publisher         text
 postmark_city     text
 postmark_state    text
 postmark_country  text
 postmark_year     integer
 artist            text
 subject_tags      text[]
 description       text
 era               text
 scan_id           bigint   FK → scans(id)
```

Postcard tier is barely populated. Existing `/postcards/*` pages will
function but have almost no content to render until the pipeline runs
at scale.

---

### `entities` (11 rows) + `publisher_entity_map` (2 rows)

```
 entities:
   id, name, slug, entity_type, parent_id, active_from, active_to,
   description, notes, gcd_publisher_id, created_at
```

Hand-curated publisher hierarchy (Goodman → Timely → Atlas → Marvel
Comics Group → Marvel Comics → Marvel Worldwide; New World Pictures
parent). 11 rows total. `publisher_entity_map` has only 2 mappings.

**This table is essentially unused right now.** Not safe to lean on
for Phase 1, but worth noting it exists if/when publisher
disambiguation becomes a feature.

---

### `products` (0 rows)

Empty. Future-use table for non-comic items. Ignore for Phase 1.

---

### `series_settings` (3 rows)

```
 series_id       bigint   PK
 hero_issue_id   bigint   FK → issues(id)
 updated_at      timestamp with time zone
```

Admin tool: lets you pick which issue's cover represents the series
in listings. 3 rows so far. Useful for Task 1.1's series hero image.

---

### `pending_scans` (1 row) + `users` (1 row)

Operational tables (review queue + admin account). Not relevant to
public-facing SEO content.

---

## Tables that DO NOT exist

The prompt asked about each of these — they are absent:

| asked | status |
|---|---|
| `stories` / `sequences` / `gcd_story` | **NOT FOUND** |
| `story_credits` | **NOT FOUND** |
| `story_characters` / `character_appearances` | **NOT FOUND** |
| `reprints` / `reprint_links` / `gcd_reprint_link` | **NOT FOUND** |
| `awards` | **NOT FOUND** |
| `genres` | **NOT FOUND** |
| `features` | **NOT FOUND** |
| `series_relations` (predecessor/successor) | **NOT FOUND** |
| `variants` (standalone) | **NOT FOUND** (use `issues.variant_of_id`) |
| `indicia_publishers` / `brands` | **NOT FOUND** |

No `cover_credits` table either — and no `cover` row in
`issue_credits.credit_type`. Cover artist is structurally unavailable
except via parsing `key_issues.art_comment_*`.

---

## Other tables found

Listed earlier and not in the original ask:

- `entities`, `publisher_entity_map` — manual publisher hierarchy
- `products` — empty, future use
- `series_settings` — admin hero-issue picker
- `pending_scans` — review queue
- `users` — admin accounts
- `scans` — uploaded cover images (linked to issues OR postcards)
- `postcards` — postcard metadata

---

## Recommended scope adjustments for Phase 1

### Task 1.1 — /series/[id]

| section | viable? | notes |
|---|---|---|
| About this series (notes/tracking_notes prose) | **no** | no source columns. Can synthesize from year + publisher + country + issue_count instead. |
| Details block (country, language, format, etc.) | partial | country/language only. format is 0% populated. Drop dimensions/binding/paper_stock/genre. |
| Series relationships | **no** | no series_relations table. |
| Featured creators (top N by credit count) | **yes** | issue_credits JOIN. Strong content. |
| Recurring characters | **no** | no character→issue link. |
| Key issues | **yes** (filtered to key_comment_1 IS NOT NULL) | use key_issues join. |
| Existing issue timeline | **yes** | already there. Add on_sale_date column. |

### Task 1.2 — /issue/[id]

| section | viable? | notes |
|---|---|---|
| Issue title h2 | **no** | issues.title doesn't exist. |
| Stories section | **no** | no stories table. |
| Credits section (issue_credits by role) | **yes** | already strong. Add editor row. Cover artist is fuzzy — see below. |
| Cover artist | partial | not in issue_credits.credit_type. Parse `key_issues.art_comment_3` (often says "X cover") for ~8% of issues; fall back to first penciler. |
| Characters appearing | **no** | no link. |
| Variants | **yes** | use variant_of_id. |
| Reprints | **no** | no reprints table. |
| Details block (rating/indicia/brand/etc.) | partial | rating/indicia_frequency/notes/editing/brand_id/indicia_publisher_id all MISSING. Render what we have: page_count, barcode, isbn, on_sale_date, price. |

### Task 1.3 — /creator/[id]

| section | viable? | notes |
|---|---|---|
| SSR the credit table | **yes** | direct port from CreatorPageClient. |
| Filter island (type + publisher) | **yes** | keep as client island. |
| Co-creations (creators on first-appearance issue) | **no** | no story_credits + no first-appearance link. |
| Frequent collaborators | **yes** | issue_credits self-join. Performance: needs careful query (5.7M rows). |
| Publishers worked for | **yes** | issue_credits → issues → series → publishers. |
| Awards | **no** | no table. |
| Pseudonyms / aliases | **no** | no column on creators. `credited_as` exists at row level on issue_credits and could be aggregated, but it's mostly empty. |
| Full bio + death info | **yes**, where populated (bio 7.8%, death_year 9.7%) | |

### Task 1.4 — /character/[id]

Recommend **deferring this entire task** to a future PR.

Without character→issue linkage, the page collapses to: name +
disambiguation + universe (2.7% pop) + year_first_published (80.5%) +
description (25.6%, often non-English). No appearances, no co-stars,
no first-appearance issue link, no creator credit on first appearance.

If you still want a character catalog for SEO surface area (68k URLs
of low-thinness content), it can ship — but it'll be flagged
thin-content by Google unless we bulk in the appearance data first.
Better to build the import pipeline for appearances first, then build
the page.

### Task 1.5 — entity hubs

| page | viable? | notes |
|---|---|---|
| /publisher/[id] | **yes** | list series + top creators (via issue_credits JOIN issues JOIN series). No "top characters" section. |
| /genre/[slug] | **no** | no genre column, no genres table. **Cut entirely.** |

---

## Other notes affecting later phases

- **No `updated_at` column** exists on series, issues, creators,
  publishers, characters, or key_issues. For sitemap `lastModified`,
  the only timestamp we can use is `scans.uploaded_at` (and only for
  pages with scans). For everything else, omit lastModified.
- **Issue dates are TEXT, not dates.** `key_date` is the most reliable
  sortable column ("YYYY-MM-00" or "YYYY-MM-DD"). Plan for parsing.
- **No issue titles.** Every page title format that included
  `{title?}` should drop that segment.
- **`issues.publication_date` is free-form prose** including values
  like `"[circa 1870's]"` and `"March 1971"`. SEO titles built from
  this need a parser/normalizer.

---

## Stop point

Per Phase 0 instructions, stopping here. Awaiting your "go" with
direction on:

1. Whether to defer Task 1.4 (character pages) entirely, or ship a
   catalog-only stub.
2. Whether Task 1.2 should attempt cover-artist parsing from
   `key_issues.art_comment_3`, or just omit cover artist for now.
3. Whether to synthesize a Phase 1 "About this series" paragraph from
   structured fields (year + publisher + format + issue count) or
   omit the section entirely.
4. Confirmation that /genre/[slug] is cut.
