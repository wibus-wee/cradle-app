---
name: release-sdk
description: Trigger the @cradleapp/plugin-sdk npm release workflow and monitor it with Cradle
---

# Release Plugin SDK

Trigger `wibus-wee/cradle-app`'s `release-plugin-sdk.yml` workflow and monitor it until `@cradleapp/plugin-sdk` is published to npm.

## Prerequisites

Before the first CI release, configure npm **Trusted publishing** on `@cradleapp/plugin-sdk`:

- Provider: GitHub Actions
- Repository: `wibus-wee/cradle-app`
- Workflow filename: `release-plugin-sdk.yml`

If trusted publishing is not configured, CI publish will fail with authentication errors.

## Usage

```bash
/release-sdk dev          # Dev channel: sdk-dev-YYYYMMDD.N → npm tag dev
/release-sdk 0.2.0        # Release channel: sdk-v0.2.0 → npm tag latest
```

## Rules

- Release tags live in this repository (`wibus-wee/cradle-app`). Tag the commit you want to publish (usually `origin/main`).
- SDK tags use the `sdk-` prefix and are independent from desktop `v*` / `dev-*` tags.
- Leave unrelated local files alone.
- Use Cradle awaits for workflow completion; do not watch the run with a long polling loop.
- Use only short bounded retries to let GitHub materialize run/check IDs.

## Version Logic

- `dev` creates `sdk-dev-YYYYMMDD.N`.
  - Use remote tags, not npm versions, to find the next increment.
  - Example: `sdk-dev-20260707.1`, then `sdk-dev-20260707.2`.
  - CI publishes npm version `0.0.0-dev.<run_number>` with dist-tag `dev`.
- A release version creates `sdk-vX.Y.Z`.
  - Accept `0.2.0` or `v0.2.0`; normalize to `sdk-v0.2.0`.
  - CI publishes that SemVer with dist-tag `latest`.

## Implementation

When the user runs `/release-sdk <arg>`, execute these steps in order.

### 1. Resolve tag

```bash
cd "$(git rev-parse --show-toplevel)"
git fetch origin main --tags

ARG="<user argument>"

if [ "$ARG" = "dev" ]; then
  DATE=$(date +%Y%m%d)
  LAST=$(
    git ls-remote --tags --refs origin "refs/tags/sdk-dev-${DATE}.*" |
      sed -E "s#.*refs/tags/sdk-dev-${DATE}\\.([0-9]+)#\\1#" |
      sort -n |
      tail -1
  )
  INCREMENT=$(( ${LAST:-0} + 1 ))
  VERSION="${DATE}.${INCREMENT}"
  TAG="sdk-dev-${VERSION}"
  CHANNEL="dev"
else
  VERSION="${ARG#v}"
  if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$ ]]; then
    echo "Release version must be SemVer, for example 0.2.0" >&2
    exit 1
  fi
  TAG="sdk-v${VERSION}"
  CHANNEL="release"
fi

if git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1; then
  echo "Tag already exists: $TAG" >&2
  exit 1
fi

RELEASE_SHA=$(git rev-parse origin/main)
```

### 2. Push release tag

```bash
git tag -a "$TAG" "$RELEASE_SHA" -m "Release $TAG"
git push origin "$TAG"
```

### 3. Register Cradle await

Resolve the workflow run for the tag, then wait on the publish job.

```bash
RUN_ID=$(
  gh run list \
    --repo wibus-wee/cradle-app \
    --workflow=release-plugin-sdk.yml \
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
    --jq '.jobs[] | select(.name == "Publish @cradleapp/plugin-sdk") | .databaseId' |
    head -1
)

if [ -z "$CHECK_RUN_ID" ]; then
  echo "Publish job is not visible yet for $TAG; retry this lookup shortly." >&2
  exit 1
fi

cradle session await github-ci wibus-wee/cradle-app \
  --run-id "$CHECK_RUN_ID" \
  --reason "Waiting for @cradleapp/plugin-sdk npm release $TAG."
```

After registering the await, end the turn and let Cradle resume the session.

### 4. Report result after resume

When Cradle resumes, inspect the workflow run:

```bash
gh run list \
  --repo wibus-wee/cradle-app \
  --workflow=release-plugin-sdk.yml \
  --branch "$TAG" \
  --event push \
  --limit 1 \
  --json databaseId,status,conclusion,url
```

If the workflow succeeded, verify the npm package:

```bash
if [ "$CHANNEL" = "dev" ]; then
  npm view @cradleapp/plugin-sdk@dev version
else
  npm view @cradleapp/plugin-sdk version
fi
```

Report success with the npm version and workflow run URL. If the workflow failed, report the run URL and the failing job name.

## Notes

- CI publishes npm package name `@cradleapp/plugin-sdk`; the monorepo workspace package remains `@cradle/plugin-sdk`.
- Trusted publishing uses OIDC — no `NPM_TOKEN` secret in GitHub.
- Provenance attestations are generated automatically for GitHub Actions trusted publishes.
- Dev installs: `pnpm add -D @cradleapp/plugin-sdk@dev`
- Stable installs: `pnpm add -D @cradleapp/plugin-sdk`
