// GENERATED CODE! DO NOT MODIFY BY HAND.
// Run `pnpm --filter @cradle/server generate:kimi-web-protocol-bindings`.

export type KimiWebSocketMessageDirection = 'client_to_server' | 'server_to_client'

export interface KimiWebSocketMessage {
  name: string
  title: string | null
  summary: string | null
  direction: KimiWebSocketMessageDirection
  payload: unknown
}

export const KIMI_WEB_SOCKET_MESSAGES = [
  {
    name: 'agent',
    title: 'Agent',
    summary: 'Status (idle, running or compacting), model, thinking effort, permission mode and plan / swarm / tower mode switches of one subscribed agent, sent when a connection starts receiving that agent and on every change; it replaces the client copy. Request retries ride on the running turn.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        compacting: {
          type: 'boolean',
        },
        event_created_at: {
          type: 'string',
        },
        model: {
          type: 'string',
        },
        permission_mode: {
          enum: [
            'manual',
            'yolo',
            'auto',
          ],
          type: 'string',
        },
        plan_mode: {
          type: 'boolean',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        status: {
          enum: [
            'idle',
            'running',
            'ended',
          ],
          type: 'string',
        },
        swarm_mode: {
          type: 'boolean',
        },
        thinking: {
          type: 'string',
        },
        tower_mode: {
          type: 'boolean',
        },
        type: {
          const: 'agent',
          type: 'string',
        },
      },
      required: [
        'status',
        'compacting',
        'plan_mode',
        'swarm_mode',
        'tower_mode',
        'type',
        'session_id',
        'agent_id',
        'event_created_at',
      ],
      type: 'object',
    },
  },
  {
    name: 'context',
    title: 'Context',
    summary: 'Context window usage of one subscribed agent, sent when a connection starts receiving that agent and then at most a few times per second while it changes; only the latest value matters.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        context_tokens: {
          maximum: 9007199254740991,
          minimum: 0,
          type: 'integer',
        },
        event_created_at: {
          type: 'string',
        },
        max_context_tokens: {
          exclusiveMinimum: 0,
          maximum: 9007199254740991,
          type: 'integer',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        type: {
          const: 'context',
          type: 'string',
        },
      },
      required: [
        'context_tokens',
        'type',
        'session_id',
        'agent_id',
        'event_created_at',
      ],
      type: 'object',
    },
  },
  {
    name: 'goal',
    title: 'Goal',
    summary: 'Goal of the main agent, sent when a connection starts receiving it and on every change; goal is omitted when the session has none.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        event_created_at: {
          type: 'string',
        },
        goal: {
          properties: {
            completion_criterion: {
              type: 'string',
            },
            objective: {
              type: 'string',
            },
            status: {
              enum: [
                'active',
                'paused',
                'blocked',
                'complete',
              ],
              type: 'string',
            },
            tokens_used: {
              maximum: 9007199254740991,
              minimum: 0,
              type: 'integer',
            },
            turns_used: {
              maximum: 9007199254740991,
              minimum: 0,
              type: 'integer',
            },
            wall_clock_ms: {
              minimum: 0,
              type: 'number',
            },
          },
          required: [
            'objective',
            'status',
            'turns_used',
            'tokens_used',
            'wall_clock_ms',
          ],
          type: 'object',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        type: {
          const: 'goal',
          type: 'string',
        },
      },
      required: [
        'type',
        'session_id',
        'agent_id',
        'event_created_at',
      ],
      type: 'object',
    },
  },
  {
    name: 'interaction',
    title: 'Interaction',
    summary: 'Flat, unsequenced approval or question state for a subscribed session; pending interactions are re-sent after every accepted subscription.',
    direction: 'server_to_client',
    payload: {
      oneOf: [
        {
          properties: {
            agent_id: {
              minLength: 1,
              type: 'string',
            },
            ended_at: {
              type: 'string',
            },
            event_created_at: {
              type: 'string',
            },
            interaction_id: {
              minLength: 1,
              type: 'string',
            },
            kind: {
              const: 'approval',
              type: 'string',
            },
            outcome: {
              enum: [
                'approved',
                'rejected',
                'cancelled',
                'answered',
                'dismissed',
              ],
              type: 'string',
            },
            request: {
              properties: {
                action: {
                  type: 'string',
                },
                expires_at: {
                  type: 'string',
                },
                tool_input_display: {},
                tool_name: {
                  minLength: 1,
                  type: 'string',
                },
              },
              required: [
                'tool_name',
                'action',
                'expires_at',
              ],
              type: 'object',
            },
            response: {
              properties: {
                decision: {
                  enum: [
                    'approved',
                    'rejected',
                    'cancelled',
                  ],
                  type: 'string',
                },
                feedback: {
                  type: 'string',
                },
                scope: {
                  enum: [
                    'session',
                  ],
                  type: 'string',
                },
                selected_label: {
                  type: 'string',
                },
              },
              required: [
                'decision',
              ],
              type: 'object',
            },
            session_id: {
              minLength: 1,
              type: 'string',
            },
            status: {
              enum: [
                'pending',
                'ended',
              ],
              type: 'string',
            },
            tool_call_id: {
              minLength: 1,
              type: 'string',
            },
            type: {
              const: 'interaction',
              type: 'string',
            },
          },
          required: [
            'type',
            'session_id',
            'agent_id',
            'event_created_at',
            'interaction_id',
            'status',
            'kind',
            'request',
          ],
          type: 'object',
        },
        {
          properties: {
            agent_id: {
              minLength: 1,
              type: 'string',
            },
            ended_at: {
              type: 'string',
            },
            event_created_at: {
              type: 'string',
            },
            interaction_id: {
              minLength: 1,
              type: 'string',
            },
            kind: {
              const: 'question',
              type: 'string',
            },
            outcome: {
              enum: [
                'approved',
                'rejected',
                'cancelled',
                'answered',
                'dismissed',
              ],
              type: 'string',
            },
            request: {
              properties: {
                questions: {
                  items: {
                    properties: {
                      allow_other: {
                        type: 'boolean',
                      },
                      body: {
                        type: 'string',
                      },
                      header: {
                        type: 'string',
                      },
                      id: {
                        minLength: 1,
                        type: 'string',
                      },
                      multi_select: {
                        type: 'boolean',
                      },
                      options: {
                        items: {
                          properties: {
                            description: {
                              type: 'string',
                            },
                            id: {
                              minLength: 1,
                              type: 'string',
                            },
                            label: {
                              minLength: 1,
                              type: 'string',
                            },
                          },
                          required: [
                            'id',
                            'label',
                          ],
                          type: 'object',
                        },
                        maxItems: 4,
                        minItems: 2,
                        type: 'array',
                      },
                      other_description: {
                        type: 'string',
                      },
                      other_label: {
                        type: 'string',
                      },
                      question: {
                        minLength: 1,
                        type: 'string',
                      },
                    },
                    required: [
                      'id',
                      'question',
                      'options',
                    ],
                    type: 'object',
                  },
                  maxItems: 4,
                  minItems: 1,
                  type: 'array',
                },
              },
              required: [
                'questions',
              ],
              type: 'object',
            },
            response: {
              properties: {
                answers: {
                  additionalProperties: {
                    anyOf: [
                      {
                        type: 'string',
                      },
                      {
                        const: true,
                        type: 'boolean',
                      },
                    ],
                  },
                  propertyNames: {
                    type: 'string',
                  },
                  type: 'object',
                },
                method: {
                  enum: [
                    'enter',
                    'space',
                    'number_key',
                    'click',
                  ],
                  type: 'string',
                },
              },
              required: [
                'answers',
              ],
              type: 'object',
            },
            session_id: {
              minLength: 1,
              type: 'string',
            },
            status: {
              enum: [
                'pending',
                'ended',
              ],
              type: 'string',
            },
            tool_call_id: {
              minLength: 1,
              type: 'string',
            },
            type: {
              const: 'interaction',
              type: 'string',
            },
          },
          required: [
            'type',
            'session_id',
            'agent_id',
            'event_created_at',
            'interaction_id',
            'status',
            'kind',
            'request',
          ],
          type: 'object',
        },
      ],
    },
  },
  {
    name: 'item',
    title: 'Item',
    summary: 'item.started or item.ended with the full item; it replaces the client copy of the item with the same item_id. item.ended is sent once per item, again only for a later authoritative replacement.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        event_created_at: {
          type: 'string',
        },
        item: {
          anyOf: [
            {
              properties: {
                attachments: {
                  items: {
                    properties: {
                      file_id: {
                        type: 'string',
                      },
                      kind: {
                        enum: [
                          'image',
                          'video',
                          'audio',
                          'file',
                        ],
                        type: 'string',
                      },
                      media_type: {
                        type: 'string',
                      },
                      name: {
                        type: 'string',
                      },
                      ordinal: {
                        exclusiveMinimum: 0,
                        maximum: 9007199254740991,
                        type: 'integer',
                      },
                      size: {
                        maximum: 9007199254740991,
                        minimum: 0,
                        type: 'integer',
                      },
                      url: {
                        type: 'string',
                      },
                    },
                    required: [
                      'kind',
                      'ordinal',
                    ],
                    type: 'object',
                  },
                  type: 'array',
                },
                created_at: {
                  type: 'string',
                },
                debug: {
                  properties: {
                    finish_reason: {
                      type: 'string',
                    },
                    timing: {
                      properties: {
                        client_blocked_ms: {
                          type: 'number',
                        },
                        client_consume_ms: {
                          type: 'number',
                        },
                        first_token_ms: {
                          type: 'number',
                        },
                        request_build_ms: {
                          type: 'number',
                        },
                        server_decode_ms: {
                          type: 'number',
                        },
                        server_first_token_ms: {
                          type: 'number',
                        },
                        stream_ms: {
                          type: 'number',
                        },
                      },
                      type: 'object',
                    },
                    usage: {
                      properties: {
                        input_cache_creation: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_cache_read: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_other: {
                          minimum: 0,
                          type: 'number',
                        },
                        output: {
                          minimum: 0,
                          type: 'number',
                        },
                      },
                      required: [
                        'input_other',
                        'output',
                        'input_cache_read',
                        'input_cache_creation',
                      ],
                      type: 'object',
                    },
                  },
                  type: 'object',
                },
                item_id: {
                  minLength: 1,
                  type: 'string',
                },
                metadata: {
                  additionalProperties: {},
                  propertyNames: {
                    type: 'string',
                  },
                  type: 'object',
                },
                origin: {
                  oneOf: [
                    {
                      properties: {
                        kind: {
                          const: 'user',
                          type: 'string',
                        },
                      },
                      required: [
                        'kind',
                      ],
                      type: 'object',
                    },
                    {
                      properties: {
                        args: {
                          type: 'string',
                        },
                        kind: {
                          const: 'skill',
                          type: 'string',
                        },
                        name: {
                          type: 'string',
                        },
                        path: {
                          type: 'string',
                        },
                      },
                      required: [
                        'kind',
                        'name',
                      ],
                      type: 'object',
                    },
                    {
                      properties: {
                        args: {
                          type: 'string',
                        },
                        command: {
                          type: 'string',
                        },
                        kind: {
                          const: 'plugin_command',
                          type: 'string',
                        },
                        plugin_id: {
                          type: 'string',
                        },
                      },
                      required: [
                        'kind',
                        'plugin_id',
                        'command',
                      ],
                      type: 'object',
                    },
                    {
                      properties: {
                        coalesced_count: {
                          maximum: 9007199254740991,
                          minimum: 0,
                          type: 'integer',
                        },
                        job_id: {
                          type: 'string',
                        },
                        kind: {
                          const: 'cron',
                          type: 'string',
                        },
                        recurring: {
                          type: 'boolean',
                        },
                        schedule: {
                          type: 'string',
                        },
                        stale: {
                          type: 'boolean',
                        },
                      },
                      required: [
                        'kind',
                        'job_id',
                        'schedule',
                        'recurring',
                        'coalesced_count',
                        'stale',
                      ],
                      type: 'object',
                    },
                    {
                      properties: {
                        hook_event: {
                          type: 'string',
                        },
                        kind: {
                          const: 'hook',
                          type: 'string',
                        },
                      },
                      required: [
                        'kind',
                        'hook_event',
                      ],
                      type: 'object',
                    },
                    {
                      properties: {
                        kind: {
                          const: 'goal',
                          type: 'string',
                        },
                      },
                      required: [
                        'kind',
                      ],
                      type: 'object',
                    },
                    {
                      properties: {
                        kind: {
                          const: 'retry',
                          type: 'string',
                        },
                      },
                      required: [
                        'kind',
                      ],
                      type: 'object',
                    },
                    {
                      properties: {
                        kind: {
                          const: 'system',
                          type: 'string',
                        },
                      },
                      required: [
                        'kind',
                      ],
                      type: 'object',
                    },
                  ],
                },
                outcome: {
                  enum: [
                    'completed',
                    'interrupted',
                    'failed',
                  ],
                  type: 'string',
                },
                placement: {
                  enum: [
                    'opener',
                    'steer',
                  ],
                  type: 'string',
                },
                prompt_ids: {
                  items: {
                    minLength: 1,
                    type: 'string',
                  },
                  type: 'array',
                },
                skills: {
                  items: {
                    properties: {
                      args: {
                        type: 'string',
                      },
                      name: {
                        type: 'string',
                      },
                      path: {
                        type: 'string',
                      },
                    },
                    required: [
                      'name',
                    ],
                    type: 'object',
                  },
                  type: 'array',
                },
                status: {
                  enum: [
                    'running',
                    'ended',
                  ],
                  type: 'string',
                },
                step_index: {
                  exclusiveMinimum: 0,
                  maximum: 9007199254740991,
                  type: 'integer',
                },
                text: {
                  type: 'string',
                },
                type: {
                  const: 'user_message',
                  type: 'string',
                },
              },
              required: [
                'type',
                'item_id',
                'status',
                'created_at',
                'prompt_ids',
                'placement',
                'origin',
                'text',
                'attachments',
                'skills',
              ],
              type: 'object',
            },
            {
              properties: {
                created_at: {
                  type: 'string',
                },
                debug: {
                  properties: {
                    finish_reason: {
                      type: 'string',
                    },
                    timing: {
                      properties: {
                        client_blocked_ms: {
                          type: 'number',
                        },
                        client_consume_ms: {
                          type: 'number',
                        },
                        first_token_ms: {
                          type: 'number',
                        },
                        request_build_ms: {
                          type: 'number',
                        },
                        server_decode_ms: {
                          type: 'number',
                        },
                        server_first_token_ms: {
                          type: 'number',
                        },
                        stream_ms: {
                          type: 'number',
                        },
                      },
                      type: 'object',
                    },
                    usage: {
                      properties: {
                        input_cache_creation: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_cache_read: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_other: {
                          minimum: 0,
                          type: 'number',
                        },
                        output: {
                          minimum: 0,
                          type: 'number',
                        },
                      },
                      required: [
                        'input_other',
                        'output',
                        'input_cache_read',
                        'input_cache_creation',
                      ],
                      type: 'object',
                    },
                  },
                  type: 'object',
                },
                item_id: {
                  minLength: 1,
                  type: 'string',
                },
                outcome: {
                  enum: [
                    'completed',
                    'interrupted',
                    'failed',
                  ],
                  type: 'string',
                },
                status: {
                  enum: [
                    'running',
                    'ended',
                  ],
                  type: 'string',
                },
                step_index: {
                  exclusiveMinimum: 0,
                  maximum: 9007199254740991,
                  type: 'integer',
                },
                text: {
                  type: 'string',
                },
                type: {
                  const: 'assistant_message',
                  type: 'string',
                },
              },
              required: [
                'type',
                'item_id',
                'status',
                'created_at',
                'text',
              ],
              type: 'object',
            },
            {
              properties: {
                created_at: {
                  type: 'string',
                },
                debug: {
                  properties: {
                    finish_reason: {
                      type: 'string',
                    },
                    timing: {
                      properties: {
                        client_blocked_ms: {
                          type: 'number',
                        },
                        client_consume_ms: {
                          type: 'number',
                        },
                        first_token_ms: {
                          type: 'number',
                        },
                        request_build_ms: {
                          type: 'number',
                        },
                        server_decode_ms: {
                          type: 'number',
                        },
                        server_first_token_ms: {
                          type: 'number',
                        },
                        stream_ms: {
                          type: 'number',
                        },
                      },
                      type: 'object',
                    },
                    usage: {
                      properties: {
                        input_cache_creation: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_cache_read: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_other: {
                          minimum: 0,
                          type: 'number',
                        },
                        output: {
                          minimum: 0,
                          type: 'number',
                        },
                      },
                      required: [
                        'input_other',
                        'output',
                        'input_cache_read',
                        'input_cache_creation',
                      ],
                      type: 'object',
                    },
                  },
                  type: 'object',
                },
                duration_ms: {
                  maximum: 9007199254740991,
                  minimum: 0,
                  type: 'integer',
                },
                item_id: {
                  minLength: 1,
                  type: 'string',
                },
                outcome: {
                  enum: [
                    'completed',
                    'interrupted',
                    'failed',
                  ],
                  type: 'string',
                },
                started_at: {
                  type: 'string',
                },
                status: {
                  enum: [
                    'running',
                    'ended',
                  ],
                  type: 'string',
                },
                step_index: {
                  exclusiveMinimum: 0,
                  maximum: 9007199254740991,
                  type: 'integer',
                },
                text: {
                  type: 'string',
                },
                type: {
                  const: 'reasoning',
                  type: 'string',
                },
              },
              required: [
                'type',
                'item_id',
                'status',
                'created_at',
                'text',
                'started_at',
              ],
              type: 'object',
            },
            {
              properties: {
                agent_refs: {
                  items: {
                    properties: {
                      agent_id: {
                        minLength: 1,
                        type: 'string',
                      },
                      role: {
                        enum: [
                          'child',
                          'member',
                        ],
                        type: 'string',
                      },
                      swarm_index: {
                        maximum: 9007199254740991,
                        minimum: 0,
                        type: 'integer',
                      },
                      task_id: {
                        type: 'string',
                      },
                    },
                    required: [
                      'agent_id',
                      'role',
                    ],
                    type: 'object',
                  },
                  type: 'array',
                },
                created_at: {
                  type: 'string',
                },
                debug: {
                  properties: {
                    finish_reason: {
                      type: 'string',
                    },
                    timing: {
                      properties: {
                        client_blocked_ms: {
                          type: 'number',
                        },
                        client_consume_ms: {
                          type: 'number',
                        },
                        first_token_ms: {
                          type: 'number',
                        },
                        request_build_ms: {
                          type: 'number',
                        },
                        server_decode_ms: {
                          type: 'number',
                        },
                        server_first_token_ms: {
                          type: 'number',
                        },
                        stream_ms: {
                          type: 'number',
                        },
                      },
                      type: 'object',
                    },
                    usage: {
                      properties: {
                        input_cache_creation: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_cache_read: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_other: {
                          minimum: 0,
                          type: 'number',
                        },
                        output: {
                          minimum: 0,
                          type: 'number',
                        },
                      },
                      required: [
                        'input_other',
                        'output',
                        'input_cache_read',
                        'input_cache_creation',
                      ],
                      type: 'object',
                    },
                  },
                  type: 'object',
                },
                display: {},
                ended_at: {
                  type: 'string',
                },
                error: {
                  type: 'string',
                },
                fields: {
                  additionalProperties: {},
                  propertyNames: {
                    type: 'string',
                  },
                  type: 'object',
                },
                input: {},
                input_text: {
                  type: 'string',
                },
                interaction_id: {
                  type: 'string',
                },
                item_id: {
                  minLength: 1,
                  type: 'string',
                },
                media: {
                  items: {
                    properties: {
                      file_id: {
                        type: 'string',
                      },
                      kind: {
                        enum: [
                          'image',
                          'video',
                          'audio',
                        ],
                        type: 'string',
                      },
                      media_type: {
                        type: 'string',
                      },
                      url: {
                        type: 'string',
                      },
                    },
                    required: [
                      'kind',
                    ],
                    type: 'object',
                  },
                  type: 'array',
                },
                name: {
                  type: 'string',
                },
                note: {
                  type: 'string',
                },
                outcome: {
                  enum: [
                    'completed',
                    'interrupted',
                    'failed',
                  ],
                  type: 'string',
                },
                output: {
                  type: 'string',
                },
                stage: {
                  enum: [
                    'input',
                    'awaiting_approval',
                    'executing',
                  ],
                  type: 'string',
                },
                started_at: {
                  type: 'string',
                },
                status: {
                  enum: [
                    'running',
                    'ended',
                  ],
                  type: 'string',
                },
                step_index: {
                  exclusiveMinimum: 0,
                  maximum: 9007199254740991,
                  type: 'integer',
                },
                task_id: {
                  type: 'string',
                },
                type: {
                  const: 'tool_call',
                  type: 'string',
                },
              },
              required: [
                'type',
                'item_id',
                'status',
                'created_at',
                'name',
                'started_at',
              ],
              type: 'object',
            },
            {
              properties: {
                agent_id: {
                  type: 'string',
                },
                answer: {
                  properties: {
                    answers: {
                      additionalProperties: {
                        anyOf: [
                          {
                            type: 'string',
                          },
                          {
                            const: true,
                            type: 'boolean',
                          },
                        ],
                      },
                      propertyNames: {
                        type: 'string',
                      },
                      type: 'object',
                    },
                    note: {
                      type: 'string',
                    },
                  },
                  required: [
                    'answers',
                  ],
                  type: 'object',
                },
                body: {
                  type: 'string',
                },
                created_at: {
                  type: 'string',
                },
                debug: {
                  properties: {
                    finish_reason: {
                      type: 'string',
                    },
                    timing: {
                      properties: {
                        client_blocked_ms: {
                          type: 'number',
                        },
                        client_consume_ms: {
                          type: 'number',
                        },
                        first_token_ms: {
                          type: 'number',
                        },
                        request_build_ms: {
                          type: 'number',
                        },
                        server_decode_ms: {
                          type: 'number',
                        },
                        server_first_token_ms: {
                          type: 'number',
                        },
                        stream_ms: {
                          type: 'number',
                        },
                      },
                      type: 'object',
                    },
                    usage: {
                      properties: {
                        input_cache_creation: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_cache_read: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_other: {
                          minimum: 0,
                          type: 'number',
                        },
                        output: {
                          minimum: 0,
                          type: 'number',
                        },
                      },
                      required: [
                        'input_other',
                        'output',
                        'input_cache_read',
                        'input_cache_creation',
                      ],
                      type: 'object',
                    },
                  },
                  type: 'object',
                },
                item_id: {
                  minLength: 1,
                  type: 'string',
                },
                notification_id: {
                  type: 'string',
                },
                notification_type: {
                  type: 'string',
                },
                outcome: {
                  enum: [
                    'completed',
                    'interrupted',
                    'failed',
                  ],
                  type: 'string',
                },
                output: {
                  properties: {
                    bytes: {
                      maximum: 9007199254740991,
                      minimum: 0,
                      type: 'integer',
                    },
                    file: {
                      type: 'string',
                    },
                    preview: {
                      type: 'string',
                    },
                    truncated: {
                      type: 'boolean',
                    },
                  },
                  type: 'object',
                },
                severity: {
                  enum: [
                    'info',
                    'warning',
                    'error',
                  ],
                  type: 'string',
                },
                source: {
                  properties: {
                    id: {
                      type: 'string',
                    },
                    kind: {
                      type: 'string',
                    },
                  },
                  required: [
                    'kind',
                    'id',
                  ],
                  type: 'object',
                },
                status: {
                  enum: [
                    'running',
                    'ended',
                  ],
                  type: 'string',
                },
                step_index: {
                  exclusiveMinimum: 0,
                  maximum: 9007199254740991,
                  type: 'integer',
                },
                task_id: {
                  type: 'string',
                },
                title: {
                  type: 'string',
                },
                type: {
                  const: 'notification',
                  type: 'string',
                },
              },
              required: [
                'type',
                'item_id',
                'status',
                'created_at',
                'notification_id',
                'title',
                'body',
                'severity',
                'notification_type',
                'source',
              ],
              type: 'object',
            },
            {
              properties: {
                compacted_count: {
                  maximum: 9007199254740991,
                  minimum: 0,
                  type: 'integer',
                },
                created_at: {
                  type: 'string',
                },
                debug: {
                  properties: {
                    finish_reason: {
                      type: 'string',
                    },
                    timing: {
                      properties: {
                        client_blocked_ms: {
                          type: 'number',
                        },
                        client_consume_ms: {
                          type: 'number',
                        },
                        first_token_ms: {
                          type: 'number',
                        },
                        request_build_ms: {
                          type: 'number',
                        },
                        server_decode_ms: {
                          type: 'number',
                        },
                        server_first_token_ms: {
                          type: 'number',
                        },
                        stream_ms: {
                          type: 'number',
                        },
                      },
                      type: 'object',
                    },
                    usage: {
                      properties: {
                        input_cache_creation: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_cache_read: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_other: {
                          minimum: 0,
                          type: 'number',
                        },
                        output: {
                          minimum: 0,
                          type: 'number',
                        },
                      },
                      required: [
                        'input_other',
                        'output',
                        'input_cache_read',
                        'input_cache_creation',
                      ],
                      type: 'object',
                    },
                  },
                  type: 'object',
                },
                instruction: {
                  type: 'string',
                },
                item_id: {
                  minLength: 1,
                  type: 'string',
                },
                kind: {
                  const: 'compaction',
                  type: 'string',
                },
                outcome: {
                  enum: [
                    'completed',
                    'interrupted',
                    'failed',
                  ],
                  type: 'string',
                },
                status: {
                  enum: [
                    'running',
                    'ended',
                  ],
                  type: 'string',
                },
                step_index: {
                  exclusiveMinimum: 0,
                  maximum: 9007199254740991,
                  type: 'integer',
                },
                summary: {
                  type: 'string',
                },
                tokens_after: {
                  minimum: 0,
                  type: 'number',
                },
                tokens_before: {
                  minimum: 0,
                  type: 'number',
                },
                trigger: {
                  enum: [
                    'manual',
                    'auto',
                  ],
                  type: 'string',
                },
                type: {
                  const: 'system',
                  type: 'string',
                },
              },
              required: [
                'type',
                'item_id',
                'status',
                'created_at',
                'kind',
                'trigger',
              ],
              type: 'object',
            },
            {
              properties: {
                created_at: {
                  type: 'string',
                },
                debug: {
                  properties: {
                    finish_reason: {
                      type: 'string',
                    },
                    timing: {
                      properties: {
                        client_blocked_ms: {
                          type: 'number',
                        },
                        client_consume_ms: {
                          type: 'number',
                        },
                        first_token_ms: {
                          type: 'number',
                        },
                        request_build_ms: {
                          type: 'number',
                        },
                        server_decode_ms: {
                          type: 'number',
                        },
                        server_first_token_ms: {
                          type: 'number',
                        },
                        stream_ms: {
                          type: 'number',
                        },
                      },
                      type: 'object',
                    },
                    usage: {
                      properties: {
                        input_cache_creation: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_cache_read: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_other: {
                          minimum: 0,
                          type: 'number',
                        },
                        output: {
                          minimum: 0,
                          type: 'number',
                        },
                      },
                      required: [
                        'input_other',
                        'output',
                        'input_cache_read',
                        'input_cache_creation',
                      ],
                      type: 'object',
                    },
                  },
                  type: 'object',
                },
                forked_from: {
                  properties: {
                    agent_id: {
                      minLength: 1,
                      type: 'string',
                    },
                  },
                  required: [
                    'agent_id',
                  ],
                  type: 'object',
                },
                item_id: {
                  minLength: 1,
                  type: 'string',
                },
                kind: {
                  const: 'fork_boundary',
                  type: 'string',
                },
                outcome: {
                  enum: [
                    'completed',
                    'interrupted',
                    'failed',
                  ],
                  type: 'string',
                },
                source: {
                  enum: [
                    'btw',
                    'fork',
                  ],
                  type: 'string',
                },
                status: {
                  enum: [
                    'running',
                    'ended',
                  ],
                  type: 'string',
                },
                step_index: {
                  exclusiveMinimum: 0,
                  maximum: 9007199254740991,
                  type: 'integer',
                },
                type: {
                  const: 'system',
                  type: 'string',
                },
              },
              required: [
                'type',
                'item_id',
                'status',
                'created_at',
                'kind',
                'source',
                'forked_from',
              ],
              type: 'object',
            },
          ],
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        turn_id: {
          minLength: 1,
          type: 'string',
        },
        type: {
          enum: [
            'item.started',
            'item.ended',
          ],
          type: 'string',
        },
      },
      required: [
        'type',
        'session_id',
        'agent_id',
        'event_created_at',
        'turn_id',
        'item',
      ],
      type: 'object',
    },
  },
  {
    name: 'item.delta',
    title: 'Item Delta',
    summary: 'Text appended to field of a running item: text of assistant_message and reasoning, input_text and output of tool_call.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        delta: {
          type: 'string',
        },
        event_created_at: {
          type: 'string',
        },
        field: {
          enum: [
            'text',
            'input_text',
            'output',
          ],
          type: 'string',
        },
        item_id: {
          minLength: 1,
          type: 'string',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        turn_id: {
          minLength: 1,
          type: 'string',
        },
        type: {
          const: 'item.delta',
          type: 'string',
        },
      },
      required: [
        'type',
        'session_id',
        'agent_id',
        'event_created_at',
        'turn_id',
        'item_id',
        'field',
        'delta',
      ],
      type: 'object',
    },
  },
  {
    name: 'item.removed',
    title: 'Item Removed',
    summary: 'A running item that will not be finished, for example after a request retry restarts the step.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        event_created_at: {
          type: 'string',
        },
        item_id: {
          minLength: 1,
          type: 'string',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        turn_id: {
          minLength: 1,
          type: 'string',
        },
        type: {
          const: 'item.removed',
          type: 'string',
        },
      },
      required: [
        'type',
        'session_id',
        'agent_id',
        'event_created_at',
        'turn_id',
        'item_id',
      ],
      type: 'object',
    },
  },
  {
    name: 'item.updated',
    title: 'Item Updated',
    summary: 'Fields of a running tool_call item that changed; set is merged shallowly into the client copy.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        event_created_at: {
          type: 'string',
        },
        item_id: {
          minLength: 1,
          type: 'string',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        set: {
          properties: {
            agent_refs: {
              items: {
                properties: {
                  agent_id: {
                    minLength: 1,
                    type: 'string',
                  },
                  role: {
                    enum: [
                      'child',
                      'member',
                    ],
                    type: 'string',
                  },
                  swarm_index: {
                    maximum: 9007199254740991,
                    minimum: 0,
                    type: 'integer',
                  },
                  task_id: {
                    type: 'string',
                  },
                },
                required: [
                  'agent_id',
                  'role',
                ],
                type: 'object',
              },
              type: 'array',
            },
            created_at: {
              type: 'string',
            },
            debug: {
              properties: {
                finish_reason: {
                  type: 'string',
                },
                timing: {
                  properties: {
                    client_blocked_ms: {
                      type: 'number',
                    },
                    client_consume_ms: {
                      type: 'number',
                    },
                    first_token_ms: {
                      type: 'number',
                    },
                    request_build_ms: {
                      type: 'number',
                    },
                    server_decode_ms: {
                      type: 'number',
                    },
                    server_first_token_ms: {
                      type: 'number',
                    },
                    stream_ms: {
                      type: 'number',
                    },
                  },
                  type: 'object',
                },
                usage: {
                  properties: {
                    input_cache_creation: {
                      minimum: 0,
                      type: 'number',
                    },
                    input_cache_read: {
                      minimum: 0,
                      type: 'number',
                    },
                    input_other: {
                      minimum: 0,
                      type: 'number',
                    },
                    output: {
                      minimum: 0,
                      type: 'number',
                    },
                  },
                  required: [
                    'input_other',
                    'output',
                    'input_cache_read',
                    'input_cache_creation',
                  ],
                  type: 'object',
                },
              },
              type: 'object',
            },
            display: {},
            ended_at: {
              type: 'string',
            },
            error: {
              type: 'string',
            },
            fields: {
              additionalProperties: {},
              propertyNames: {
                type: 'string',
              },
              type: 'object',
            },
            input: {},
            input_text: {
              type: 'string',
            },
            interaction_id: {
              type: 'string',
            },
            media: {
              items: {
                properties: {
                  file_id: {
                    type: 'string',
                  },
                  kind: {
                    enum: [
                      'image',
                      'video',
                      'audio',
                    ],
                    type: 'string',
                  },
                  media_type: {
                    type: 'string',
                  },
                  url: {
                    type: 'string',
                  },
                },
                required: [
                  'kind',
                ],
                type: 'object',
              },
              type: 'array',
            },
            name: {
              type: 'string',
            },
            note: {
              type: 'string',
            },
            outcome: {
              enum: [
                'completed',
                'interrupted',
                'failed',
              ],
              type: 'string',
            },
            output: {
              type: 'string',
            },
            stage: {
              enum: [
                'input',
                'awaiting_approval',
                'executing',
              ],
              type: 'string',
            },
            started_at: {
              type: 'string',
            },
            status: {
              enum: [
                'running',
                'ended',
              ],
              type: 'string',
            },
            step_index: {
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
              type: 'integer',
            },
            task_id: {
              type: 'string',
            },
          },
          type: 'object',
        },
        turn_id: {
          minLength: 1,
          type: 'string',
        },
        type: {
          const: 'item.updated',
          type: 'string',
        },
      },
      required: [
        'type',
        'session_id',
        'agent_id',
        'event_created_at',
        'turn_id',
        'item_id',
        'set',
      ],
      type: 'object',
    },
  },
  {
    name: 'notice',
    title: 'Notice',
    summary: 'Live warning or error raised by an agent, such as a context compaction that did not finish; not part of the turns and not sent again on subscribe.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        code: {
          type: 'string',
        },
        detail: {
          type: 'string',
        },
        event_created_at: {
          type: 'string',
        },
        level: {
          enum: [
            'info',
            'warning',
            'error',
          ],
          type: 'string',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        title: {
          type: 'string',
        },
        type: {
          const: 'notice',
          type: 'string',
        },
      },
      required: [
        'level',
        'title',
        'type',
        'session_id',
        'agent_id',
        'event_created_at',
      ],
      type: 'object',
    },
  },
  {
    name: 'ping',
    title: 'Ping',
    summary: 'Heartbeat sent by the server every 10 seconds; clients answer with pong. The server closes a connection that sends nothing for 20 seconds, and a client that receives nothing for 25 seconds should reconnect.',
    direction: 'server_to_client',
    payload: {
      properties: {
        type: {
          const: 'ping',
          type: 'string',
        },
      },
      required: [
        'type',
      ],
      type: 'object',
    },
  },
  {
    name: 'pong',
    title: 'Pong',
    summary: 'Reply to a server ping.',
    direction: 'client_to_server',
    payload: {
      properties: {
        type: {
          const: 'pong',
          type: 'string',
        },
      },
      required: [
        'type',
      ],
      type: 'object',
    },
  },
  {
    name: 'response',
    title: 'Response',
    summary: 'Reply to one client command, matched by request_id; code 0 means success. Replies to task.watch, task.stop and task.background carry the task state. A command without a request_id closes the connection with code 1008.',
    direction: 'server_to_client',
    payload: {
      properties: {
        code: {
          maximum: 9007199254740991,
          minimum: -9007199254740991,
          type: 'integer',
        },
        msg: {
          type: 'string',
        },
        request_id: {
          type: 'string',
        },
        task: {
          properties: {
            child_agent_id: {
              type: 'string',
            },
            command: {
              type: 'string',
            },
            description: {
              type: 'string',
            },
            detached: {
              type: 'boolean',
            },
            ended_at: {
              type: 'string',
            },
            error: {
              type: 'string',
            },
            kind: {
              enum: [
                'shell',
                'subagent',
                'other',
              ],
              type: 'string',
            },
            model: {
              type: 'string',
            },
            outcome: {
              enum: [
                'completed',
                'failed',
                'timed_out',
                'killed',
                'lost',
              ],
              type: 'string',
            },
            parent_tool_call_id: {
              type: 'string',
            },
            phase: {
              enum: [
                'working',
                'suspended',
              ],
              type: 'string',
            },
            result_summary: {
              type: 'string',
            },
            started_at: {
              type: 'string',
            },
            state_reason: {
              type: 'string',
            },
            status: {
              enum: [
                'running',
                'ended',
              ],
              type: 'string',
            },
            swarm_index: {
              maximum: 9007199254740991,
              minimum: 0,
              type: 'integer',
            },
            task_id: {
              minLength: 1,
              type: 'string',
            },
            thinking: {
              type: 'string',
            },
          },
          required: [
            'task_id',
            'kind',
            'status',
            'detached',
          ],
          type: 'object',
        },
        type: {
          const: 'response',
          type: 'string',
        },
      },
      required: [
        'type',
        'request_id',
        'code',
      ],
      type: 'object',
    },
  },
  {
    name: 'session_event',
    title: 'Session Event',
    summary: 'Flat global event sent to every connection with event_created_at and its full state.',
    direction: 'server_to_client',
    payload: {
      oneOf: [
        {
          properties: {
            change: {
              enum: [
                'created',
                'updated',
                'archived',
                'restored',
                'deleted',
              ],
              type: 'string',
            },
            event_created_at: {
              type: 'string',
            },
            session: {
              properties: {
                activity: {
                  enum: [
                    'idle',
                    'turn',
                    'background',
                  ],
                  type: 'string',
                },
                archived: {
                  type: 'boolean',
                },
                archived_at: {
                  type: 'string',
                },
                created_at: {
                  type: 'string',
                },
                cwd: {
                  deprecated: true,
                  type: 'string',
                },
                environment_cwd: {
                  type: 'string',
                },
                environment_id: {
                  type: 'string',
                },
                git: {
                  properties: {
                    branch: {
                      type: 'string',
                    },
                    pull_request: {
                      properties: {
                        number: {
                          maximum: 9007199254740991,
                          minimum: -9007199254740991,
                          type: 'integer',
                        },
                        state: {
                          enum: [
                            'open',
                            'closed',
                            'merged',
                          ],
                          type: 'string',
                        },
                        url: {
                          type: 'string',
                        },
                      },
                      required: [
                        'number',
                        'state',
                        'url',
                      ],
                      type: 'object',
                    },
                  },
                  type: 'object',
                },
                host_id: {
                  type: 'string',
                },
                id: {
                  minLength: 1,
                  type: 'string',
                },
                last_prompt: {
                  type: 'string',
                },
                last_turn_outcome: {
                  enum: [
                    'completed',
                    'interrupted',
                    'failed',
                  ],
                  type: 'string',
                },
                metadata: {
                  additionalProperties: {},
                  propertyNames: {
                    type: 'string',
                  },
                  type: 'object',
                },
                pending_interaction: {
                  enum: [
                    'none',
                    'approval',
                    'question',
                  ],
                  type: 'string',
                },
                title: {
                  type: 'string',
                },
                updated_at: {
                  type: 'string',
                },
                workspace_id: {
                  pattern: '^wd_[a-z0-9._-]+_[0-9a-f]{12}$|^wm_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
                  type: 'string',
                },
                workspace_root: {
                  type: 'string',
                },
              },
              required: [
                'id',
                'workspace_id',
                'cwd',
                'title',
                'created_at',
                'updated_at',
                'activity',
              ],
              type: 'object',
            },
            type: {
              const: 'session',
              type: 'string',
            },
          },
          required: [
            'type',
            'change',
            'session',
            'event_created_at',
          ],
          type: 'object',
        },
        {
          properties: {
            change: {
              enum: [
                'created',
                'updated',
                'deleted',
              ],
              type: 'string',
            },
            event_created_at: {
              type: 'string',
            },
            type: {
              const: 'workspace',
              type: 'string',
            },
            workspace: {
              properties: {
                additional_dirs: {
                  items: {
                    type: 'string',
                  },
                  type: 'array',
                },
                created_at: {
                  type: 'string',
                },
                id: {
                  pattern: '^wd_[a-z0-9._-]+_[0-9a-f]{12}$|^wm_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
                  type: 'string',
                },
                kind: {
                  enum: [
                    'managed',
                    'implicit',
                  ],
                  type: 'string',
                },
                last_opened_at: {
                  type: 'string',
                },
                name: {
                  maxLength: 100,
                  minLength: 1,
                  type: 'string',
                },
                root: {
                  minLength: 1,
                  type: 'string',
                },
                session_count: {
                  maximum: 9007199254740991,
                  minimum: 0,
                  type: 'integer',
                },
              },
              required: [
                'id',
                'root',
                'name',
                'kind',
                'additional_dirs',
                'created_at',
                'last_opened_at',
                'session_count',
              ],
              type: 'object',
            },
          },
          required: [
            'type',
            'change',
            'workspace',
            'event_created_at',
          ],
          type: 'object',
        },
        {
          properties: {
            config: {
              additionalProperties: {},
              properties: {
                auto_session_title: {
                  type: 'boolean',
                },
                background: {},
                default_model: {
                  type: 'string',
                },
                default_permission_mode: {
                  type: 'string',
                },
                default_plan_mode: {
                  type: 'boolean',
                },
                default_provider: {
                  type: 'string',
                },
                disable_feedback_survey: {
                  type: 'boolean',
                },
                experimental: {
                  additionalProperties: {
                    type: 'boolean',
                  },
                  propertyNames: {
                    type: 'string',
                  },
                  type: 'object',
                },
                extra_skill_dirs: {
                  items: {
                    type: 'string',
                  },
                  type: 'array',
                },
                hooks: {
                  items: {},
                  type: 'array',
                },
                loop_control: {},
                merge_all_available_skills: {
                  type: 'boolean',
                },
                models: {
                  additionalProperties: {},
                  propertyNames: {
                    type: 'string',
                  },
                  type: 'object',
                },
                permission: {},
                plan_mode: {
                  type: 'boolean',
                },
                providers: {
                  additionalProperties: {
                    properties: {
                      api_key_env: {
                        type: 'string',
                      },
                      base_url: {
                        type: 'string',
                      },
                      default_model: {
                        type: 'string',
                      },
                      has_api_key: {
                        type: 'boolean',
                      },
                      type: {
                        type: 'string',
                      },
                    },
                    required: [
                      'type',
                      'has_api_key',
                    ],
                    type: 'object',
                  },
                  default: {},
                  propertyNames: {
                    type: 'string',
                  },
                  type: 'object',
                },
                raw: {
                  additionalProperties: {},
                  propertyNames: {
                    type: 'string',
                  },
                  type: 'object',
                },
                secondary_model: {},
                services: {},
                subagent: {},
                telemetry: {
                  type: 'boolean',
                },
                thinking: {},
                yolo: {
                  type: 'boolean',
                },
              },
              type: 'object',
            },
            event_created_at: {
              type: 'string',
            },
            type: {
              const: 'config',
              type: 'string',
            },
            warnings: {
              items: {
                properties: {
                  domain: {
                    type: 'string',
                  },
                  message: {
                    type: 'string',
                  },
                },
                required: [
                  'message',
                ],
                type: 'object',
              },
              type: 'array',
            },
          },
          required: [
            'type',
            'config',
            'event_created_at',
          ],
          type: 'object',
        },
        {
          properties: {
            event_created_at: {
              type: 'string',
            },
            kind: {
              enum: [
                'models',
                'plugins',
              ],
              type: 'string',
            },
            type: {
              const: 'invalidated',
              type: 'string',
            },
          },
          required: [
            'type',
            'kind',
            'event_created_at',
          ],
          type: 'object',
        },
        {
          properties: {
            capability_id: {
              type: 'string',
            },
            event_created_at: {
              type: 'string',
            },
            install: {
              properties: {
                confirmation_required: {
                  const: 'stop-processes',
                  type: 'string',
                },
                error: {
                  type: 'string',
                },
                note: {
                  type: 'string',
                },
                percent: {
                  maximum: 100,
                  minimum: 0,
                  type: 'number',
                },
                running: {
                  type: 'boolean',
                },
                step: {
                  type: 'string',
                },
              },
              required: [
                'running',
              ],
              type: 'object',
            },
            type: {
              const: 'event.capability.changed',
              type: 'string',
            },
          },
          required: [
            'type',
            'capability_id',
            'install',
            'event_created_at',
          ],
          type: 'object',
        },
        {
          properties: {
            event_created_at: {
              type: 'string',
            },
            hosts: {
              items: {
                properties: {
                  connect_error: {
                    type: 'string',
                  },
                  connect_failure: {
                    type: 'string',
                  },
                  enabled: {
                    type: 'boolean',
                  },
                  host: {
                    type: 'string',
                  },
                  id: {
                    type: 'string',
                  },
                  identity_file: {
                    type: 'string',
                  },
                  name: {
                    type: 'string',
                  },
                  remote_bin: {
                    type: 'string',
                  },
                  remote_version: {
                    type: 'string',
                  },
                  status: {
                    enum: [
                      'pending',
                      'connecting',
                      'ready',
                      'disconnected',
                    ],
                    type: 'string',
                  },
                },
                required: [
                  'id',
                  'host',
                  'status',
                ],
                type: 'object',
              },
              type: 'array',
            },
            type: {
              const: 'event.host.changed',
              type: 'string',
            },
          },
          required: [
            'type',
            'hosts',
            'event_created_at',
          ],
          type: 'object',
        },
      ],
    },
  },
  {
    name: 'subscribe',
    title: 'Subscribe',
    summary: 'Start receiving agents of one session (agent_ids defaults to the main agent). The response comes first; then every newly added agent gets a turns frame with its latest page, or turns.failed when its conversation cannot be loaded, then turn, item and notice frames. When the session itself cannot be opened, the response carries the error code (40401 when it does not exist) and nothing is subscribed.',
    direction: 'client_to_server',
    payload: {
      properties: {
        agent_ids: {
          items: {
            minLength: 1,
            type: 'string',
          },
          minItems: 1,
          type: 'array',
        },
        request_id: {
          minLength: 1,
          type: 'string',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        type: {
          const: 'subscribe',
          type: 'string',
        },
      },
      required: [
        'type',
        'request_id',
        'session_id',
      ],
      type: 'object',
    },
  },
  {
    name: 'task',
    title: 'Task',
    summary: 'Full state of one task of a subscribed agent, sent on every change; the frame for an ended task is its last one.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        child_agent_id: {
          type: 'string',
        },
        command: {
          type: 'string',
        },
        description: {
          type: 'string',
        },
        detached: {
          type: 'boolean',
        },
        ended_at: {
          type: 'string',
        },
        error: {
          type: 'string',
        },
        event_created_at: {
          type: 'string',
        },
        kind: {
          enum: [
            'shell',
            'subagent',
            'other',
          ],
          type: 'string',
        },
        model: {
          type: 'string',
        },
        outcome: {
          enum: [
            'completed',
            'failed',
            'timed_out',
            'killed',
            'lost',
          ],
          type: 'string',
        },
        parent_tool_call_id: {
          type: 'string',
        },
        phase: {
          enum: [
            'working',
            'suspended',
          ],
          type: 'string',
        },
        result_summary: {
          type: 'string',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        started_at: {
          type: 'string',
        },
        state_reason: {
          type: 'string',
        },
        status: {
          enum: [
            'running',
            'ended',
          ],
          type: 'string',
        },
        swarm_index: {
          maximum: 9007199254740991,
          minimum: 0,
          type: 'integer',
        },
        task_id: {
          minLength: 1,
          type: 'string',
        },
        thinking: {
          type: 'string',
        },
        type: {
          const: 'task',
          type: 'string',
        },
      },
      required: [
        'task_id',
        'kind',
        'status',
        'detached',
        'type',
        'session_id',
        'agent_id',
        'event_created_at',
      ],
      type: 'object',
    },
  },
  {
    name: 'task.background',
    title: 'Task Background',
    summary: 'Stop the tool call that started a task from waiting for it, so the task keeps running in the background; the response carries its state.',
    direction: 'client_to_server',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        request_id: {
          minLength: 1,
          type: 'string',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        task_id: {
          minLength: 1,
          type: 'string',
        },
        type: {
          const: 'task.background',
          type: 'string',
        },
      },
      required: [
        'type',
        'request_id',
        'session_id',
        'agent_id',
        'task_id',
      ],
      type: 'object',
    },
  },
  {
    name: 'task.list',
    title: 'Task List',
    summary: 'Every task an agent is running right now, sent when a connection starts receiving that agent; it replaces the client list.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        tasks: {
          items: {
            properties: {
              child_agent_id: {
                type: 'string',
              },
              command: {
                type: 'string',
              },
              description: {
                type: 'string',
              },
              detached: {
                type: 'boolean',
              },
              ended_at: {
                type: 'string',
              },
              error: {
                type: 'string',
              },
              kind: {
                enum: [
                  'shell',
                  'subagent',
                  'other',
                ],
                type: 'string',
              },
              model: {
                type: 'string',
              },
              outcome: {
                enum: [
                  'completed',
                  'failed',
                  'timed_out',
                  'killed',
                  'lost',
                ],
                type: 'string',
              },
              parent_tool_call_id: {
                type: 'string',
              },
              phase: {
                enum: [
                  'working',
                  'suspended',
                ],
                type: 'string',
              },
              result_summary: {
                type: 'string',
              },
              started_at: {
                type: 'string',
              },
              state_reason: {
                type: 'string',
              },
              status: {
                enum: [
                  'running',
                  'ended',
                ],
                type: 'string',
              },
              swarm_index: {
                maximum: 9007199254740991,
                minimum: 0,
                type: 'integer',
              },
              task_id: {
                minLength: 1,
                type: 'string',
              },
              thinking: {
                type: 'string',
              },
            },
            required: [
              'task_id',
              'kind',
              'status',
              'detached',
            ],
            type: 'object',
          },
          type: 'array',
        },
        type: {
          const: 'task.list',
          type: 'string',
        },
      },
      required: [
        'type',
        'session_id',
        'agent_id',
        'tasks',
      ],
      type: 'object',
    },
  },
  {
    name: 'task.output',
    title: 'Task Output',
    summary: 'Task output starting at a UTF-8 byte offset, sent only to connections watching the task.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        offset: {
          maximum: 9007199254740991,
          minimum: 0,
          type: 'integer',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        task_id: {
          minLength: 1,
          type: 'string',
        },
        text: {
          type: 'string',
        },
        type: {
          const: 'task.output',
          type: 'string',
        },
      },
      required: [
        'type',
        'session_id',
        'agent_id',
        'task_id',
        'offset',
        'text',
      ],
      type: 'object',
    },
  },
  {
    name: 'task.stop',
    title: 'Task Stop',
    summary: 'Stop one task; the response carries its state, and an ended task just replies with it.',
    direction: 'client_to_server',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        request_id: {
          minLength: 1,
          type: 'string',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        task_id: {
          minLength: 1,
          type: 'string',
        },
        type: {
          const: 'task.stop',
          type: 'string',
        },
      },
      required: [
        'type',
        'request_id',
        'session_id',
        'agent_id',
        'task_id',
      ],
      type: 'object',
    },
  },
  {
    name: 'task.unwatch',
    title: 'Task Unwatch',
    summary: 'Stop streaming one task\'s output to this connection.',
    direction: 'client_to_server',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        request_id: {
          minLength: 1,
          type: 'string',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        task_id: {
          minLength: 1,
          type: 'string',
        },
        type: {
          const: 'task.unwatch',
          type: 'string',
        },
      },
      required: [
        'type',
        'request_id',
        'session_id',
        'agent_id',
        'task_id',
      ],
      type: 'object',
    },
  },
  {
    name: 'task.watch',
    title: 'Task Watch',
    summary: 'Stream the output of one task owned by agent_id to this connection without a session subscription. The first chunk covers at most tail_bytes; since_offset resumes after output the client already has.',
    direction: 'client_to_server',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        request_id: {
          minLength: 1,
          type: 'string',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        since_offset: {
          maximum: 9007199254740991,
          minimum: 0,
          type: 'integer',
        },
        tail_bytes: {
          maximum: 1048576,
          minimum: 1,
          type: 'integer',
        },
        task_id: {
          minLength: 1,
          type: 'string',
        },
        type: {
          const: 'task.watch',
          type: 'string',
        },
      },
      required: [
        'type',
        'request_id',
        'session_id',
        'agent_id',
        'task_id',
      ],
      type: 'object',
    },
  },
  {
    name: 'todo',
    title: 'Todo',
    summary: 'Todo list of one subscribed agent, sent when a connection starts receiving that agent and on every change, including undo; it replaces the client list.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        event_created_at: {
          type: 'string',
        },
        items: {
          items: {
            properties: {
              status: {
                enum: [
                  'pending',
                  'in_progress',
                  'done',
                ],
                type: 'string',
              },
              title: {
                type: 'string',
              },
            },
            required: [
              'title',
              'status',
            ],
            type: 'object',
          },
          type: 'array',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        type: {
          const: 'todo',
          type: 'string',
        },
      },
      required: [
        'type',
        'session_id',
        'agent_id',
        'event_created_at',
        'items',
      ],
      type: 'object',
    },
  },
  {
    name: 'turn',
    title: 'Turn',
    summary: 'turn.started or turn.ended with the turn without its items; it replaces the client copy of the turn and keeps its items. turn.ended is sent again when an ended turn is corrected.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        event_created_at: {
          type: 'string',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        turn: {
          properties: {
            continuation: {
              enum: [
                'turn',
                'background',
                'none',
              ],
              type: 'string',
            },
            duration_ms: {
              minimum: 0,
              type: 'number',
            },
            end_reason: {
              enum: [
                'user_cancelled',
                'aborted',
                'max_steps',
                'error',
                'filtered',
                'blocked',
              ],
              type: 'string',
            },
            ended_at: {
              type: 'string',
            },
            error: {
              properties: {
                code: {
                  type: 'string',
                },
                message: {
                  type: 'string',
                },
                name: {
                  type: 'string',
                },
                request_id: {
                  type: 'string',
                },
                retryable: {
                  type: 'boolean',
                },
                status_code: {
                  maximum: 9007199254740991,
                  minimum: -9007199254740991,
                  type: 'integer',
                },
              },
              required: [
                'code',
                'message',
              ],
              type: 'object',
            },
            kind: {
              enum: [
                'agent',
                'system',
              ],
              type: 'string',
            },
            ordinal: {
              maximum: 9007199254740991,
              minimum: 0,
              type: 'integer',
            },
            outcome: {
              enum: [
                'completed',
                'interrupted',
                'failed',
              ],
              type: 'string',
            },
            retry: {
              properties: {
                attempt: {
                  exclusiveMinimum: 0,
                  maximum: 9007199254740991,
                  type: 'integer',
                },
                delay_ms: {
                  minimum: 0,
                  type: 'number',
                },
                error: {
                  properties: {
                    message: {
                      type: 'string',
                    },
                    name: {
                      type: 'string',
                    },
                    status_code: {
                      maximum: 9007199254740991,
                      minimum: -9007199254740991,
                      type: 'integer',
                    },
                  },
                  required: [
                    'name',
                    'message',
                  ],
                  type: 'object',
                },
                max_attempts: {
                  exclusiveMinimum: 0,
                  maximum: 9007199254740991,
                  type: 'integer',
                },
                next_attempt: {
                  exclusiveMinimum: 0,
                  maximum: 9007199254740991,
                  type: 'integer',
                },
              },
              required: [
                'attempt',
                'next_attempt',
                'max_attempts',
                'delay_ms',
                'error',
              ],
              type: 'object',
            },
            started_at: {
              type: 'string',
            },
            status: {
              enum: [
                'running',
                'ended',
              ],
              type: 'string',
            },
            steps: {
              items: {
                properties: {
                  ended_at: {
                    type: 'string',
                  },
                  finish_reason: {
                    type: 'string',
                  },
                  index: {
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                    type: 'integer',
                  },
                  outcome: {
                    enum: [
                      'completed',
                      'interrupted',
                      'failed',
                    ],
                    type: 'string',
                  },
                  started_at: {
                    type: 'string',
                  },
                  usage: {
                    properties: {
                      input_cache_creation: {
                        minimum: 0,
                        type: 'number',
                      },
                      input_cache_read: {
                        minimum: 0,
                        type: 'number',
                      },
                      input_other: {
                        minimum: 0,
                        type: 'number',
                      },
                      output: {
                        minimum: 0,
                        type: 'number',
                      },
                    },
                    required: [
                      'input_other',
                      'output',
                      'input_cache_read',
                      'input_cache_creation',
                    ],
                    type: 'object',
                  },
                },
                required: [
                  'index',
                  'outcome',
                  'started_at',
                ],
                type: 'object',
              },
              type: 'array',
            },
            turn_id: {
              minLength: 1,
              type: 'string',
            },
            turn_number: {
              maximum: 9007199254740991,
              minimum: 0,
              type: 'integer',
            },
            usage: {
              properties: {
                input_cache_creation: {
                  minimum: 0,
                  type: 'number',
                },
                input_cache_read: {
                  minimum: 0,
                  type: 'number',
                },
                input_other: {
                  minimum: 0,
                  type: 'number',
                },
                output: {
                  minimum: 0,
                  type: 'number',
                },
              },
              required: [
                'input_other',
                'output',
                'input_cache_read',
                'input_cache_creation',
              ],
              type: 'object',
            },
          },
          required: [
            'turn_id',
            'ordinal',
            'kind',
            'status',
            'started_at',
            'steps',
          ],
          type: 'object',
        },
        type: {
          enum: [
            'turn.started',
            'turn.ended',
          ],
          type: 'string',
        },
      },
      required: [
        'type',
        'session_id',
        'agent_id',
        'event_created_at',
        'turn',
      ],
      type: 'object',
    },
  },
  {
    name: 'turn.updated',
    title: 'Turn Updated',
    summary: 'A step of a running turn ended (step, written into steps by index) or its retry state changed; retry replaces the client copy and an absent retry clears it.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        event_created_at: {
          type: 'string',
        },
        retry: {
          properties: {
            attempt: {
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
              type: 'integer',
            },
            delay_ms: {
              minimum: 0,
              type: 'number',
            },
            error: {
              properties: {
                message: {
                  type: 'string',
                },
                name: {
                  type: 'string',
                },
                status_code: {
                  maximum: 9007199254740991,
                  minimum: -9007199254740991,
                  type: 'integer',
                },
              },
              required: [
                'name',
                'message',
              ],
              type: 'object',
            },
            max_attempts: {
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
              type: 'integer',
            },
            next_attempt: {
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
              type: 'integer',
            },
          },
          required: [
            'attempt',
            'next_attempt',
            'max_attempts',
            'delay_ms',
            'error',
          ],
          type: 'object',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        step: {
          properties: {
            ended_at: {
              type: 'string',
            },
            finish_reason: {
              type: 'string',
            },
            index: {
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
              type: 'integer',
            },
            outcome: {
              enum: [
                'completed',
                'interrupted',
                'failed',
              ],
              type: 'string',
            },
            started_at: {
              type: 'string',
            },
            usage: {
              properties: {
                input_cache_creation: {
                  minimum: 0,
                  type: 'number',
                },
                input_cache_read: {
                  minimum: 0,
                  type: 'number',
                },
                input_other: {
                  minimum: 0,
                  type: 'number',
                },
                output: {
                  minimum: 0,
                  type: 'number',
                },
              },
              required: [
                'input_other',
                'output',
                'input_cache_read',
                'input_cache_creation',
              ],
              type: 'object',
            },
          },
          required: [
            'index',
            'outcome',
            'started_at',
          ],
          type: 'object',
        },
        turn_id: {
          minLength: 1,
          type: 'string',
        },
        type: {
          const: 'turn.updated',
          type: 'string',
        },
      },
      required: [
        'type',
        'session_id',
        'agent_id',
        'event_created_at',
        'turn_id',
      ],
      type: 'object',
    },
  },
  {
    name: 'turns',
    title: 'Turns',
    summary: 'Latest page of turns of an agent, sent when a connection starts receiving that agent, including after a reconnect; it replaces the client copy of those turns. Older pages come from GET /sessions/{session_id}/agents/{agent_id}/turns.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        event_created_at: {
          type: 'string',
        },
        has_more: {
          type: 'boolean',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        turns: {
          items: {
            properties: {
              continuation: {
                enum: [
                  'turn',
                  'background',
                  'none',
                ],
                type: 'string',
              },
              duration_ms: {
                minimum: 0,
                type: 'number',
              },
              end_reason: {
                enum: [
                  'user_cancelled',
                  'aborted',
                  'max_steps',
                  'error',
                  'filtered',
                  'blocked',
                ],
                type: 'string',
              },
              ended_at: {
                type: 'string',
              },
              error: {
                properties: {
                  code: {
                    type: 'string',
                  },
                  message: {
                    type: 'string',
                  },
                  name: {
                    type: 'string',
                  },
                  request_id: {
                    type: 'string',
                  },
                  retryable: {
                    type: 'boolean',
                  },
                  status_code: {
                    maximum: 9007199254740991,
                    minimum: -9007199254740991,
                    type: 'integer',
                  },
                },
                required: [
                  'code',
                  'message',
                ],
                type: 'object',
              },
              items: {
                items: {
                  anyOf: [
                    {
                      properties: {
                        attachments: {
                          items: {
                            properties: {
                              file_id: {
                                type: 'string',
                              },
                              kind: {
                                enum: [
                                  'image',
                                  'video',
                                  'audio',
                                  'file',
                                ],
                                type: 'string',
                              },
                              media_type: {
                                type: 'string',
                              },
                              name: {
                                type: 'string',
                              },
                              ordinal: {
                                exclusiveMinimum: 0,
                                maximum: 9007199254740991,
                                type: 'integer',
                              },
                              size: {
                                maximum: 9007199254740991,
                                minimum: 0,
                                type: 'integer',
                              },
                              url: {
                                type: 'string',
                              },
                            },
                            required: [
                              'kind',
                              'ordinal',
                            ],
                            type: 'object',
                          },
                          type: 'array',
                        },
                        created_at: {
                          type: 'string',
                        },
                        debug: {
                          properties: {
                            finish_reason: {
                              type: 'string',
                            },
                            timing: {
                              properties: {
                                client_blocked_ms: {
                                  type: 'number',
                                },
                                client_consume_ms: {
                                  type: 'number',
                                },
                                first_token_ms: {
                                  type: 'number',
                                },
                                request_build_ms: {
                                  type: 'number',
                                },
                                server_decode_ms: {
                                  type: 'number',
                                },
                                server_first_token_ms: {
                                  type: 'number',
                                },
                                stream_ms: {
                                  type: 'number',
                                },
                              },
                              type: 'object',
                            },
                            usage: {
                              properties: {
                                input_cache_creation: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                input_cache_read: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                input_other: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                output: {
                                  minimum: 0,
                                  type: 'number',
                                },
                              },
                              required: [
                                'input_other',
                                'output',
                                'input_cache_read',
                                'input_cache_creation',
                              ],
                              type: 'object',
                            },
                          },
                          type: 'object',
                        },
                        item_id: {
                          minLength: 1,
                          type: 'string',
                        },
                        metadata: {
                          additionalProperties: {},
                          propertyNames: {
                            type: 'string',
                          },
                          type: 'object',
                        },
                        origin: {
                          oneOf: [
                            {
                              properties: {
                                kind: {
                                  const: 'user',
                                  type: 'string',
                                },
                              },
                              required: [
                                'kind',
                              ],
                              type: 'object',
                            },
                            {
                              properties: {
                                args: {
                                  type: 'string',
                                },
                                kind: {
                                  const: 'skill',
                                  type: 'string',
                                },
                                name: {
                                  type: 'string',
                                },
                                path: {
                                  type: 'string',
                                },
                              },
                              required: [
                                'kind',
                                'name',
                              ],
                              type: 'object',
                            },
                            {
                              properties: {
                                args: {
                                  type: 'string',
                                },
                                command: {
                                  type: 'string',
                                },
                                kind: {
                                  const: 'plugin_command',
                                  type: 'string',
                                },
                                plugin_id: {
                                  type: 'string',
                                },
                              },
                              required: [
                                'kind',
                                'plugin_id',
                                'command',
                              ],
                              type: 'object',
                            },
                            {
                              properties: {
                                coalesced_count: {
                                  maximum: 9007199254740991,
                                  minimum: 0,
                                  type: 'integer',
                                },
                                job_id: {
                                  type: 'string',
                                },
                                kind: {
                                  const: 'cron',
                                  type: 'string',
                                },
                                recurring: {
                                  type: 'boolean',
                                },
                                schedule: {
                                  type: 'string',
                                },
                                stale: {
                                  type: 'boolean',
                                },
                              },
                              required: [
                                'kind',
                                'job_id',
                                'schedule',
                                'recurring',
                                'coalesced_count',
                                'stale',
                              ],
                              type: 'object',
                            },
                            {
                              properties: {
                                hook_event: {
                                  type: 'string',
                                },
                                kind: {
                                  const: 'hook',
                                  type: 'string',
                                },
                              },
                              required: [
                                'kind',
                                'hook_event',
                              ],
                              type: 'object',
                            },
                            {
                              properties: {
                                kind: {
                                  const: 'goal',
                                  type: 'string',
                                },
                              },
                              required: [
                                'kind',
                              ],
                              type: 'object',
                            },
                            {
                              properties: {
                                kind: {
                                  const: 'retry',
                                  type: 'string',
                                },
                              },
                              required: [
                                'kind',
                              ],
                              type: 'object',
                            },
                            {
                              properties: {
                                kind: {
                                  const: 'system',
                                  type: 'string',
                                },
                              },
                              required: [
                                'kind',
                              ],
                              type: 'object',
                            },
                          ],
                        },
                        outcome: {
                          enum: [
                            'completed',
                            'interrupted',
                            'failed',
                          ],
                          type: 'string',
                        },
                        placement: {
                          enum: [
                            'opener',
                            'steer',
                          ],
                          type: 'string',
                        },
                        prompt_ids: {
                          items: {
                            minLength: 1,
                            type: 'string',
                          },
                          type: 'array',
                        },
                        skills: {
                          items: {
                            properties: {
                              args: {
                                type: 'string',
                              },
                              name: {
                                type: 'string',
                              },
                              path: {
                                type: 'string',
                              },
                            },
                            required: [
                              'name',
                            ],
                            type: 'object',
                          },
                          type: 'array',
                        },
                        status: {
                          enum: [
                            'running',
                            'ended',
                          ],
                          type: 'string',
                        },
                        step_index: {
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                          type: 'integer',
                        },
                        text: {
                          type: 'string',
                        },
                        type: {
                          const: 'user_message',
                          type: 'string',
                        },
                      },
                      required: [
                        'type',
                        'item_id',
                        'status',
                        'created_at',
                        'prompt_ids',
                        'placement',
                        'origin',
                        'text',
                        'attachments',
                        'skills',
                      ],
                      type: 'object',
                    },
                    {
                      properties: {
                        created_at: {
                          type: 'string',
                        },
                        debug: {
                          properties: {
                            finish_reason: {
                              type: 'string',
                            },
                            timing: {
                              properties: {
                                client_blocked_ms: {
                                  type: 'number',
                                },
                                client_consume_ms: {
                                  type: 'number',
                                },
                                first_token_ms: {
                                  type: 'number',
                                },
                                request_build_ms: {
                                  type: 'number',
                                },
                                server_decode_ms: {
                                  type: 'number',
                                },
                                server_first_token_ms: {
                                  type: 'number',
                                },
                                stream_ms: {
                                  type: 'number',
                                },
                              },
                              type: 'object',
                            },
                            usage: {
                              properties: {
                                input_cache_creation: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                input_cache_read: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                input_other: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                output: {
                                  minimum: 0,
                                  type: 'number',
                                },
                              },
                              required: [
                                'input_other',
                                'output',
                                'input_cache_read',
                                'input_cache_creation',
                              ],
                              type: 'object',
                            },
                          },
                          type: 'object',
                        },
                        item_id: {
                          minLength: 1,
                          type: 'string',
                        },
                        outcome: {
                          enum: [
                            'completed',
                            'interrupted',
                            'failed',
                          ],
                          type: 'string',
                        },
                        status: {
                          enum: [
                            'running',
                            'ended',
                          ],
                          type: 'string',
                        },
                        step_index: {
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                          type: 'integer',
                        },
                        text: {
                          type: 'string',
                        },
                        type: {
                          const: 'assistant_message',
                          type: 'string',
                        },
                      },
                      required: [
                        'type',
                        'item_id',
                        'status',
                        'created_at',
                        'text',
                      ],
                      type: 'object',
                    },
                    {
                      properties: {
                        created_at: {
                          type: 'string',
                        },
                        debug: {
                          properties: {
                            finish_reason: {
                              type: 'string',
                            },
                            timing: {
                              properties: {
                                client_blocked_ms: {
                                  type: 'number',
                                },
                                client_consume_ms: {
                                  type: 'number',
                                },
                                first_token_ms: {
                                  type: 'number',
                                },
                                request_build_ms: {
                                  type: 'number',
                                },
                                server_decode_ms: {
                                  type: 'number',
                                },
                                server_first_token_ms: {
                                  type: 'number',
                                },
                                stream_ms: {
                                  type: 'number',
                                },
                              },
                              type: 'object',
                            },
                            usage: {
                              properties: {
                                input_cache_creation: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                input_cache_read: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                input_other: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                output: {
                                  minimum: 0,
                                  type: 'number',
                                },
                              },
                              required: [
                                'input_other',
                                'output',
                                'input_cache_read',
                                'input_cache_creation',
                              ],
                              type: 'object',
                            },
                          },
                          type: 'object',
                        },
                        duration_ms: {
                          maximum: 9007199254740991,
                          minimum: 0,
                          type: 'integer',
                        },
                        item_id: {
                          minLength: 1,
                          type: 'string',
                        },
                        outcome: {
                          enum: [
                            'completed',
                            'interrupted',
                            'failed',
                          ],
                          type: 'string',
                        },
                        started_at: {
                          type: 'string',
                        },
                        status: {
                          enum: [
                            'running',
                            'ended',
                          ],
                          type: 'string',
                        },
                        step_index: {
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                          type: 'integer',
                        },
                        text: {
                          type: 'string',
                        },
                        type: {
                          const: 'reasoning',
                          type: 'string',
                        },
                      },
                      required: [
                        'type',
                        'item_id',
                        'status',
                        'created_at',
                        'text',
                        'started_at',
                      ],
                      type: 'object',
                    },
                    {
                      properties: {
                        agent_refs: {
                          items: {
                            properties: {
                              agent_id: {
                                minLength: 1,
                                type: 'string',
                              },
                              role: {
                                enum: [
                                  'child',
                                  'member',
                                ],
                                type: 'string',
                              },
                              swarm_index: {
                                maximum: 9007199254740991,
                                minimum: 0,
                                type: 'integer',
                              },
                              task_id: {
                                type: 'string',
                              },
                            },
                            required: [
                              'agent_id',
                              'role',
                            ],
                            type: 'object',
                          },
                          type: 'array',
                        },
                        created_at: {
                          type: 'string',
                        },
                        debug: {
                          properties: {
                            finish_reason: {
                              type: 'string',
                            },
                            timing: {
                              properties: {
                                client_blocked_ms: {
                                  type: 'number',
                                },
                                client_consume_ms: {
                                  type: 'number',
                                },
                                first_token_ms: {
                                  type: 'number',
                                },
                                request_build_ms: {
                                  type: 'number',
                                },
                                server_decode_ms: {
                                  type: 'number',
                                },
                                server_first_token_ms: {
                                  type: 'number',
                                },
                                stream_ms: {
                                  type: 'number',
                                },
                              },
                              type: 'object',
                            },
                            usage: {
                              properties: {
                                input_cache_creation: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                input_cache_read: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                input_other: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                output: {
                                  minimum: 0,
                                  type: 'number',
                                },
                              },
                              required: [
                                'input_other',
                                'output',
                                'input_cache_read',
                                'input_cache_creation',
                              ],
                              type: 'object',
                            },
                          },
                          type: 'object',
                        },
                        display: {},
                        ended_at: {
                          type: 'string',
                        },
                        error: {
                          type: 'string',
                        },
                        fields: {
                          additionalProperties: {},
                          propertyNames: {
                            type: 'string',
                          },
                          type: 'object',
                        },
                        input: {},
                        input_text: {
                          type: 'string',
                        },
                        interaction_id: {
                          type: 'string',
                        },
                        item_id: {
                          minLength: 1,
                          type: 'string',
                        },
                        media: {
                          items: {
                            properties: {
                              file_id: {
                                type: 'string',
                              },
                              kind: {
                                enum: [
                                  'image',
                                  'video',
                                  'audio',
                                ],
                                type: 'string',
                              },
                              media_type: {
                                type: 'string',
                              },
                              url: {
                                type: 'string',
                              },
                            },
                            required: [
                              'kind',
                            ],
                            type: 'object',
                          },
                          type: 'array',
                        },
                        name: {
                          type: 'string',
                        },
                        note: {
                          type: 'string',
                        },
                        outcome: {
                          enum: [
                            'completed',
                            'interrupted',
                            'failed',
                          ],
                          type: 'string',
                        },
                        output: {
                          type: 'string',
                        },
                        stage: {
                          enum: [
                            'input',
                            'awaiting_approval',
                            'executing',
                          ],
                          type: 'string',
                        },
                        started_at: {
                          type: 'string',
                        },
                        status: {
                          enum: [
                            'running',
                            'ended',
                          ],
                          type: 'string',
                        },
                        step_index: {
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                          type: 'integer',
                        },
                        task_id: {
                          type: 'string',
                        },
                        type: {
                          const: 'tool_call',
                          type: 'string',
                        },
                      },
                      required: [
                        'type',
                        'item_id',
                        'status',
                        'created_at',
                        'name',
                        'started_at',
                      ],
                      type: 'object',
                    },
                    {
                      properties: {
                        agent_id: {
                          type: 'string',
                        },
                        answer: {
                          properties: {
                            answers: {
                              additionalProperties: {
                                anyOf: [
                                  {
                                    type: 'string',
                                  },
                                  {
                                    const: true,
                                    type: 'boolean',
                                  },
                                ],
                              },
                              propertyNames: {
                                type: 'string',
                              },
                              type: 'object',
                            },
                            note: {
                              type: 'string',
                            },
                          },
                          required: [
                            'answers',
                          ],
                          type: 'object',
                        },
                        body: {
                          type: 'string',
                        },
                        created_at: {
                          type: 'string',
                        },
                        debug: {
                          properties: {
                            finish_reason: {
                              type: 'string',
                            },
                            timing: {
                              properties: {
                                client_blocked_ms: {
                                  type: 'number',
                                },
                                client_consume_ms: {
                                  type: 'number',
                                },
                                first_token_ms: {
                                  type: 'number',
                                },
                                request_build_ms: {
                                  type: 'number',
                                },
                                server_decode_ms: {
                                  type: 'number',
                                },
                                server_first_token_ms: {
                                  type: 'number',
                                },
                                stream_ms: {
                                  type: 'number',
                                },
                              },
                              type: 'object',
                            },
                            usage: {
                              properties: {
                                input_cache_creation: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                input_cache_read: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                input_other: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                output: {
                                  minimum: 0,
                                  type: 'number',
                                },
                              },
                              required: [
                                'input_other',
                                'output',
                                'input_cache_read',
                                'input_cache_creation',
                              ],
                              type: 'object',
                            },
                          },
                          type: 'object',
                        },
                        item_id: {
                          minLength: 1,
                          type: 'string',
                        },
                        notification_id: {
                          type: 'string',
                        },
                        notification_type: {
                          type: 'string',
                        },
                        outcome: {
                          enum: [
                            'completed',
                            'interrupted',
                            'failed',
                          ],
                          type: 'string',
                        },
                        output: {
                          properties: {
                            bytes: {
                              maximum: 9007199254740991,
                              minimum: 0,
                              type: 'integer',
                            },
                            file: {
                              type: 'string',
                            },
                            preview: {
                              type: 'string',
                            },
                            truncated: {
                              type: 'boolean',
                            },
                          },
                          type: 'object',
                        },
                        severity: {
                          enum: [
                            'info',
                            'warning',
                            'error',
                          ],
                          type: 'string',
                        },
                        source: {
                          properties: {
                            id: {
                              type: 'string',
                            },
                            kind: {
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'id',
                          ],
                          type: 'object',
                        },
                        status: {
                          enum: [
                            'running',
                            'ended',
                          ],
                          type: 'string',
                        },
                        step_index: {
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                          type: 'integer',
                        },
                        task_id: {
                          type: 'string',
                        },
                        title: {
                          type: 'string',
                        },
                        type: {
                          const: 'notification',
                          type: 'string',
                        },
                      },
                      required: [
                        'type',
                        'item_id',
                        'status',
                        'created_at',
                        'notification_id',
                        'title',
                        'body',
                        'severity',
                        'notification_type',
                        'source',
                      ],
                      type: 'object',
                    },
                    {
                      properties: {
                        compacted_count: {
                          maximum: 9007199254740991,
                          minimum: 0,
                          type: 'integer',
                        },
                        created_at: {
                          type: 'string',
                        },
                        debug: {
                          properties: {
                            finish_reason: {
                              type: 'string',
                            },
                            timing: {
                              properties: {
                                client_blocked_ms: {
                                  type: 'number',
                                },
                                client_consume_ms: {
                                  type: 'number',
                                },
                                first_token_ms: {
                                  type: 'number',
                                },
                                request_build_ms: {
                                  type: 'number',
                                },
                                server_decode_ms: {
                                  type: 'number',
                                },
                                server_first_token_ms: {
                                  type: 'number',
                                },
                                stream_ms: {
                                  type: 'number',
                                },
                              },
                              type: 'object',
                            },
                            usage: {
                              properties: {
                                input_cache_creation: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                input_cache_read: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                input_other: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                output: {
                                  minimum: 0,
                                  type: 'number',
                                },
                              },
                              required: [
                                'input_other',
                                'output',
                                'input_cache_read',
                                'input_cache_creation',
                              ],
                              type: 'object',
                            },
                          },
                          type: 'object',
                        },
                        instruction: {
                          type: 'string',
                        },
                        item_id: {
                          minLength: 1,
                          type: 'string',
                        },
                        kind: {
                          const: 'compaction',
                          type: 'string',
                        },
                        outcome: {
                          enum: [
                            'completed',
                            'interrupted',
                            'failed',
                          ],
                          type: 'string',
                        },
                        status: {
                          enum: [
                            'running',
                            'ended',
                          ],
                          type: 'string',
                        },
                        step_index: {
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                          type: 'integer',
                        },
                        summary: {
                          type: 'string',
                        },
                        tokens_after: {
                          minimum: 0,
                          type: 'number',
                        },
                        tokens_before: {
                          minimum: 0,
                          type: 'number',
                        },
                        trigger: {
                          enum: [
                            'manual',
                            'auto',
                          ],
                          type: 'string',
                        },
                        type: {
                          const: 'system',
                          type: 'string',
                        },
                      },
                      required: [
                        'type',
                        'item_id',
                        'status',
                        'created_at',
                        'kind',
                        'trigger',
                      ],
                      type: 'object',
                    },
                    {
                      properties: {
                        created_at: {
                          type: 'string',
                        },
                        debug: {
                          properties: {
                            finish_reason: {
                              type: 'string',
                            },
                            timing: {
                              properties: {
                                client_blocked_ms: {
                                  type: 'number',
                                },
                                client_consume_ms: {
                                  type: 'number',
                                },
                                first_token_ms: {
                                  type: 'number',
                                },
                                request_build_ms: {
                                  type: 'number',
                                },
                                server_decode_ms: {
                                  type: 'number',
                                },
                                server_first_token_ms: {
                                  type: 'number',
                                },
                                stream_ms: {
                                  type: 'number',
                                },
                              },
                              type: 'object',
                            },
                            usage: {
                              properties: {
                                input_cache_creation: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                input_cache_read: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                input_other: {
                                  minimum: 0,
                                  type: 'number',
                                },
                                output: {
                                  minimum: 0,
                                  type: 'number',
                                },
                              },
                              required: [
                                'input_other',
                                'output',
                                'input_cache_read',
                                'input_cache_creation',
                              ],
                              type: 'object',
                            },
                          },
                          type: 'object',
                        },
                        forked_from: {
                          properties: {
                            agent_id: {
                              minLength: 1,
                              type: 'string',
                            },
                          },
                          required: [
                            'agent_id',
                          ],
                          type: 'object',
                        },
                        item_id: {
                          minLength: 1,
                          type: 'string',
                        },
                        kind: {
                          const: 'fork_boundary',
                          type: 'string',
                        },
                        outcome: {
                          enum: [
                            'completed',
                            'interrupted',
                            'failed',
                          ],
                          type: 'string',
                        },
                        source: {
                          enum: [
                            'btw',
                            'fork',
                          ],
                          type: 'string',
                        },
                        status: {
                          enum: [
                            'running',
                            'ended',
                          ],
                          type: 'string',
                        },
                        step_index: {
                          exclusiveMinimum: 0,
                          maximum: 9007199254740991,
                          type: 'integer',
                        },
                        type: {
                          const: 'system',
                          type: 'string',
                        },
                      },
                      required: [
                        'type',
                        'item_id',
                        'status',
                        'created_at',
                        'kind',
                        'source',
                        'forked_from',
                      ],
                      type: 'object',
                    },
                  ],
                },
                type: 'array',
              },
              kind: {
                enum: [
                  'agent',
                  'system',
                ],
                type: 'string',
              },
              ordinal: {
                maximum: 9007199254740991,
                minimum: 0,
                type: 'integer',
              },
              outcome: {
                enum: [
                  'completed',
                  'interrupted',
                  'failed',
                ],
                type: 'string',
              },
              retry: {
                properties: {
                  attempt: {
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                    type: 'integer',
                  },
                  delay_ms: {
                    minimum: 0,
                    type: 'number',
                  },
                  error: {
                    properties: {
                      message: {
                        type: 'string',
                      },
                      name: {
                        type: 'string',
                      },
                      status_code: {
                        maximum: 9007199254740991,
                        minimum: -9007199254740991,
                        type: 'integer',
                      },
                    },
                    required: [
                      'name',
                      'message',
                    ],
                    type: 'object',
                  },
                  max_attempts: {
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                    type: 'integer',
                  },
                  next_attempt: {
                    exclusiveMinimum: 0,
                    maximum: 9007199254740991,
                    type: 'integer',
                  },
                },
                required: [
                  'attempt',
                  'next_attempt',
                  'max_attempts',
                  'delay_ms',
                  'error',
                ],
                type: 'object',
              },
              started_at: {
                type: 'string',
              },
              status: {
                enum: [
                  'running',
                  'ended',
                ],
                type: 'string',
              },
              steps: {
                items: {
                  properties: {
                    ended_at: {
                      type: 'string',
                    },
                    finish_reason: {
                      type: 'string',
                    },
                    index: {
                      exclusiveMinimum: 0,
                      maximum: 9007199254740991,
                      type: 'integer',
                    },
                    outcome: {
                      enum: [
                        'completed',
                        'interrupted',
                        'failed',
                      ],
                      type: 'string',
                    },
                    started_at: {
                      type: 'string',
                    },
                    usage: {
                      properties: {
                        input_cache_creation: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_cache_read: {
                          minimum: 0,
                          type: 'number',
                        },
                        input_other: {
                          minimum: 0,
                          type: 'number',
                        },
                        output: {
                          minimum: 0,
                          type: 'number',
                        },
                      },
                      required: [
                        'input_other',
                        'output',
                        'input_cache_read',
                        'input_cache_creation',
                      ],
                      type: 'object',
                    },
                  },
                  required: [
                    'index',
                    'outcome',
                    'started_at',
                  ],
                  type: 'object',
                },
                type: 'array',
              },
              turn_id: {
                minLength: 1,
                type: 'string',
              },
              turn_number: {
                maximum: 9007199254740991,
                minimum: 0,
                type: 'integer',
              },
              usage: {
                properties: {
                  input_cache_creation: {
                    minimum: 0,
                    type: 'number',
                  },
                  input_cache_read: {
                    minimum: 0,
                    type: 'number',
                  },
                  input_other: {
                    minimum: 0,
                    type: 'number',
                  },
                  output: {
                    minimum: 0,
                    type: 'number',
                  },
                },
                required: [
                  'input_other',
                  'output',
                  'input_cache_read',
                  'input_cache_creation',
                ],
                type: 'object',
              },
            },
            required: [
              'turn_id',
              'ordinal',
              'kind',
              'status',
              'started_at',
              'steps',
              'items',
            ],
            type: 'object',
          },
          type: 'array',
        },
        type: {
          const: 'turns',
          type: 'string',
        },
      },
      required: [
        'turns',
        'has_more',
        'type',
        'session_id',
        'agent_id',
        'event_created_at',
      ],
      type: 'object',
    },
  },
  {
    name: 'turns.failed',
    title: 'Turns Failed',
    summary: 'The conversation of a subscribed agent could not be loaded; code and msg say why. The agent stays subscribed, and a later turns frame replaces the failure.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        code: {
          maximum: 9007199254740991,
          minimum: -9007199254740991,
          type: 'integer',
        },
        event_created_at: {
          type: 'string',
        },
        msg: {
          type: 'string',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        type: {
          const: 'turns.failed',
          type: 'string',
        },
      },
      required: [
        'type',
        'session_id',
        'agent_id',
        'event_created_at',
        'code',
        'msg',
      ],
      type: 'object',
    },
  },
  {
    name: 'turns.removed',
    title: 'Turns Removed',
    summary: 'Turns that left the conversation of an agent, in ordinal order: the undone turns after an undo, matching removed_turn_ids of the undo response, or every turn after a context clear. The client removes them by turn_id.',
    direction: 'server_to_client',
    payload: {
      properties: {
        agent_id: {
          minLength: 1,
          type: 'string',
        },
        event_created_at: {
          type: 'string',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        turn_ids: {
          items: {
            minLength: 1,
            type: 'string',
          },
          type: 'array',
        },
        type: {
          const: 'turns.removed',
          type: 'string',
        },
      },
      required: [
        'type',
        'session_id',
        'agent_id',
        'event_created_at',
        'turn_ids',
      ],
      type: 'object',
    },
  },
  {
    name: 'unsubscribe',
    title: 'Unsubscribe',
    summary: 'Stop receiving agents of one session; without agent_ids the whole session is dropped.',
    direction: 'client_to_server',
    payload: {
      properties: {
        agent_ids: {
          items: {
            minLength: 1,
            type: 'string',
          },
          minItems: 1,
          type: 'array',
        },
        request_id: {
          minLength: 1,
          type: 'string',
        },
        session_id: {
          minLength: 1,
          type: 'string',
        },
        type: {
          const: 'unsubscribe',
          type: 'string',
        },
      },
      required: [
        'type',
        'request_id',
        'session_id',
      ],
      type: 'object',
    },
  },
] as const satisfies readonly KimiWebSocketMessage[]

export type KimiWebSocketMessageName = (typeof KIMI_WEB_SOCKET_MESSAGES)[number]['name']
