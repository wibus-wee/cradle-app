---
name: changelog
description: Collect changes since last release and write a changelog entry
allowed-tools:
  - Bash
  - Read
  - Write
---

# Write Changelog

Collect user-facing changes from the Cradle repo since the last release tag, then write a changelog `.md` entry for the upcoming version.

## Usage

```bash
/changelog dev-20260624.1    # Write changelog for a specific version
/changelog                   # Auto-resolve next dev version
```

## Rules

- Changelog files live in `/Users/wibus/dev/cradle-app/apps/landing/changelog/`.
- **Two files per version** — one per language:
  - `<version>.zh.md` — Chinese (primary)
  - `<version>.en.md` — English
- Collect changes from the **private Cradle repo** at `/Users/wibus/dev/Cradle`, not the public cradle-app repo.
- Focus on user-facing changes. Skip internal refactors, CI tweaks, and trivial fixes.
- The body is free-form Markdown (GFM). Images, links, code blocks all work.
- If no changelog file exists for a version, the release still works — just no "What's New" is shown.
- Both language versions should have identical structure and content, just in different languages.

## File Format

Each language file:

```markdown
---
version: dev-20260624.1
date: 2026-06-24
title: Remote Runtime 与 Claude 订阅登录
---

> One-line summary of what changed.

## ✨ New

- Feature A does X
- Feature B does Y

## 💎 Improvements

- Improvement A

## 🐞 Fixes

- Fix A
```

The English version uses `title: Daily Build` (or descriptive title) and English body text.

### Frontmatter fields

| Field | Required | Description |
|-------|----------|-------------|
| `version` | Yes | Must match the release tag exactly. `dev-YYYYMMDD.N` for dev, `X.Y.Z` for release. |
| `date` | Yes | ISO date `YYYY-MM-DD`. |
| `title` | Yes | Short descriptive title summarizing the release. Both dev and release versions use descriptive titles (e.g. `Remote Runtime 与 Claude 订阅登录`). |
| `summary` | No | One-line highlight shown on the in-app corner announcement card. Falls back to the `>` blockquote style: keep it under ~80 characters. |
| `announce` | No | `true` to push this release as a timed corner popup (bottom-right card) in the desktop app, shown once per user until dismissed. |
| `showAfter` | No | ISO date `YYYY-MM-DD`. The corner popup only appears on/after this date; defaults to `date`. |

### Body conventions

- Start with a `>` blockquote as the one-line summary. The landing page styles it as a tagline.
- Use emoji-prefixed `##` headings for categories: `✨ New`, `💎 Improvements`, `🐞 Fixes`, `⚡ Performance`.
- Keep items concise — one sentence per bullet.

## Implementation

### 1. Resolve version

If the user provided a version argument, use it directly. Otherwise, resolve the next dev version:

```bash
cd /Users/wibus/dev/cradle-app
git fetch origin main --tags
DATE=$(date +%Y%m%d)
LAST=$(
  git ls-remote --tags --refs origin "refs/tags/dev-${DATE}.*" |
    sed -E "s#.*refs/tags/dev-${DATE}\\.([0-9]+)#\\1#" |
    sort -n |
    tail -1
)
INCREMENT=$(( ${LAST:-0} + 1 ))
VERSION="dev-${DATE}.${INCREMENT}"
```

### 2. Find the last release commit

The last release tag on the public repo points to the commit that was released. Use it to find the corresponding commit in the private Cradle repo.

```bash
cd /Users/wibus/dev/cradle-app

# Find the latest release tag (dev or release)
LATEST_TAG=$(
  git tag -l 'dev-*' 'v*' --sort=-version:refname |
    grep -E '^(dev-[0-9]{8}\.[0-9]+|v[0-9])' |
    head -1
)

# Get the public repo commit that was tagged
PUBLIC_SHA=$(git rev-parse "$LATEST_TAG")

# The private Cradle repo's main branch at that point in time
# Use the private repo's git log directly — diff against origin/main
cd /Users/wibus/dev/Cradle
git fetch origin main --tags
```

### 3. Collect changes from Cradle repo

```bash
cd /Users/wibus/dev/Cradle

# Get the latest release version from the public repo
cd /Users/wibus/dev/cradle-app
LATEST_TAG=$(git tag -l 'dev-*' 'v*' --sort=-version:refname | grep -E '^(dev-[0-9]{8}\.[0-9]+|v[0-9])' | head -1)
LATEST_DATE=$(echo "$LATEST_TAG" | sed -E 's/^dev-([0-9]{4})([0-9]{2})([0-9]{2})\..*/\1-\2-\3/')
# For release tags like v1.0.0, get the date from git log
if [[ "$LATEST_TAG" == v* ]]; then
  LATEST_DATE=$(git log -1 --format=%ai "$LATEST_TAG" | cut -d' ' -f1)
fi

cd /Users/wibus/dev/Cradle
# Get commits since the last release date
git log --oneline --since="$LATEST_DATE" origin/main --no-merges | head -50
```

Also check recent PRs for context:

```bash
cd /Users/wibus/dev/Cradle
# Recent conventional commit messages (feat/fix/etc)
git log --oneline --since="$LATEST_DATE" origin/main --no-merges \
  | grep -E '^\w+ (feat|fix|add|refactor|perf|chore)' | head -30
```

### 4. Write the changelog (both languages)

Analyze the collected commits and write **two files** in the public repo:

1. `apps/landing/changelog/<version>.zh.md` — Chinese version
2. `apps/landing/changelog/<version>.en.md` — English version

Group changes into categories:
- `feat:` → ✨ New
- `fix:` → 🐞 Fixes
- `refactor:` / `perf:` → 💎 Improvements
- `add:` → depends on context (feature or improvement)
- `chore:` → skip unless notable

Rewrite commit messages into user-friendly descriptions. A commit like `fix: claude agent stream cleanup race condition` becomes:
- zh: `修复 Claude Agent 流式清理的竞态条件`
- en: `Fixed a race condition in Claude Agent stream cleanup`

Both files must have the same structure and corresponding content.

### 5. Show to user

Display both written files for review. Do not commit or tag — the user will run `/release` when ready.

## How it flows after release

```
changelog/*.md
  ↓ (Vite plugin at build time)
index.json + *.md → deployed to app.cradle.wibus.ren/changelog/
  ↓ (Desktop app fetches on startup)
index.json → version check → fetch *.md → What's New Dialog (with version rail)
  ↓ (entries with `announce: true`)
timed bottom-right popup card → once per user → "See details" opens the Dialog
  ↓ (CI also reads *.md)
manifest.json releaseNotes field → Settings page display
```

## Notes

- The Vite plugin in `apps/landing/vite.config.ts` auto-generates `index.json` from all `.md` files at build time.
- The CI workflow reads the changelog file and populates `manifest.json`'s `releaseNotes` field automatically.
- The desktop app fetches from `https://app.cradle.wibus.ren/changelog/`.
- Changelog content is immutable once published — don't edit a `.md` file after the tag is pushed.
