import type { CradleDiffReview, ReviewFile } from '../../shared/types'

/**
 * Fixtures for the Diffs rendering seam.
 *
 * Modelled on a real Cradle pull request rather than invented data, so the
 * stories exercise the paths that actually break layout: deep monorepo paths, a
 * long title, a failing check, a rename, and a binary file.
 */

const REVISION_ID = 'rev_01HX'

function file(
  id: string,
  path: string,
  status: ReviewFile['status'],
  additions: number,
  deletions: number,
  overrides: Partial<ReviewFile> = {},
): ReviewFile {
  return {
    id,
    revisionId: REVISION_ID,
    path,
    previousPath: null,
    status,
    additions,
    deletions,
    isGenerated: false,
    isBinary: false,
    isViewed: false,
    ...overrides,
  }
}

export const reviewFilesFixture: ReviewFile[] = [
  file('f1', 'apps/web/src/features/diff-review/review/review-detail-view.tsx', 'added', 214, 0),
  file('f2', 'apps/web/src/features/diff-review/review/review-file-rail.tsx', 'added', 186, 0),
  file('f3', 'apps/web/src/features/diff-review/review/review-overview.tsx', 'added', 158, 0),
  file('f4', 'apps/web/src/features/diff-review/reviews-list-page.tsx', 'deleted', 0, 1216, { isViewed: true }),
  file('f5', 'apps/web/src/features/diff-review/shared/diff-items.ts', 'modified', 24, 31),
  file('f6', 'apps/web/src/features/diff-review/shared/types.ts', 'modified', 9, 4, { isViewed: true }),
  file('f7', 'apps/server/src/modules/diff-review/service.ts', 'modified', 143, 96),
  file('f8', 'apps/server/src/modules/diff-review/model.ts', 'modified', 38, 22),
  file(
    'f9',
    'packages/db/src/schema/repository.ts',
    'renamed',
    12,
    3,
    { previousPath: 'packages/db/src/schema/repo.ts' },
  ),
  file('f10', 'apps/web/public/diff-preview.png', 'added', 0, 0, { isBinary: true }),
  file('f11', 'apps/web/src/api-gen/types.gen.ts', 'modified', 412, 88, { isGenerated: true }),
]

export const reviewPatchFixture = `diff --git a/apps/web/src/features/diff-review/shared/diff-items.ts b/apps/web/src/features/diff-review/shared/diff-items.ts
index 1a2b3c4..5d6e7f8 100644
--- a/apps/web/src/features/diff-review/shared/diff-items.ts
+++ b/apps/web/src/features/diff-review/shared/diff-items.ts
@@ -70,12 +70,14 @@ export function buildThreadAnnotations(
 export function formatChangeStats(review: CradleDiffReview): string {
   const revision = review.currentRevision
   if (!revision) {
-    return '0 files'
+    return 'No changes'
   }
-  return \`\${revision.fileCount} file\${revision.fileCount === 1 ? '' : 's'} · +\${revision.additions} -\${revision.deletions}\`
+  const files = \`\${revision.fileCount} file\${revision.fileCount === 1 ? '' : 's'}\`
+  return \`\${files} · +\${revision.additions} −\${revision.deletions}\`
 }

-export function formatTimestamp(seconds: number): string {
-  return new Date(seconds * 1000).toLocaleString()
+export function formatTimestamp(seconds: number, locale?: string): string {
+  return new Date(seconds * 1000).toLocaleString(locale)
 }

 export function statusLabel(status: ReviewFile['status']): string {
diff --git a/apps/server/src/modules/diff-review/model.ts b/apps/server/src/modules/diff-review/model.ts
index aaaaaaa..bbbbbbb 100644
--- a/apps/server/src/modules/diff-review/model.ts
+++ b/apps/server/src/modules/diff-review/model.ts
@@ -11,10 +11,8 @@ const reviewState = t.Union([
 const sourceKind = t.Union([
   t.Literal('local-working-tree'),
   t.Literal('local-branch-compare'),
   t.Literal('local-commit'),
-  t.Literal('agent-change-set'),
   t.Literal('github-pull-request'),
-  t.Literal('external-import'),
 ])

 const githubActor = t.Object({
`

export const reviewFixture: CradleDiffReview = {
  id: 'review_01HXPR87',
  workspaceId: 'ws_cradle_app',
  sourceId: 'src_gh_87',
  repositoryPath: 'github:wibus-wee/cradle-app',
  sourceKind: 'github-pull-request',
  githubPullRequest: {
    owner: 'wibus-wee',
    repo: 'cradle-app',
    number: 87,
    detail: {
      url: 'https://github.com/wibus-wee/cradle-app/pull/87',
      title: 'Rebuild Cradle Diffs around repository ownership',
      body: [
        'Reviews were filed under whichever workspace happened to be open, so a pull request',
        'for an unrelated repository showed up inside this project. Ownership now hangs off a',
        'repository record derived from the git remote.',
        '',
        'The review surface is rebuilt at the same time: two regions instead of three, threads',
        'as an overlay, and a file index that reads as an outline rather than a tree.',
      ].join('\n'),
      isDraft: false,
      state: 'open',
      merged: false,
      mergeable: true,
      mergeableState: 'clean',
      headRef: 'feat/diffs-repository-ownership',
      baseRef: 'main',
      headSha: '9f2c1ab',
      author: { login: 'wibus-wee', avatarUrl: null, url: null },
      reviewers: [
        { login: 'octocat', avatarUrl: null, url: null },
        { login: 'hubot', avatarUrl: null, url: null },
      ],
      assignees: [{ login: 'wibus-wee', avatarUrl: null, url: null }],
      labels: [
        { name: 'diffs', color: '5b5bd6' },
        { name: 'breaking', color: 'd92d20' },
      ],
      checksState: 'failure',
      checks: [
        { id: 'c1', name: 'lint', status: 'completed', conclusion: 'success', url: null },
        { id: 'c2', name: 'typecheck', status: 'completed', conclusion: 'success', url: null },
        { id: 'c3', name: 'test (web)', status: 'completed', conclusion: 'failure', url: null },
        { id: 'c4', name: 'build (desktop)', status: 'in_progress', conclusion: null, url: null },
      ],
      timeline: [],
    },
  },
  title: 'wibus-wee/cradle-app#87 Rebuild Cradle Diffs around repository ownership',
  status: 'open',
  reviewState: 'in-review',
  currentRevisionId: REVISION_ID,
  createdAt: Math.floor(Date.now() / 1000) - 172_800,
  updatedAt: Math.floor(Date.now() / 1000) - 1_800,
  currentRevision: {
    id: REVISION_ID,
    reviewId: 'review_01HXPR87',
    sourceVersion: '9f2c1ab:abc',
    patchHash: 'abc',
    fileCount: reviewFilesFixture.length,
    additions: reviewFilesFixture.reduce((total, item) => total + item.additions, 0),
    deletions: reviewFilesFixture.reduce((total, item) => total + item.deletions, 0),
    generatedAt: Math.floor(Date.now() / 1000) - 1_800,
    patch: reviewPatchFixture,
  },
  files: reviewFilesFixture,
  threads: [
    {
      id: 'th1',
      reviewId: 'review_01HXPR87',
      originalRevisionId: REVISION_ID,
      currentRevisionId: REVISION_ID,
      fileId: 'f5',
      anchor: {
        revisionId: REVISION_ID,
        fileId: 'f5',
        path: 'apps/web/src/features/diff-review/shared/diff-items.ts',
        side: 'head',
        startLine: 76,
        endLine: 76,
        hunkHeader: '@@ -70,12 +70,14 @@',
        lineHash: 'h1',
      },
      state: 'open',
      createdBy: 'octocat',
      createdAt: Math.floor(Date.now() / 1000) - 7_200,
      updatedAt: Math.floor(Date.now() / 1000) - 3_600,
      resolvedBy: null,
      resolvedAt: null,
      comments: [
        {
          id: 'cm1',
          threadId: 'th1',
          authorKind: 'user',
          authorId: 'octocat',
          bodyMarkdown: 'Should this use the review locale instead of the system default?',
          externalUrl: null,
          createdAt: Math.floor(Date.now() / 1000) - 7_200,
          updatedAt: Math.floor(Date.now() / 1000) - 7_200,
        },
      ],
    },
    {
      id: 'th2',
      reviewId: 'review_01HXPR87',
      originalRevisionId: REVISION_ID,
      currentRevisionId: REVISION_ID,
      fileId: 'f8',
      anchor: {
        revisionId: REVISION_ID,
        fileId: 'f8',
        path: 'apps/server/src/modules/diff-review/model.ts',
        side: 'base',
        startLine: 15,
        endLine: 15,
        hunkHeader: '@@ -11,10 +11,8 @@',
        lineHash: 'h2',
      },
      state: 'resolved',
      createdBy: 'hubot',
      createdAt: Math.floor(Date.now() / 1000) - 9_000,
      updatedAt: Math.floor(Date.now() / 1000) - 4_000,
      resolvedBy: 'wibus-wee',
      resolvedAt: Math.floor(Date.now() / 1000) - 4_000,
      comments: [
        {
          id: 'cm2',
          threadId: 'th2',
          authorKind: 'user',
          authorId: 'hubot',
          bodyMarkdown: 'Dropping these two source kinds is fine — nothing ever constructed them.',
          externalUrl: null,
          createdAt: Math.floor(Date.now() / 1000) - 9_000,
          updatedAt: Math.floor(Date.now() / 1000) - 9_000,
        },
      ],
    },
  ],
  submissions: [],
  events: [],
  preferences: {
    id: 'pref1',
    workspaceId: 'ws_cradle_app',
    userId: 'local-user',
    diffStyle: 'split',
    codeTheme: 'system',
    fontSize: 12,
    lineHeight: 18,
    hideWhitespaceOnly: false,
    structuralHighlighting: true,
    collapseGeneratedFiles: false,
    notificationMode: 'reviews-and-comments',
    createdAt: Math.floor(Date.now() / 1000) - 172_800,
    updatedAt: Math.floor(Date.now() / 1000) - 172_800,
  },
  agentFixes: [],
}

/** A clean local working tree — the empty state the list links to first. */
export const workingTreeReviewFixture: CradleDiffReview = {
  ...reviewFixture,
  id: 'review_working_tree',
  sourceId: 'src_wt',
  sourceKind: 'local-working-tree',
  repositoryPath: '/Users/wibus/dev/cradle-app',
  githubPullRequest: null,
  title: 'Working tree',
  reviewState: 'unreviewed',
  threads: [],
  files: reviewFilesFixture.slice(0, 3),
  currentRevision: {
    ...reviewFixture.currentRevision!,
    fileCount: 3,
    additions: 558,
    deletions: 0,
  },
}
