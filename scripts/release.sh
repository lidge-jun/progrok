#!/usr/bin/env bash
# release.sh — build + test + version bump + npm publish + GitHub Release
# Auto-detects npm latest and bumps patch only (minor/major via explicit arg).
# Usage:
#   ./scripts/release.sh          → patch bump (0.2.0 → 0.2.1)
#   ./scripts/release.sh minor    → minor bump (0.2.0 → 0.3.0)
#   ./scripts/release.sh major    → major bump (0.2.0 → 1.0.0)
#   ./scripts/release.sh 0.3.0    → explicit version
set -e

PKG_NAME="progrok"

echo "🦈 $PKG_NAME release script"
echo "========================="

cd "$(dirname "$0")/.."

# ─── Preflight: npm auth ───────────────────────────────
if ! NPM_USER=$(npm whoami 2>/dev/null); then
  echo "❌ Not logged in to npm. Run: npm login"
  exit 1
fi
echo "🔐 npm user: $NPM_USER"

if ! git diff --cached --quiet; then
  echo "❌ Refusing release: staged changes exist"
  exit 1
fi
if ! git diff --quiet; then
  echo "❌ Refusing release: worktree has uncommitted changes"
  exit 1
fi

# ─── Version detection ─────────────────────────────────
NPM_LATEST=$(npm view "$PKG_NAME" dist-tags.latest 2>/dev/null || echo "0.0.0")
PKG_VERSION=$(node -p "require('./package.json').version")
echo "📡 npm latest:   $NPM_LATEST"
echo "📦 package.json: $PKG_VERSION"

# Sync package.json to npm latest if behind (strip prerelease)
CLEAN_NPM=$(echo "$NPM_LATEST" | sed 's/-.*//')
CLEAN_PKG=$(echo "$PKG_VERSION" | sed 's/-.*//')
if [ "$CLEAN_PKG" != "$CLEAN_NPM" ] && [ "$CLEAN_NPM" != "0.0.0" ]; then
  echo "⚠️  package.json ($CLEAN_PKG) differs from npm ($CLEAN_NPM). Syncing..."
  npm version "$CLEAN_NPM" --no-git-tag-version --allow-same-version
fi

# ─── Build & Test ──────────────────────────────────────
echo "📦 Running test suite..."
npm run test

echo "📦 Building project..."
npm run build

# ─── Version bump ──────────────────────────────────────
BUMP_ARG="${1:-patch}"
EXPLICIT_VERSION=0
if [[ "$BUMP_ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  EXPLICIT_VERSION=1
fi
npm version "$BUMP_ARG" --no-git-tag-version --allow-same-version

VERSION=$(node -p "require('./package.json').version")

# Auto-resolve tag collisions left by previous failed releases.
# If user passed an explicit version, fail loudly instead of silently shifting.
collision_check() {
  local local_tag remote_tag npm_pub
  local_tag=$(git rev-parse --verify "v$1" 2>/dev/null || true)
  remote_tag=$(git ls-remote --tags origin "v$1" 2>/dev/null | awk '{print $1}')
  npm_pub=$(npm view "$PKG_NAME@$1" version 2>/dev/null || true)
  if [ -n "$npm_pub" ] || [ -n "$local_tag" ] || [ -n "$remote_tag" ]; then
    return 0
  fi
  return 1
}

while collision_check "$VERSION"; do
  if [ "$EXPLICIT_VERSION" = "1" ]; then
    echo "❌ Version $VERSION already exists (tag or npm). Choose a different version."
    exit 1
  fi
  echo "⚠️  v$VERSION already taken (tag or npm). Bumping patch and retrying..."
  npm version patch --no-git-tag-version
  VERSION=$(node -p "require('./package.json').version")
done

echo "📌 New version: $VERSION"

# ─── Collect changelog ─────────────────────────────────
PREV_TAG=$(git tag --sort=-v:refname | grep -E '^v[0-9]' | head -1)
if [ -n "$PREV_TAG" ]; then
  CHANGELOG=$(git log "$PREV_TAG"..HEAD --pretty=format:"- %s" --no-merges | head -50)
  COMMIT_COUNT=$(git rev-list "$PREV_TAG"..HEAD --count)
else
  CHANGELOG=$(git log --oneline -20 --pretty=format:"- %s" --no-merges)
  COMMIT_COUNT="?"
fi

echo ""
echo "📝 Changes since ${PREV_TAG:-'(none)'} ($COMMIT_COUNT commits):"
echo "$CHANGELOG" | head -15
echo ""

# ─── Commit + Tag ──────────────────────────────────────
echo "🏷️  Preparing commit + tag v$VERSION..."
HEAD_MSG=$(git log -1 --pretty=%s 2>/dev/null || echo "")
if [ "$HEAD_MSG" = "chore: release v$VERSION" ] && git diff --quiet HEAD -- package.json package-lock.json; then
  echo "ℹ️  HEAD already matches release commit, skipping commit"
else
  git add package.json package-lock.json
  git commit -m "chore: release v$VERSION" --allow-empty
fi

if git rev-parse --verify "v$VERSION" >/dev/null 2>&1; then
  echo "ℹ️  Local tag v$VERSION already exists, skipping"
else
  git tag "v$VERSION"
fi

# ─── npm publish (BEFORE pushing tag — so failed publish leaves no dangling remote tag) ──
echo "🚀 Publishing to npm..."
npm publish --access public

# ─── Push commit + tag ────────────────────────────────
git push origin main
if [ -z "$(git ls-remote --tags origin "v$VERSION" 2>/dev/null)" ]; then
  git push origin "v$VERSION"
else
  echo "ℹ️  Remote tag v$VERSION already exists, skipping push"
fi

# ─── GitHub Release with changelog ─────────────────────
echo "📋 Creating GitHub Release..."
RELEASE_BODY="## Release v$VERSION

**Previous**: ${PREV_TAG:-'(first release)'}
**Commits**: $COMMIT_COUNT

### Changes
$CHANGELOG"

if [ -n "$PREV_TAG" ] && command -v gh &>/dev/null; then
    gh release create "v$VERSION" \
        --title "v$VERSION" \
        --notes "$RELEASE_BODY" \
        --latest
    echo "✅ GitHub Release v$VERSION created!"
else
    echo "⚠️  Skipped GitHub Release (gh CLI not found or no previous tag)"
fi

echo ""
echo "✅ $PKG_NAME@$VERSION published!"
echo "   Install: npm install -g $PKG_NAME"
echo "   Release: https://github.com/lidge-jun/progrok/releases/tag/v$VERSION"
