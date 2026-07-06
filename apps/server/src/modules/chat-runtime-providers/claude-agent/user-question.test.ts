import { describe, expect, it } from 'vitest'

import {
  buildClaudeAgentAskUserQuestionOutput,
  projectClaudeAgentUserInputQuestions,
  readClaudeAgentAskUserQuestionInput,
} from './user-question'

describe('claude Agent AskUserQuestion projection', () => {
  it('preserves SDK option preview annotations and joins multi-select answers', () => {
    const request = readClaudeAgentAskUserQuestionInput({
      questions: [
        {
          question: 'Which fixes should be applied?',
          header: 'Fixes',
          options: [
            {
              label: 'Permission bridge',
              description: 'Route SDK permission asks through Chat Runtime.',
              preview: 'Patch permission bridge',
            },
            {
              label: 'Persistence',
              description: 'Keep Claude.ai auth transcripts out of the user namespace.',
              preview: 'Patch persistence',
            },
          ],
          multiSelect: true,
        },
      ],
    })

    expect(request).not.toBeNull()
    expect(projectClaudeAgentUserInputQuestions(request!)).toEqual([
      {
        id: 'question-1',
        header: 'Fixes',
        question: 'Which fixes should be applied?',
        isOther: true,
        isSecret: false,
        multiSelect: true,
        options: [
          {
            label: 'Permission bridge',
            description: 'Route SDK permission asks through Chat Runtime.',
          },
          {
            label: 'Persistence',
            description: 'Keep Claude.ai auth transcripts out of the user namespace.',
          },
        ],
      },
    ])

    expect(buildClaudeAgentAskUserQuestionOutput({
      request: request!,
      answers: {
        'question-1': ['Permission bridge', 'Persistence'],
      },
    })).toEqual({
      questions: request!.questions,
      answers: {
        'Which fixes should be applied?': 'Permission bridge, Persistence',
      },
      annotations: {
        'Which fixes should be applied?': {
          preview: 'Patch permission bridge',
        },
      },
    })
  })
})
