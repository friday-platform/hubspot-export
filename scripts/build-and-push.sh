#!/usr/bin/env bash
set -euo pipefail

IMAGE="tempestdx/hubspot-export"

# Ensure clean working tree
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: Uncommitted changes. Commit or stash before building."
  exit 1
fi

GIT_HASH=$(git rev-parse --short HEAD)

# Get the latest version from git tags, default to 0.0.0 if none
LATEST_VERSION=$(git tag --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -1 | sed 's/^v//' || true)

if [[ -z "$LATEST_VERSION" ]]; then
  LATEST_VERSION="0.0.0"
fi

# Auto-increment patch version
IFS='.' read -r MAJOR MINOR PATCH <<< "$LATEST_VERSION"
PATCH=$((PATCH + 1))
NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"

echo "=== Build & Push ==="
echo "  Previous version: ${LATEST_VERSION}"
echo "  New version:      ${NEW_VERSION}"
echo "  Git hash:         ${GIT_HASH}"
echo ""

# Build with all tags
echo "Building ${IMAGE}..."
docker build \
  --label "version=${NEW_VERSION}" \
  --label "git-hash=${GIT_HASH}" \
  -t "${IMAGE}:${NEW_VERSION}" \
  -t "${IMAGE}:${GIT_HASH}" \
  -t "${IMAGE}:latest" \
  .

# Push all tags
echo "Pushing docker tags..."
docker push "${IMAGE}:${NEW_VERSION}"
docker push "${IMAGE}:${GIT_HASH}"
docker push "${IMAGE}:latest"

# Tag in git and push
git tag "v${NEW_VERSION}"
git push origin "v${NEW_VERSION}"
echo "Created and pushed git tag: v${NEW_VERSION}"

echo ""
echo "=== Done ==="
echo "  ${IMAGE}:${NEW_VERSION}"
echo "  ${IMAGE}:${GIT_HASH}"
echo "  ${IMAGE}:latest"
