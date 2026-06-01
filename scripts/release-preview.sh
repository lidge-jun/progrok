#!/usr/bin/env bash
# release-preview.sh — build + test + preview semver bump + npm publish --tag preview
# Auto-detects npm latest, bumps patch +1, then appends -preview.TIMESTAMP
# Example: npm latest = 0.2.0 → preview = 0.2.1-preview.20260422153000
set -euo pipefail

PKG_NAME="progrok"

cd "$(dirname "$0")/.."

if ! git diff --cached --quiet; then
  echo "❌ Refusing preview release: staged changes exist"
  exit 1
fi
if ! git diff --quiet; then
  echo "❌ Refusing preview release: worktree has uncommitted changes"
  exit 1
fi

# ─── Version detection ─────────────────────────────────
NPM_LATEST=$(npm view "$PKG_NAME" dist-tags.latest 2>/dev/null || echo "")
PKG_VERSION=$(node -p "require('./package.json').version")

# Use npm latest > package.json, strip prerelease suffix
RAW_VERSION="${NPM_LATEST:-$PKG_VERSION}"
RAW_VERSION=$(echo "$RAW_VERSION" | sed 's/-.*//')

# Bump patch +1 for preview (so preview > latest in semver)
IFS='.' read -r MAJOR MINOR PATCH <<< "$RAW_VERSION"
NEXT_PATCH=$((PATCH + 1))
BASE_VERSION="${MAJOR}.${MINOR}.${NEXT_PATCH}"

# Allow explicit override: ./scripts/release-preview.sh 0.3.0
if [ "${1:-}" != "" ]; then
  BASE_VERSION="$1"
fi

PREID="${PREID:-preview}"
STAMP="${STAMP:-$(date +%Y%m%d%H%M%S)}"

if [[ ! "$BASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "❌ BASE_VERSION must look like 0.2.1 (got: $BASE_VERSION)"
  exit 1
fi

PREVIEW_VERSION="${BASE_VERSION}-${PREID}.${STAMP}"

echo "🦈 $PKG_NAME preview release script"
echo "================================="
echo "npm latest:      ${NPM_LATEST:-'(not found)'}"
echo "package.json:    $PKG_VERSION"
echo "Preview version: $PREVIEW_VERSION  (base $RAW_VERSION + patch bump)"
echo "Dist-tag:        preview"

# ─── Collect changelog from commits since last tag ─────
PREV_TAG=$(git tag --sort=-v:refname | grep -E '^v[0-9]' | head -1)
if [ -n "$PREV_TAG" ]; then
  CHANGELOG=$(git log "$PREV_TAG"..HEAD --pretty=format:"- %s" --no-merges | head -30)
  COMMIT_COUNT=$(git rev-list "$PREV_TAG"..HEAD --count)
else
  CHANGELOG=$(git log --oneline -10 --pretty=format:"- %s" --no-merges)
  COMMIT_COUNT="?"
fi

echo ""
echo "📝 Changes since ${PREV_TAG:-'(none)'} ($COMMIT_COUNT commits):"
echo "$CHANGELOG" | head -10
echo ""

# ─── Test ──────────────────────────────────────────────
echo "🧪 Running test suite..."
npm run test

# ─── Build ─────────────────────────────────────────────
echo "⬆   Setting preview version..."
npm version "$PREVIEW_VERSION" --no-git-tag-version

VERSION=$(node -p "require('./package.json').version")
echo "📌 package.json version: $VERSION"

echo "📦 Building project..."
npm run build

echo "🧪 Verifying npm package contents..."
npm pack --dry-run >/dev/null

# ─── Commit + Publish ─────────────────────────────────
echo "📝 Creating local commit..."
git add package.json package-lock.json
git commit -m "chore: preview v$VERSION" --allow-empty

echo "🚀 Publishing preview to npm..."
TARBALL="$(npm pack | tail -1)"
trap 'rm -f "$TARBALL"' EXIT
npm publish "$TARBALL" --tag preview --access public

echo "🏷   Creating preview tag..."
git tag "v$VERSION"

echo "⬆   Pushing branch + tag..."
git push origin main
git push origin "v$VERSION"

# ─── GitHub Prerelease with changelog ──────────────────
echo "📋 Creating GitHub prerelease..."
RELEASE_BODY="## Preview Release v$VERSION

**Base**: $RAW_VERSION → preview patch $BASE_VERSION
**Commits since ${PREV_TAG:-'(none)'}**: $COMMIT_COUNT

### Changes
$CHANGELOG"

if command -v gh &>/dev/null; then
  gh release create "v$VERSION" \
    --title "v$VERSION (preview)" \
    --notes "$RELEASE_BODY" \
    --prerelease
  echo "✅ GitHub prerelease v$VERSION created!"
else
  echo "⚠️  Skipped GitHub prerelease (gh CLI not found)"
fi

echo ""
echo "✅ Preview published: $PKG_NAME@$VERSION"
echo "   Install: npm install -g $PKG_NAME@preview"
echo "   Exact:   npm install -g $PKG_NAME@$VERSION"
echo "   Release: https://github.com/lidge-jun/progrok/releases/tag/v$VERSION"
