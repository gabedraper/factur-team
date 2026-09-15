#!/bin/sh
#
# A private copy of this repo for one session, so parallel sessions stop
# stepping on each other.
#
#   scripts/worktree.sh <name>        make ~/factur-<name> on branch wt/<name>
#
# Several sessions used to share this one folder, which meant one session's
# `git add` could sweep up another's half-finished file, one session's push
# carried everyone's commits, and undoing a change could undo someone else's.
# A git worktree is a second checkout of the same repository on its own
# branch: separate files, shared history.
#
# node_modules is cloned with `cp -c`, which on APFS shares the underlying
# disk blocks: it takes about seven seconds and almost no space until a file
# actually differs. It is NOT symlinked -- Turbopack refuses a node_modules
# symlink that points outside the project and the build dies with "Symlink
# [project]/node_modules is invalid". Tested, not assumed.
#
# The .env files are symlinked, so a secret added later is picked up by every
# copy without re-copying.
#
# After changing dependencies, re-clone: an `npm install` inside a copy only
# updates that copy, and package-lock.json then disagrees with the others.

set -e

name=$1
case "$name" in
  "" ) echo "usage: scripts/worktree.sh <name>   (letters, digits, dashes)" >&2; exit 2 ;;
  *[!a-z0-9-]* ) echo "name must be lower-case letters, digits and dashes: $name" >&2; exit 2 ;;
esac

# --git-common-dir is the main checkout's .git even when this runs from inside
# another worktree, so worktrees can be made from anywhere.
main=$(cd "$(dirname "$0")/.." && cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd)
dir="$(dirname "$main")/factur-$name"

if [ -e "$dir" ]; then
  echo "$dir already exists. Pick another name, or remove it:" >&2
  echo "  git -C $main worktree remove $dir" >&2
  exit 1
fi

git -C "$main" fetch --quiet origin
# Branched from origin/main, not from whatever the shared checkout happens to
# have in progress -- a private copy of someone else's half-done work is worse
# than no copy at all.
git -C "$main" worktree add -b "wt/$name" "$dir" origin/main

printf 'cloning node_modules... '
cp -Rc "$main/node_modules" "$dir/node_modules" 2>/dev/null ||
  cp -R "$main/node_modules" "$dir/node_modules"
echo "done"
for f in .env.local .env.vercel; do
  [ -f "$main/$f" ] && ln -s "$main/$f" "$dir/$f"
done

# One dev server per port, and sign-in only works on ports Supabase knows
# about, so each copy takes the next free one.
port=""
for p in 3002 3003 3004 3005; do
  if ! lsof -iTCP:"$p" -sTCP:LISTEN -n -P >/dev/null 2>&1; then port=$p; break; fi
done

echo
echo "Copy ready:  $dir   (branch wt/$name)"
if [ -n "$port" ]; then
  echo "Dev server:  npm run dev -- -p $port      (or the \"factur-team $port\" preview config)"
else
  echo "Dev server:  every port 3002-3005 is busy; stop one, or share the browser with that session"
fi
cat <<EOF

When the work is done, from inside the copy:
  git add <the files you touched> && git commit
  git fetch origin && git rebase origin/main     # take in what others shipped
  npm run build                                  # prove it still builds
  git push -u origin wt/$name                    # the branch, not main
  gh pr create --fill                            # ask Gabe to approve it

Once the pull request is merged, from anywhere:
  git -C $main worktree remove $dir
  git -C $main branch -d wt/$name
EOF
