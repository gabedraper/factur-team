# Working in this repo

Next.js App Router, TypeScript, Tailwind, Supabase. `npm run dev` on **port
3001** — fixed, not automatic, because Supabase auth redirects are registered
against it.

**Another session may be working in this repo at the same time.** Stage the
files you actually touched. `git add -A` has repeatedly swept someone else's
work into an unrelated commit.

---

## The design system

Decided 2026-09-10. The reference page is **`/settings/design`** — it imports
the real components, so if it and this file disagree, the page is right.

The rule underneath all of it: **anything with a token gets used through its
token.** The four areas that drifted — type scale, spacing, shadow, motion —
drifted precisely because they had no token to point at. Adding a new hardcoded
value is how that starts again.

### Use these. Do not rebuild them.

| Need | Use | Never |
|---|---|---|
| A block of content | `<Surface>` | `rounded-md border bg-card p-4` |
| Top of a page | `<PageHeader>` | a hand-styled `<h1>` |
| Any list of records | `<Table>` + `<TableScroll>` | a bare `<table>` |
| A company logo | `<CompanyLogo>` | `<img className="rounded-full">` |
| A person | `<Avatar>` | as above |
| Loading | `<Skeleton>` / `<TableSkeleton>` | a spinner |

There are 47 hand-rolled tables and 26 hand-typed card recipes still in the
app. They are being retired a screen at a time. **Do not add to either count** —
if you are editing a file that has one, moving it over is welcome.

### Separation is colour, not lines

Sections carry **no border**. A card reads as a card because its surface
differs from the page: white on grey in light, a step *lighter* than the page
in dark. `--card` and `--background` do that work.

Do not add a border to a Surface to make it "clearer". If a block is not
reading, the fix is the surface ladder, not an outline.

### Depth means movement

Shadow is reserved for things that leave the page:

- **`shadow-overlay`** — menus, dropdowns, popovers, and the hover lift.
- **`shadow-modal`** — dialogs.
- **`shadow-raised`** — rarely. Most sections are flat at rest.

A section that is flat until you hover it is correct and deliberate. If
everything has a shadow, nothing reads as floating.

**Dark mode does not reuse the light shadows.** A shadow is an absence of
light and a dark ground has nothing darker to cast onto, so dark depth is
built from a lit top edge, a hairline of reflected light, and a neutral halo.
This is already in the tokens — use `shadow-*`, never a literal.

The halo is **cool white, never blue**. `--ring` is Factur blue and means
"your keyboard is here". Depth and focus must not look alike.

### Tokens

| Use | Not |
|---|---|
| `text-page-title` `text-section-title` `text-body` `text-meta` | `text-xl` `text-sm` `text-xs` |
| `p-card` (24px) `p-card-tight` `p-section` | `p-4` `p-6` |
| `px-cell-x` `py-cell-y` | table padding by hand |
| `duration-base` `ease-out` | `duration-200` `ease-in-out` |
| `shadow-raised/overlay/modal` | `shadow-sm` `shadow-lg` |
| `bg-card` `bg-background` `bg-card-hover` | any hex, any `bg-white` |

**The radius trap:** `--radius` is **10px**, but `rounded-md` is defined as
`--radius − 2`, so corners render at **8px**. If you want 8px corners, leave
the token alone. Setting `--radius: 8px` makes everything 6px.

### Type

`globals.css` applies `font-heading tracking-tight` to every `h1/h2/h3`, so
headings are Montserrat automatically. **Never set a font family on a
heading.** Body and tables stay on Inter, which handles figures better at
small sizes.

### Tables

Density is two tokens, `cell-x` and `cell-y`, currently 16px × 10px. It is not
tighter because a 24px company logo has to fit a row — lists show logos.

- Money and counts use `<TD numeric>`. It right-aligns and sets `tabular-nums`
  so figures line up down the column.
- Naming a company or a person uses `<TDIdentity>`, which carries the
  thumbnail. This is what stops a logo appearing on one list and not the next.
- Wrap every table in `<TableScroll>`. A wide table without it pushes the whole
  page sideways.

### Loading

Skeleton, not spinner. The point is that the placeholder is the same height as
the real content, so nothing jumps when data lands — `<TableSkeleton>` takes
row and column counts for exactly that reason.

Only give a view a skeleton if it is actually slow. One that flashes for 80ms
is worse than none.

Skeletons are `aria-hidden`; the container carries `aria-busy`. A screen reader
should hear the content, not a description of grey boxes.

---

## Things that have bitten before

- **Tailwind only generates classes it has literally seen.** A class name built
  in a variable or living in `lib/` was dropped from the stylesheet with no
  error. `lib/**` is in the `content` globs for this reason — keep it there.
- **`--card` and `--background` used to be identical.** Anything assuming a
  card is white will break in dark mode. Read the token.
- **A wrong Supabase table name returns zero rows, not an error.** An empty
  list is not proof of an empty table.
- **`org_clients.active` is meaningless** — `status` is the real signal.

## Data

- Coupler tables (`sf_*`, `qb_*`) are dropped and recreated on every sync,
  which wipes RLS, indexes and statistics. `ensure_staging_ready()` puts them
  back. Never build a view on one.
- Don't aggregate `raw_activities` on a request path. Precomputed counts exist
  (`client_activity_counts`, `client_lead_counts`) and are rebuilt hourly.
