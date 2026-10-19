#!/usr/bin/env bash
# Pull pingdotgg/t3code into this fork and keep local changes on top.
#
#   scripts/fork-sync.sh            sync main + the feature branch, push to the fork
#   scripts/fork-sync.sh --install  also rebuild the macOS app and install it
#
# main mirrors upstream exactly; your changes live on FEATURE_BRANCH, which gets
# upstream merged in (merge, not rebase, so the fork never needs a force push).
set -euo pipefail

FEATURE_BRANCH="${FEATURE_BRANCH:-feat/claude-chat-mode}"
APP_NAME="T3 Code (Beta).app"
INSTALL=false
[[ "${1:-}" == "--install" ]] && INSTALL=true

cd "$(git rev-parse --show-toplevel)"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Uncommitted changes present. Commit or stash them first." >&2
  exit 1
fi

echo "==> Fetching upstream"
git fetch upstream --tags --prune

echo "==> Fast-forwarding main to upstream/main"
git checkout --quiet main
git merge --ff-only upstream/main
git push origin main

echo "==> Merging upstream into $FEATURE_BRANCH"
git checkout --quiet "$FEATURE_BRANCH"
if ! git merge --no-edit upstream/main; then
  echo >&2
  echo "Merge conflicts. Fix the files listed by 'git status', then run:" >&2
  echo "  git add -A && git commit --no-edit && git push origin $FEATURE_BRANCH" >&2
  exit 1
fi
git push origin "$FEATURE_BRANCH"

if [[ "$INSTALL" == true ]]; then
  echo "==> Installing dependencies"
  pnpm install --frozen-lockfile
  export PATH="$PWD/node_modules/.bin:/opt/homebrew/opt/rustup/bin:$PATH"

  echo "==> Building the macOS app"
  rm -rf release
  node scripts/build-desktop-artifact.ts --platform mac --target dmg --arch "$(uname -m)" --output-dir release

  dmg="$(ls release/*.dmg | head -1)"
  mount="$(hdiutil attach -nobrowse -readonly "$dmg" | tail -1 | awk -F'\t' '{print $NF}')"
  trap 'hdiutil detach "$mount" -quiet || true' EXIT

  echo "==> Installing to /Applications (quit the app first)"
  osascript -e "quit app \"${APP_NAME%.app}\"" 2>/dev/null || true
  rm -rf "/Applications/$APP_NAME"
  ditto "$mount/$APP_NAME" "/Applications/$APP_NAME"
  xattr -dr com.apple.quarantine "/Applications/$APP_NAME" 2>/dev/null || true
  echo "Installed /Applications/$APP_NAME"
fi

echo "==> Done. $FEATURE_BRANCH is up to date with upstream."
