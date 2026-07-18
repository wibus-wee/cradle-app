---
name: release
description: Trigger the public desktop release workflow and monitor it with Cradle
---

# Release Desktop

Trigger `wibus-wee/cradle-app`'s public `release-desktop.yml` workflow and monitor it until the release is published.

## Usage

```bash
/release dev          # Dev channel: dev-YYYYMMDD.N
/release 1.2.0        # Release channel: v1.2.0
```

## Rules

- The release entrypoint is the public repo: `/Users/wibus/dev/cradle-app`.
- Do not create release tags in the private `wibus-wee/Cradle` repo.
- The tag-triggered public workflow releases private `wibus-wee/Cradle` from `main`.
- Leave unrelated local files alone, including untracked workflow drafts.
- Use Cradle awaits for workflow completion; do not watch the run with a long polling loop.
- Use only short bounded retries to let GitHub materialize run/check IDs.

## Version Logic

- `dev` creates `dev-YYYYMMDD.N`.
  - Use remote tags, not releases, to find the next increment.
  - Example: `dev-20260611.1`, then `dev-20260611.2`.
- A release version creates `vX.Y.Z`.
  - Accept `1.2.0` or `v1.2.0`; normalize to `v1.2.0`.

## Implementation

When the user runs `/release <arg>`, execute these steps in order.

### 1. Resolve tag

```bash
PUBLIC_REPO=/Users/wibus/dev/cradle-app
cd "$PUBLIC_REPO"
git fetch origin main --tags

ARG="<user argument>"

if [ "$ARG" = "dev" ]; then
  DATE=$(date +%Y%m%d)
  LAST=$(
    git ls-remote --tags --refs origin "refs/tags/dev-${DATE}.*" |
      sed -E "s#.*refs/tags/dev-${DATE}\\.([0-9]+)#\\1#" |
      sort -n |
      tail -1
  )
  INCREMENT=$(( ${LAST:-0} + 1 ))
  VERSION="${DATE}.${INCREMENT}"
  TAG="dev-${VERSION}"
  CHANNEL="dev"
else
  VERSION="${ARG#v}"
  if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
    echo "Release version must be SemVer, for example 1.2.0" >&2
    exit 1
  fi
  TAG="v${VERSION}"
  CHANNEL="release"
fi

if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "Tag already exists: $TAG" >&2
  exit 1
fi

PUBLIC_SHA=$(git rev-parse origin/main)
```

### 2. Push public release tag

```bash
git tag -a "$TAG" "$PUBLIC_SHA" -m "Release $TAG"
git push origin "$TAG"
```

### 3. Register Cradle await

Resolve the workflow run for the tag, then wait on a concrete GitHub check run. Prefer the final `Publish GitHub Release` job because it completes after build and asset publication.

```bash
RUN_ID=$(
  gh run list \
    --repo wibus-wee/cradle-app \
    --workflow=release-desktop.yml \
    --branch "$TAG" \
    --event push \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId // empty'
)

if [ -z "$RUN_ID" ]; then
  echo "Release workflow run is not visible yet for $TAG; retry this lookup shortly." >&2
  exit 1
fi

CHECK_RUN_ID=$(
  gh run view "$RUN_ID" \
    --repo wibus-wee/cradle-app \
    --json jobs \
    --jq '.jobs[] | select(.name == "Publish GitHub Release") | .databaseId' |
    head -1
)

if [ -z "$CHECK_RUN_ID" ]; then
  CHECK_RUN_ID=$(
    gh run view "$RUN_ID" \
      --repo wibus-wee/cradle-app \
      --json jobs \
      --jq '.jobs[] | select(.name == "Build Desktop (mac arm64)") | .databaseId' |
      head -1
  )
  NEXT_STEP="After this await resumes, resolve and await the Publish GitHub Release check run."
else
  NEXT_STEP="After this await resumes, report the release result."
fi

if [ -z "$CHECK_RUN_ID" ]; then
  echo "No release check run is visible yet for $TAG; retry this lookup shortly." >&2
  exit 1
fi

cradle session await github-ci wibus-wee/cradle-app \
  --run-id "$CHECK_RUN_ID" \
  --reason "Waiting for public desktop release $TAG. $NEXT_STEP"
```

After registering the await, end the turn and let Cradle resume the session.

### 4. Report result after resume

When Cradle resumes, inspect the workflow run:

```bash
gh run list \
  --repo wibus-wee/cradle-app \
  --workflow=release-desktop.yml \
  --branch "$TAG" \
  --event push \
  --limit 1 \
  --json databaseId,status,conclusion,url

RUN_ID="<databaseId from gh run list>"
```

If the previous await targeted `Build Desktop (mac arm64)` and the run is still in progress, resolve the `Publish GitHub Release` check run and register a second Cradle await:

```bash
PUBLISH_CHECK_RUN_ID=$(
  gh run view "$RUN_ID" \
    --repo wibus-wee/cradle-app \
    --json jobs \
    --jq '.jobs[] | select(.name == "Publish GitHub Release") | .databaseId' |
    head -1
)

if [ -n "$PUBLISH_CHECK_RUN_ID" ]; then
  cradle session await github-ci wibus-wee/cradle-app \
    --run-id "$PUBLISH_CHECK_RUN_ID" \
    --reason "Waiting for public desktop release $TAG to publish."
fi
```

After the workflow has completed, inspect the release:

```bash
gh release view "$TAG" \
  --repo wibus-wee/cradle-app \
  --json tagName,name,isPrerelease,url,publishedAt
```

Report success with the release URL. If the workflow failed, report the run URL and the failing job name.

## Notes

- The public workflow builds desktop artifacts for mac-arm64, windows-x64, and linux-x64 (AppImage + deb).
- Release assets are uploaded to `wibus-wee/cradle-app` GitHub releases.
- Release builds use `https://github.com/wibus-wee/cradle-app/releases/latest/download/`.
- Dev builds publish both their own `dev-*` release and the rolling `feed-dev` update feed.
- The dev feed URL is `https://github.com/wibus-wee/cradle-app/releases/download/feed-dev/`.
- The dev feed uses `latest-mac.yml`; app-side updater logic does not switch to `dev-mac.yml`.
- Desktop releases require the repository Actions secret `POSTHOG_PROJECT_TOKEN` so product
  analytics (`VITE_POSTHOG_*`) is baked into the renderer. Internal channels also bake
  PostHog AI Observability; the `release` channel keeps AI capture off.
