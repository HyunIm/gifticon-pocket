#!/usr/bin/env bash
# Publishes dist/ to the gh-pages branch, which GitHub Pages serves.
# Runs automatically on every push to main (.github/workflows/deploy.yml); `npm run deploy`
# does the same by hand. Each deploy is one commit on gh-pages that mirrors dist/ exactly.
set -euo pipefail
cd "$(dirname "$0")/.."

remote="${PUBLISH_REMOTE:-origin}"
branch="${PUBLISH_BRANCH:-gh-pages}"
source_rev="$(git rev-parse --short HEAD)"
work="$(mktemp -d)"
cleanup() {
  git worktree remove --force "$work" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

if git fetch --quiet --depth=1 "$remote" "$branch" 2>/dev/null; then
  git worktree add --quiet --detach "$work" FETCH_HEAD
else
  # First deploy: start the branch with no history from main.
  git worktree add --quiet --detach "$work"
  git -C "$work" checkout --quiet --orphan "$branch"
fi

# Mirror dist/: files removed from dist/ also disappear from the site.
git -C "$work" rm -rf --quiet --ignore-unmatch .
cp -a dist/. "$work/"
git -C "$work" add -A

if git -C "$work" diff --cached --quiet; then
  echo "$branch already matches dist/ at $source_rev; nothing to publish."
  exit 0
fi
git -C "$work" commit --quiet -m "Deploy $source_rev"
git -C "$work" push --quiet "$remote" "HEAD:refs/heads/$branch"
echo "Published dist/ at $source_rev to $branch."
