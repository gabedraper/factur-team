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

### Name the noun in a button

**"New client", never "New".** A list page can offer two different new things
— a new record, and a new saved view — and a bare verb makes you read the rest
of the page to work out which one you are looking at.

The page's primary action creates the record the page lists, and it sits in
`<PageHeader actions>`. Saving a filter set belongs beside the views, never in
the page header. Same rule for confirmations: the button says what happens
("Delete client"), and the toast afterwards says what happened ("Client
deleted").

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

Density is two tokens, `cell-x` and `cell-y`, currently 16px × 10px.

- Money and counts use `<TD numeric>`. It right-aligns and sets `tabular-nums`
  so figures line up down the column.
- **Lists do not carry logos or avatars.** Identity thumbnails belong on detail
  pages and record headers, where you have committed to one record — not down
  every row of a list you are scanning. A company logo is an external favicon
  request per row, and a contact photo is almost always just initials, since
  LinkedIn's are not obtainable. `<TDIdentity>` exists for the few lists that
  genuinely need one; it is not the default.
- Wrap every table in `<TableScroll>`. A wide table without it pushes the whole
  page sideways.

### List pages

Every list is the same shell: title, a row of view chips, then the rows. The
view chips come first because people return to the same few questions.

- **Filters live in the URL.** A view sets query parameters; changing a filter
  changes the URL. That is what makes a filtered list survive a reload, work
  with the back button, and paste into Slack as the thing you were looking at.
  Filters held only in component state are the reason people re-apply the same
  filter all day — 34 files still do this.
- **A view is a starting point, not a cage.** Open a saved view, adjust it, and
  save the result as a new one if it is worth keeping.
- **Views are not lists.** A view is a stored query and its contents change as
  the data does. A list is records somebody put there by hand. Never use the
  word "list" for a view: `list_views` holds the first, `tal_lists` the second.
- **Board is only for an ordered pipeline** — something you move a record
  through, like an opportunity stage. A status column is not a pipeline;
  nobody should be able to drag a client into Inactive.
- **Cards and timeline are not switcher options.** A specific view asks for
  them.

### Selecting and acting

Bulk selection is the primary way to act on records: tick rows, act on all of
them at once. It matches how the app is used — adding many contacts to a
sequence, exporting a filtered set.

Single-record actions live on the record, reached by clicking the row. Do not
put a button in every row to do what opening the record already does.

### Empty states say why

An empty list and a list filtered down to nothing are different, and they need
different words and different buttons:

- Nothing exists yet → say so, and offer to create one.
- Filters excluded everything → name the filter, and offer to clear it.
- The query failed → say it failed. Never let an error render as "no data".

The third is the one that matters: a broken query showing an empty table is
how an app gets reported as broken when it is working, and how a real fault
goes unnoticed for a week.

### Forms

Label above the field, always. It survives any width, reads fastest, and needs
no fixed label column. Every field reserves space for its error message so the
form does not jump when validation fires.

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
