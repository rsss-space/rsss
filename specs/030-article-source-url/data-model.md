# Phase 1 Data Model: Show Article Source URL

This feature introduces **no new entities, fields, columns, or
migrations**. It renders an existing field. This document records the
existing shape it depends on so the no-change claim is auditable.

## Entity: Item (existing — unchanged)

Defined in `src/client/db/types.ts`. The only field this feature reads
that is not already rendered as text is `link`.

| Field        | Type            | Used by this feature?                  |
|--------------|-----------------|----------------------------------------|
| `id`         | `number`        | No (list key only)                     |
| `feed_id`    | `number`        | No                                     |
| `title`      | `string\|null`  | No (existing `.item-title`)            |
| `link`       | `string\|null`  | **Yes** — the post URL to display      |
| `feed_title` | `string` (opt)  | No (existing `.item-feed`, "culture latest") |
| `pub_date`   | `string\|null`  | No (existing `.item-date`)             |
| ...rest      | (various)       | No                                     |

### Field: `link`

- **Meaning**: The article's own post URL (where the item points).
- **Source of truth**: Durable Object SQLite `items.link`, surfaced
  through `/api/sync` and the remote adapter, mirrored into the local
  OPFS-SQLite `items` table and returned by `loadItems()`. Already
  populated for existing rows — no backfill required.
- **Nullability**: `string|null`. Items without a usable link have
  `null` (or empty/whitespace), which drives the FR-004 omission.
- **Validation / rendering rules**:
  - Render only when the trimmed value is a non-empty string; otherwise
    omit the `.item-url` element entirely (no placeholder, no blank
    line). This mirrors how `imageUrl = item.og_image_url?.trim()`
    already guards thumbnail rendering in the same component.
  - Display the value verbatim (no normalization, no query-param
    stripping). Long values are constrained by CSS, not by truncating
    the string.

## Schema / sync impact

None. Per Constitution Principle II's coupled-change rule, a change is
only "coupled" when it adds or modifies a column the client renders.
`link` is a pre-existing column already present in every layer (DO
schema, `/api/sync` payload, `bootstrapLocalDb`, local schema,
`pullSync` upsert), so:

- DO schema: unchanged
- `/api/sync` payload: unchanged
- `bootstrapLocalDb`: unchanged
- local SQLite schema: unchanged
- `pullSync` upsert: unchanged

## State transitions

None. The displayed URL is derived render-time state with no lifecycle.
