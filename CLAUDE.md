# Working in this repo

Next.js App Router, TypeScript, Tailwind, Supabase. `npm run dev` on **port
3001** in the main checkout — fixed, not automatic, because Supabase auth
redirects are registered against it. A worktree uses 3002-3005 (below).

## Work in your own copy

**Several sessions work on this app at once.** Sharing one checkout meant one
session's `git add` swept up another's half-finished file, one session's push
carried everyone's commits, and undoing a change could undo someone else's. So
anything beyond a one-line fix starts with its own copy:

```
scripts/worktree.sh <name>          # ~/factur-<name>, branch wt/<name>
```

It branches from `origin/main`, clones `node_modules` (about seven seconds,
and almost no disk on APFS), links the `.env` files, and tells you which port
is free. Then work there and nowhere else.

Finishing, from inside the copy:

```
git add <the files you touched> && git commit
git fetch origin && git rebase origin/main     # take in what others shipped
npm run build                                  # prove it still builds
git push -u origin wt/<name>                   # the branch, not main
gh pr create --fill                            # ask Gabe to approve it
```

Rebase before pushing, every time: it is where an overlap with another session
surfaces, while both changes still exist.

**Work lands on `main` through a pull request that Gabe approves.** GitHub
refuses a direct push to `main` from anyone but the repository admin, and
refuses to merge a pull request until it has Gabe's approval and a green
build. Gabe's own sessions may still `git push origin HEAD:main`; the ruleset
lets the admin through. Once a pull request merges, GitHub deletes its branch
and the copy can go:

```
git -C ~/factur-team worktree remove <path> && git -C ~/factur-team branch -d wt/<name>
```

Teammate onboarding — GitHub access, secrets, which Claude account, the pull
request flow — is in `CONTRIBUTING.md`.

What a copy does **not** isolate:

- **The database.** There is one, shared. Two sessions changing the same table,
  function or policy still collide, and migrations land immediately for
  everyone. Hold one area at a time, and say in chat which one you are in.
  Teammates do not apply migrations: the file goes in the pull request under
  `supabase/migrations/` and Gabe applies it after the merge.
- **`node_modules` after a dependency change.** `npm install` inside a copy
  updates only that copy and leaves `package-lock.json` disagreeing with the
  rest. Install in `~/factur-team`, then re-clone the copies that need it.
- **The dev server port.** Sign-in only works on ports registered with
  Supabase: 3001 for the main checkout, 3002-3005 for copies. The matching
  browser-preview configs are in `.claude/launch.json`.
- **The git stash.** It is shared across every copy. Never `git stash pop` —
  make a temporary commit instead, or you will pop someone else's work.

In the main checkout, where several sessions still overlap: stage only the
files you touched. `git add -A` has repeatedly swept someone else's work into
an unrelated commit.

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
| A box inside a card | `<Surface inset>` | a border to make it show |
| A link or label that is a card | `className={surface({ interactive: true })}` | the recipe typed out |
| Top of a page | `<PageHeader title back actions count>` | a hand-styled `<h1>`, a hand-drawn "< Back" link |
| Any list of records | `<Table>` + `<TableScroll>` | a bare `<table>` |
| A company logo | `<CompanyLogo>` | `<img className="rounded-full">` |
| A person | `<Avatar>` | as above |
| A form field | `<Field label hint error>` | a label beside the box, or none |
| An input, select or textarea | `className={control()}` (or `<Input>`) | `rounded-md border bg-field px-2 …` |
| Loading | `<Skeleton>` / `<TableSkeleton>` / `<PageSkeleton>` | a spinner |
| View chips on a list | `<ViewSwitcher>` (+ `lib/list-views`) | filters in component state |
| Table or board | `<RendererSwitch>` | a toggle held in state |

### The build enforces this

`scripts/design-check.mjs` runs in `prebuild`, so **a deploy fails if new code
breaks these rules.** It catches a bare `<table>`, Tailwind's own shadows,
`bg-white`, literal hex colours in classes, the hand-typed card recipe, a
hand-styled `<h1>`, `text-sm`/`text-xs` in place of the type tokens, and
`bg-field` outside `control()`.

**Commits are checked too.** A pre-commit hook in `.githooks/` runs the same
check on what you are committing, so a violation is caught in your session
rather than in a failed deploy that blocks everyone. It looks only at staged
content — another session's unfinished files cannot refuse your commit. If a
commit is refused, fix the file. Do not bypass it with `--no-verify`: Vercel
runs the same check and will refuse the deploy instead. Run `npm run lint`
while you work rather than waiting for the commit to tell you.

A fresh clone needs the hook turned on once:
`git config core.hooksPath .githooks`.

**There are no old violations.** The whole app was moved over on 2026-09-10
and `scripts/design-baseline.json` is `{}`. It began as a ratchet — old files
could keep their count — but with nothing left to grandfather it is simply a
ban: any violation anywhere fails the build.

- `npm run lint` — run the check.
- `npm run design:report` — totals per rule. They should all be 0.
- **Never add to the baseline.** `npm run design:update` exists for the
  ratchet; running it now would only accept a new violation, which is the one
  thing the check exists to stop. Fix the code or mark a real exception.
- A genuine exception is marked on the line, or the line above, with
  `design-ok: <reason>` (in JSX, `{/* design-ok: <reason> */}`). The reason is
  required — `design-ok:` alone is ignored. The ones that exist: the login page
  (single-theme by design), the agreement PDF frame (a PDF renders on white),
  public pages outside the app shell (careers, portal, legal, the NPS form),
  the centred error and no-access messages, titles printed over a course
  cover image, and the timeline board's own table.

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
| `bg-lane` for a board column | `bg-muted/30` — it lands on the card colour in dark mode |

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
- **Company lists carry a logo. People lists do not.** Use `<TDIdentity>` on
  companies and clients; on contacts and candidates, the name is the whole
  cell.

  The asymmetry is deliberate. A favicon is a real signal — you recognise a
  manufacturer's mark faster than you read its name — and it costs one external
  request per row. A contact or candidate photo is always just initials,
  because LinkedIn's are not obtainable, so it takes the same space and the
  same row height while telling you nothing you were not about to read anyway.

  **The exception is our own people**, who have real Google photos: the
  scoreboards, the leaderboard, progress and the sidebar pass `src` and keep
  them. The test is not "is this a person" but "is there a picture" — initials
  beside a name earn nothing.

  This is also why `cell-y` is 10px rather than 8: a company row has to fit a
  24px logo. If logos ever leave the company lists, that token can come down.
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
no fixed label column. Use `<Field>` from `@/components/ui/field` — it does
all of this, and `<FieldSet>` does it for a group of radios or checkboxes.

The line under a field is reserved **only if the field passes `hint` or
`error`** (even as undefined). Then it holds the hint, and the error replaces
it when validation fires, so the form never jumps; a builder panel of twenty
selects with no validation does not carry twenty empty lines. Stack fields
with `gap-2`. Pass `aria-invalid` to the control when there is an error and
its border turns red on its own.

**Controls come from `control()`** in `@/components/ui/control` — two sizes,
`sm` (32px, filter rows and builder panels) and the default (40px, forms you
fill in), plus `multiline` for a textarea and `plain` for the borderless
search box at the top of a list. `<Input>`, `<Textarea>` and the Select
trigger are built from it, and so is every native `<select>` the app draws
directly. Native selects are deliberate: they post, they work with a keyboard,
and they need no popover library to be right.

The fill is `bg-field`, never `bg-background` — the page colour in a control
reads as a grey box on a white card, and near-black on a lifted dark one.

### Loading

Skeleton, not spinner. The point is that the placeholder is the same height as
the real content, so nothing jumps when data lands — `<TableSkeleton>` takes
row and column counts for exactly that reason.

Only give a view a skeleton if it is actually slow. One that flashes for 80ms
is worse than none. A slow page gets a `loading.tsx` that returns
`<PageSkeleton>` with the page's real row and column counts.

**A `loading.tsx` covers every page nested under it.** Put one beside
`clients/page.tsx` and a single client's page flashes a list-shaped
placeholder. When a list has record pages under it, move the list into a
`(list)` folder — brackets keep it out of the URL — and put the loading file
there. `clients`, `talent/people` and `opportunities/my` already do this.

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
