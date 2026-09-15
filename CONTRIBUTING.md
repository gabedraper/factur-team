# Building this app with other people

How work gets from your machine into the live app, and what needs Gabe's
approval on the way. Read `CLAUDE.md` after this: it holds the design rules and
the things that have bitten before.

## The one rule

**Nothing lands on `main` without Gabe approving it.** You work on a branch,
open a pull request, and Gabe reviews it. GitHub enforces this: the repository
refuses a direct push to `main` from anyone but its admin, and refuses to
merge a pull request until it has Gabe's approval and a green build.

That is the whole structure. Everything below is how to work inside it.

## Getting set up, once

1. **GitHub.** Gabe adds you as a collaborator on
   `github.com/gabedraper/factur-team`. Accept the invitation, then:

   ```
   git clone https://github.com/gabedraper/factur-team.git
   cd factur-team
   npm install
   git config core.hooksPath .githooks
   ```

   The last line turns on the pre-commit design check. If you use Claude Code
   it is done for you at the start of every session.

2. **Secrets.** Ask Gabe for `.env.local`. It is never committed (see
   `.gitignore`), so it arrives out of band. `.env.local.example` lists what
   goes in it.

3. **Node 22**, the version the build runs on.

4. **Run it.** `npm run dev` serves on port 3001. Sign-in is a Google account
   on `@bethefactur.com` or `@facturmfg.com`, and only works on ports
   registered with Supabase (3001, and 3002-3005 for extra copies).

## Claude Code

Sign in with the **team's** Claude account, not a personal one:

```
claude
/login
```

The repo carries the shared setup, so every session sees the same rules
whichever account it runs under:

- `CLAUDE.md` — how to work here, the design system, the traps.
- `.claude/settings.json` — shared permissions and hooks. Committed.
- `.claude/settings.local.json` — your own additions. Ignored by git.

Several sessions at once? Use `scripts/worktree.sh <name>` for a private copy
of the repo per session; `CLAUDE.md` explains why.

## Doing a piece of work

```
git fetch origin
git switch -c <short-name> origin/main   # or: scripts/worktree.sh <short-name>
```

Work. Commit as you go, staging only the files you touched — `git add -A`
has repeatedly swept in someone else's half-finished file.

When it is ready:

```
git fetch origin && git rebase origin/main   # take in what others shipped
npm run lint                                 # the design check
npm run build                                # prove it builds
git push -u origin <short-name>
gh pr create --fill                          # or open it on GitHub
```

The pull request template asks what changed, why, and how you checked it.
Fill it in — it is what Gabe reads first, and a pull request that explains
itself is approved faster than one that has to be worked out.

Then:

- **Checks run.** The design check and the build, the same ones Vercel runs
  on deploy. A red cross here is a fix for you, not a blocked deploy for
  everyone.
- **Vercel builds a preview** of your branch and links it on the pull
  request, so Gabe can try the change without checking it out.
- **Gabe reviews.** Comments come back on the pull request. Push more commits
  to the same branch to address them; the approval is asked for again after
  every push, on purpose.
- **Gabe merges.** The branch is deleted automatically. Pull `main` and start
  the next thing.

## What you cannot do, and why

- **Push to `main`.** GitHub refuses it. Open a pull request instead.
- **Force-push.** Refused everywhere, including in Claude Code. It rewrites
  history other people have already pulled.
- **Apply a database change.** There is one database and everyone shares it.
  A migration goes in the pull request as a file under `supabase/migrations/`
  and is **not** run; Gabe applies it when the pull request merges. Say in
  the pull request that it is there.
- **Change secrets or environment variables.** Ask Gabe.
- **Quietly touch sign-in, roles, permissions or email.** Not forbidden, but
  tick the box in the template so it gets a closer look.

## Gaib's pull requests

The app has its own agent, Gaib, that works on tickets people raise inside
the app and opens pull requests for the results. They go through the same
review as anyone else's. Don't merge one; Gabe does that from the app, which
also closes the ticket.
