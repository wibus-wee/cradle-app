export type ComposerIntentId = 'review' | 'commit' | 'push'

export interface ComposerIntentAction {
  id: ComposerIntentId
  label: string
  /** Slash command name without leading slash. */
  name: string
  description: string
  prompt: string
}

export function isComposerIntentId(value: string): value is ComposerIntentId {
  return value === 'review' || value === 'commit' || value === 'push'
}

export function readComposerIntentAction(intentId: ComposerIntentId): ComposerIntentAction {
  const intent = COMPOSER_INTENT_ACTIONS.find(candidate => candidate.id === intentId)
  if (!intent) {
    throw new Error(`Unknown composer intent: ${intentId}`)
  }
  return intent
}

/**
 * Prompt templates for Review / Commit / Push intents.
 * Context (the chat transcript) is the only state machine — these are entry points only.
 * Surfaced as Cradle slash commands (`/review`, `/commit`, `/push`) that insert
 * `data-cradle-intent` chips; prompts expand for the model, not the UI.
 */
export const COMPOSER_INTENT_ACTIONS: ComposerIntentAction[] = [
  {
    id: 'review',
    label: 'Review',
    name: 'review',
    description: 'Review local working-tree changes',
    prompt: [
      'Review the current local working-tree changes in this workspace.',
      'Focus on correctness risks, regressions, and missing verification.',
      'For each concrete finding, emit a complete directive on its own line:',
      '::code-comment{title="..." body="..." file="..." start="..." end="..." priority="P1"}',
      'Use priority P0–P3. Prefer precise file paths and line ranges when possible.',
      'Do not invent a separate review document or status workflow — findings in this chat are enough.',
    ].join('\n'),
  },
  {
    id: 'commit',
    label: 'Commit',
    name: 'commit',
    description: 'Propose a clean commit sequence',
    prompt: [
      'Inspect the current local working-tree changes and propose a clean commit sequence.',
      'Group related files, write clear commit messages, and explain each group briefly.',
      'For each proposed commit, emit a complete directive on its own line:',
      '::commit-group{message="..." files="path/a.ts,path/b.ts" body="..."}',
      'files must be a comma-separated list of workspace-relative paths.',
      'Do not create commits or push unless I explicitly ask in a follow-up message.',
      'Do not invent a commit-plan status machine — proposals in this chat are enough.',
    ].join('\n'),
  },
  {
    id: 'push',
    label: 'Push',
    name: 'push',
    description: 'Push the current branch to its remote',
    prompt: [
      'Push the current branch to its remote.',
      'Inspect git status first. If there are uncommitted changes, say so and stop.',
      'If the branch has no upstream, set one appropriately.',
      'Report the remote and branch you pushed to.',
    ].join('\n'),
  },
]
