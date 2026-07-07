import { diffReviewFiles } from '@cradle/db'
import { eq } from 'drizzle-orm'

import { AppError } from '../../errors/app-error'
import { db } from '../../infra'
import type { GitCommitFileGroupInput } from '../git/service'
import type { ReviewCommitPlanConflictView, ReviewCommitPlanGroupInput, ReviewCommitPlanGroupView } from './types'

export interface NormalizeCommitPlanResult {
  groups: ReviewCommitPlanGroupView[]
  conflicts: ReviewCommitPlanConflictView[]
}

export function normalizeCommitPlanGroups(
  revisionId: string,
  groups: ReviewCommitPlanGroupInput[],
): NormalizeCommitPlanResult {
  if (groups.length === 0) {
    throw new AppError({
      code: 'diff_review_commit_plan_empty',
      status: 400,
      message: 'Diff review commit plan must include at least one group',
      details: { revisionId },
    })
  }

  const files = db().select().from(diffReviewFiles).where(eq(diffReviewFiles.revisionId, revisionId)).all()
  const fileById = new Map(files.map(file => [file.id, file]))
  const groupIds = new Set<string>()
  const fileIdToGroupIds = new Map<string, string[]>()

  for (const group of groups) {
    if (groupIds.has(group.id)) {
      throw new AppError({
        code: 'diff_review_commit_plan_duplicate_group',
        status: 400,
        message: 'Diff review commit plan group ids must be unique',
        details: { revisionId, groupId: group.id },
      })
    }
    groupIds.add(group.id)
  }

  const normalized: ReviewCommitPlanGroupView[] = []
  for (const group of groups) {
    if (group.fileIds.length === 0) {
      throw new AppError({
        code: 'diff_review_commit_plan_group_empty',
        status: 400,
        message: 'Diff review commit plan groups must include at least one file',
        details: { revisionId, groupId: group.id },
      })
    }

    const paths: string[] = []
    for (const fileId of group.fileIds) {
      const file = fileById.get(fileId)
      if (!file) {
        throw new AppError({
          code: 'diff_review_commit_plan_file_not_found',
          status: 400,
          message: 'Diff review commit plan file does not belong to the plan revision',
          details: { revisionId, groupId: group.id, fileId },
        })
      }
      const existing = fileIdToGroupIds.get(fileId)
      if (existing) {
        existing.push(group.id)
      }
 else {
        fileIdToGroupIds.set(fileId, [group.id])
      }
      paths.push(file.path)
    }

    const dependsOn = [...new Set(group.dependsOn)]
    for (const dependencyId of dependsOn) {
      if (dependencyId === group.id || !groupIds.has(dependencyId)) {
        throw new AppError({
          code: 'diff_review_commit_plan_dependency_not_found',
          status: 400,
          message: 'Diff review commit plan dependencies must reference another group',
          details: { revisionId, groupId: group.id, dependencyId },
        })
      }
    }

    normalized.push({
      id: group.id,
      title: group.title.trim(),
      message: group.message.trim(),
      rationale: group.rationale.trim(),
      fileIds: group.fileIds,
      paths,
      dependsOn,
    })
  }

  const conflicts: ReviewCommitPlanConflictView[] = []
  for (const [fileId, groupIds] of fileIdToGroupIds) {
    if (groupIds.length > 1) {
      const file = fileById.get(fileId)
      conflicts.push({
        fileId,
        path: file?.path ?? fileId,
        groupIds,
      })
    }
  }

  return { groups: normalized, conflicts }
}

export function commitGroupsForPlan(
  revisionId: string,
  groups: ReviewCommitPlanGroupView[],
): GitCommitFileGroupInput[] {
  const files = db().select().from(diffReviewFiles).where(eq(diffReviewFiles.revisionId, revisionId)).all()
  const fileById = new Map(files.map(file => [file.id, file]))
  const committedFileIds = new Set<string>()
  return groups.map((group) => {
    const paths: string[] = []
    for (const fileId of group.fileIds) {
      if (committedFileIds.has(fileId)) {
        continue
      }
      const file = fileById.get(fileId)
      if (!file) {
        throw new AppError({
          code: 'diff_review_commit_plan_file_not_found',
          status: 400,
          message: 'Diff review commit plan file does not belong to the plan revision',
          details: { revisionId, commitGroupId: group.id, fileId },
        })
      }
      committedFileIds.add(fileId)
      if (file.previousPath) {
        paths.push(file.previousPath)
      }
      paths.push(file.path)
    }
    return {
      message: group.message,
      paths: Array.from(new Set(paths)),
    }
  })
}
