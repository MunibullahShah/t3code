#!/usr/bin/env bash
# Pull pingdotgg/t3code into this fork and carry every feature branch along.
#
#   scripts/fork-sync.sh            sync main, each feature branch and my-t3, push them
#   scripts/fork-sync.sh --install  also rebuild the macOS app from my-t3 and install it
#
# main mirrors upstream exactly. Each feature branch is refreshed from the
# branch it is built on, then my-t3 merges them all; my-t3 is what gets built
# and shared. Merges, not rebases, so nothing ever needs a force push.
set -euo pipefail

# "branch:base" in dependency order: a branch built on another lists it as base.
# A new feature branched off main is added as "feat/name:main".
FEATURE_BRANCHES=(
  "feat/claude-chat-mode:main"
  "feat/keep-awake:feat/claude-chat-mode"
  "feat/linked-chat-folders:feat/claude-chat-mode"
  "feat/sidebar-recency-pins:feat/claude-chat-mode"
  "feat/office-previews:main"
  "feat/self-signed-updates:main"
)
INTEGRATION_BRANCH="my-t3"
APP_NAME="T3 Code (Beta).app"

# Switching branches rewrites this file, and bash reads scripts as it runs,
# so run from a private copy.
if [[ -z "${FORK_SYNC_COPY:-}" ]]; then
  copy="$(mktemp -t fork-sync)"
  cp "$0" "$copy"
  FORK_SYNC_COPY=1 exec bash "$copy" "$@"
fi

INSTALL=false
[[ "${1:-}" == "--install" ]] && INSTALL=true

cd "$(git rev-parse --show-toplevel)"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Uncommitted changes present. Commit or stash them first." >&2
  exit 1
fi

merge_or_stop() {
  local into="$1" from="$2"
  git checkout --quiet "$into"
  if ! git merge --no-edit "$from"; then
    echo >&2
    echo "Merge conflicts merging $from into $into. Fix the files listed by 'git status', then run:" >&2
    echo "  git add -A && git commit --no-edit && scripts/fork-sync.sh" >&2
    exit 1
  fi
  git push origin "$into"
}

echo "==> Fetching upstream"
git fetch upstream --tags --prune

echo "==> Fast-forwarding main to upstream/main"
git checkout --quiet main
git merge --ff-only upstream/main
git push origin main

for entry in "${FEATURE_BRANCHES[@]}"; do
  branch="${entry%%:*}"
  base="${entry#*:}"
  echo "==> Updating $branch from $base"
  merge_or_stop "$branch" "$base"
done

echo "==> Combining everything into $INTEGRATION_BRANCH"
for entry in "${FEATURE_BRANCHES[@]}"; do
  merge_or_stop "$INTEGRATION_BRANCH" "${entry%%:*}"
done

if [[ "$INSTALL" == true ]]; then
  echo "==> Installing dependencies"
  pnpm install --frozen-lockfile
  export PATH="$PWD/node_modules/.bin:/opt/homebrew/opt/rustup/bin:$PATH"

  echo "==> Building the macOS app from $INTEGRATION_BRANCH"
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

echo "==> Done. You're on $INTEGRATION_BRANCH, up to date with upstream."
