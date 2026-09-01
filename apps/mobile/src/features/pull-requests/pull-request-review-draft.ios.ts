import AsyncStorage from '@react-native-async-storage/async-storage'

const REVIEW_DRAFT_PREFIX = '@cradle/mobile/pull-request-review'

function reviewDraftKey(
  connectionUrl: string,
  owner: string,
  repo: string,
  number: string,
): string {
  return `${REVIEW_DRAFT_PREFIX}/${connectionUrl}/${owner}/${repo}/${number}`
}

export async function readPullRequestReviewDraft(
  connectionUrl: string,
  owner: string,
  repo: string,
  number: string,
): Promise<string> {
  try {
    return await AsyncStorage.getItem(reviewDraftKey(connectionUrl, owner, repo, number)) ?? ''
  }
  catch {
    return ''
  }
}

export async function writePullRequestReviewDraft(
  connectionUrl: string,
  owner: string,
  repo: string,
  number: string,
  body: string,
): Promise<void> {
  try {
    const key = reviewDraftKey(connectionUrl, owner, repo, number)
    if (body.trim()) {
      await AsyncStorage.setItem(key, body)
      return
    }
    await AsyncStorage.removeItem(key)
  }
  catch {
    // Draft persistence should never block reviewing a pull request.
  }
}
