#!/usr/bin/env bash
# Stop hook: commit and push whatever changed during the turn.
# Never forces, never rewrites history, never commits likely secrets. Always exits 0.
set -u
cd "${CLAUDE_PROJECT_DIR:-$PWD}" 2>/dev/null || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

gitdir=$(git rev-parse --git-dir)
for state in MERGE_HEAD REBASE_HEAD CHERRY_PICK_HEAD rebase-merge rebase-apply; do
  if [ -e "$gitdir/$state" ]; then echo "auto-commit: $state in progress, skipping" >&2; exit 0; fi
done
branch=$(git symbolic-ref --quiet --short HEAD) || { echo "auto-commit: detached HEAD, skipping" >&2; exit 0; }

git add -A
# Leave anything that looks like a secret out of the commit (unstage only, never delete).
secrets=$(git diff --cached --name-only | grep -E '(^|/)(\.env(\..+)?|.+\.pem|.+\.key|.+\.p12|id_rsa[^/]*|id_ed25519[^/]*|credentials\.json)$' || true)
if [ -n "$secrets" ]; then
  while IFS= read -r f; do git reset -q -- "$f"; done <<< "$secrets"
  echo "auto-commit: left possible secrets out of the commit: $(echo $secrets)" >&2
fi

if ! git diff --cached --quiet; then
  count=$(git diff --cached --name-only | wc -l | tr -d ' ')
  git commit -q -m "factory: auto-commit after agent turn ($count file(s))" \
    -m "$(git diff --cached --stat | tail -n 20)" || { echo "auto-commit: commit failed" >&2; exit 0; }
fi

git remote get-url origin >/dev/null 2>&1 || exit 0
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  [ "$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 1)" = "0" ] && exit 0
fi

if ! git push -q -u origin "$branch" 2>/dev/null; then
  # Someone else pushed first: merge (no rebase, no force), then try once more.
  if git pull -q --no-rebase --no-edit origin "$branch" 2>/dev/null; then
    git push -q -u origin "$branch" 2>/dev/null || echo "auto-commit: push failed after merge" >&2
  else
    git merge --abort 2>/dev/null
    echo "auto-commit: could not merge origin/$branch automatically; commits kept locally" >&2
  fi
fi
exit 0
