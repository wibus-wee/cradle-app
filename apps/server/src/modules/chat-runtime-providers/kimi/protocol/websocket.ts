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
    name: 'abort',
    title: 'Abort',
    summary: 'Abort a running prompt in a session.',
    direction: 'client_to_server',
    payload: {
      properties: {
        id: {
          type: 'string',
        },
        payload: {
          properties: {
            prompt_id: {
              type: 'string',
            },
            session_id: {
              type: 'string',
            },
          },
          required: [
            'session_id',
            'prompt_id',
          ],
          type: 'object',
        },
        type: {
          const: 'abort',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'abort.ack',
    title: 'Abort Ack',
    summary: 'Acknowledgement for abort.',
    direction: 'server_to_client',
    payload: {
      properties: {
        code: {
          maximum: 9007199254740991,
          minimum: -9007199254740991,
          type: 'integer',
        },
        id: {
          type: 'string',
        },
        msg: {
          type: 'string',
        },
        payload: {
          properties: {
            aborted: {
              type: 'boolean',
            },
            at_seq: {
              maximum: 9007199254740991,
              minimum: 0,
              type: 'integer',
            },
          },
          type: 'object',
        },
        type: {
          const: 'ack',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'code',
        'msg',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'client_hello',
    title: 'Client Hello',
    summary: 'Start a client session and optionally subscribe to existing daemon sessions.',
    direction: 'client_to_server',
    payload: {
      properties: {
        id: {
          type: 'string',
        },
        payload: {
          properties: {
            agent_filter: {
              additionalProperties: {
                items: {
                  type: 'string',
                },
                minItems: 1,
                type: 'array',
              },
              propertyNames: {
                type: 'string',
              },
              type: 'object',
            },
            client_id: {
              type: 'string',
            },
            cursors: {
              additionalProperties: {
                properties: {
                  epoch: {
                    minLength: 1,
                    type: 'string',
                  },
                  seq: {
                    maximum: 9007199254740991,
                    minimum: 0,
                    type: 'integer',
                  },
                },
                required: [
                  'seq',
                ],
                type: 'object',
              },
              propertyNames: {
                type: 'string',
              },
              type: 'object',
            },
            subscriptions: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
          },
          required: [
            'client_id',
            'subscriptions',
          ],
          type: 'object',
        },
        type: {
          const: 'client_hello',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'client_hello.ack',
    title: 'Client Hello Ack',
    summary: 'Acknowledgement for client_hello.',
    direction: 'server_to_client',
    payload: {
      properties: {
        code: {
          maximum: 9007199254740991,
          minimum: -9007199254740991,
          type: 'integer',
        },
        id: {
          type: 'string',
        },
        msg: {
          type: 'string',
        },
        payload: {
          properties: {
            accepted_subscriptions: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
            cursors: {
              additionalProperties: {
                properties: {
                  epoch: {
                    minLength: 1,
                    type: 'string',
                  },
                  seq: {
                    maximum: 9007199254740991,
                    minimum: 0,
                    type: 'integer',
                  },
                },
                required: [
                  'seq',
                ],
                type: 'object',
              },
              propertyNames: {
                type: 'string',
              },
              type: 'object',
            },
            resync_required: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
          },
          required: [
            'accepted_subscriptions',
            'resync_required',
          ],
          type: 'object',
        },
        type: {
          const: 'ack',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'code',
        'msg',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'error',
    title: 'Error',
    summary: 'Server-side WebSocket protocol or runtime error.',
    direction: 'server_to_client',
    payload: {
      properties: {
        payload: {
          properties: {
            code: {
              maximum: 9007199254740991,
              minimum: -9007199254740991,
              type: 'integer',
            },
            details: {},
            fatal: {
              type: 'boolean',
            },
            msg: {
              type: 'string',
            },
            request_id: {
              type: 'string',
            },
          },
          required: [
            'code',
            'msg',
            'fatal',
          ],
          type: 'object',
        },
        timestamp: {
          type: 'string',
        },
        type: {
          const: 'error',
          type: 'string',
        },
      },
      required: [
        'type',
        'timestamp',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'ping',
    title: 'Ping',
    summary: 'Heartbeat ping sent by the server; clients must answer with pong.',
    direction: 'server_to_client',
    payload: {
      properties: {
        payload: {
          properties: {
            nonce: {
              type: 'string',
            },
          },
          required: [
            'nonce',
          ],
          type: 'object',
        },
        timestamp: {
          type: 'string',
        },
        type: {
          const: 'ping',
          type: 'string',
        },
      },
      required: [
        'type',
        'timestamp',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'pong',
    title: 'Pong',
    summary: 'Reply to a server ping with the same nonce.',
    direction: 'client_to_server',
    payload: {
      properties: {
        payload: {
          properties: {
            nonce: {
              type: 'string',
            },
          },
          required: [
            'nonce',
          ],
          type: 'object',
        },
        type: {
          const: 'pong',
          type: 'string',
        },
      },
      required: [
        'type',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'resync_required',
    title: 'Resync Required',
    summary: 'Signals that a client must rebuild local session state from REST history.',
    direction: 'server_to_client',
    payload: {
      properties: {
        payload: {
          properties: {
            current_seq: {
              maximum: 9007199254740991,
              minimum: 0,
              type: 'integer',
            },
            epoch: {
              minLength: 1,
              type: 'string',
            },
            reason: {
              enum: [
                'buffer_overflow',
                'session_recreated',
                'epoch_changed',
              ],
              type: 'string',
            },
            session_id: {
              type: 'string',
            },
          },
          required: [
            'session_id',
            'reason',
            'current_seq',
          ],
          type: 'object',
        },
        timestamp: {
          type: 'string',
        },
        type: {
          const: 'resync_required',
          type: 'string',
        },
      },
      required: [
        'type',
        'timestamp',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'server_hello',
    title: 'Server Hello',
    summary: 'Initial server greeting sent immediately after the socket opens.',
    direction: 'server_to_client',
    payload: {
      properties: {
        payload: {
          properties: {
            capabilities: {
              properties: {
                compression: {
                  type: 'boolean',
                },
                event_batching: {
                  type: 'boolean',
                },
              },
              required: [
                'event_batching',
                'compression',
              ],
              type: 'object',
            },
            heartbeat_ms: {
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
              type: 'integer',
            },
            max_event_buffer_size: {
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
              type: 'integer',
            },
            protocol_version: {
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
              type: 'integer',
            },
            ws_connection_id: {
              type: 'string',
            },
          },
          required: [
            'ws_connection_id',
            'protocol_version',
            'max_event_buffer_size',
            'capabilities',
          ],
          type: 'object',
        },
        timestamp: {
          type: 'string',
        },
        type: {
          const: 'server_hello',
          type: 'string',
        },
      },
      required: [
        'type',
        'timestamp',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'session_event',
    title: 'Session Event',
    summary: 'Session-scoped agent event envelope; frame type is the payload event type.',
    direction: 'server_to_client',
    payload: {
      definitions: {
        __schema0: {
          properties: {
            cause: {
              $ref: '#/definitions/__schema0',
            },
            code: {
              enum: [
                'config.invalid',
                'session.not_found',
                'session.already_exists',
                'session.id_invalid',
                'session.id_required',
                'session.id_empty',
                'session.title_empty',
                'session.state_not_found',
                'session.state_invalid',
                'session.fork_active_turn',
                'session.undo_unavailable',
                'session.export_not_found',
                'session.export_missing_version',
                'session.export_output_conflict',
                'session.export_too_large',
                'session.closed',
                'session.permission_mode_invalid',
                'session.thinking_empty',
                'session.model_empty',
                'session.plan_mode_invalid',
                'session.approval_handler_error',
                'session.question_handler_error',
                'session.init_failed',
                'agent.not_found',
                'activity.agent_busy',
                'activity.cancelling',
                'activity.disposing',
                'activity.disposed',
                'activity.initializing',
                'activity.session_rejected',
                'turn.agent_busy',
                'goal.already_exists',
                'goal.not_found',
                'goal.objective_empty',
                'goal.objective_too_long',
                'goal.status_invalid',
                'goal.metadata_reserved',
                'goal.not_resumable',
                'goal.unsupported_agent',
                'model.not_configured',
                'model.config_invalid',
                'profile.thinking_alias_conflict',
                'model.not_found',
                'auth.login_required',
                'auth.provisioning_required',
                'auth.token_missing',
                'auth.token_unauthorized',
                'auth.model_not_resolved',
                'context.overflow',
                'loop.max_steps_exceeded',
                'provider.api_error',
                'provider.filtered',
                'provider.rate_limit',
                'provider.auth_error',
                'provider.connection_error',
                'provider.overloaded',
                'provider.not_found',
                'skill.not_found',
                'skill.type_unsupported',
                'skill.name_empty',
                'records.write_failed',
                'compaction.failed',
                'compaction.unable',
                'task.task_id_empty',
                'usage.turn_id_conflict',
                'mcp.server_not_found',
                'mcp.server_disabled',
                'mcp.startup_failed',
                'mcp.tool_name_collision',
                'message.not_found',
                'plugin.not_found',
                'plugin.load_failed',
                'request.invalid',
                'request.work_dir_required',
                'request.prompt_input_empty',
                'prompt.not_found',
                'prompt.already_completed',
                'session.busy',
                'shell.git_bash_not_found',
                'workspace.not_found',
                'terminal.not_found',
                'file.not_found',
                'file.too_large',
                'fs.path_not_found',
                'fs.permission_denied',
                'fs.path_escapes',
                'fs.is_directory',
                'fs.is_binary',
                'fs.too_large',
                'fs.already_exists',
                'fs.too_many_results',
                'fs.grep_timeout',
                'fs.git_unavailable',
                'validation.failed',
                'not_implemented',
                'internal',
              ],
              type: 'string',
            },
            details: {
              additionalProperties: {},
              propertyNames: {
                type: 'string',
              },
              type: 'object',
            },
            message: {
              type: 'string',
            },
            name: {
              type: 'string',
            },
            retryable: {
              type: 'boolean',
            },
          },
          required: [
            'code',
            'message',
            'retryable',
          ],
          type: 'object',
        },
      },
      properties: {
        epoch: {
          type: 'string',
        },
        offset: {
          maximum: 9007199254740991,
          minimum: 0,
          type: 'integer',
        },
        payload: {
          allOf: [
            {
              oneOf: [
                {
                  properties: {
                    cause: {
                      $ref: '#/definitions/__schema0',
                    },
                    code: {
                      enum: [
                        'config.invalid',
                        'session.not_found',
                        'session.already_exists',
                        'session.id_invalid',
                        'session.id_required',
                        'session.id_empty',
                        'session.title_empty',
                        'session.state_not_found',
                        'session.state_invalid',
                        'session.fork_active_turn',
                        'session.undo_unavailable',
                        'session.export_not_found',
                        'session.export_missing_version',
                        'session.export_output_conflict',
                        'session.export_too_large',
                        'session.closed',
                        'session.permission_mode_invalid',
                        'session.thinking_empty',
                        'session.model_empty',
                        'session.plan_mode_invalid',
                        'session.approval_handler_error',
                        'session.question_handler_error',
                        'session.init_failed',
                        'agent.not_found',
                        'activity.agent_busy',
                        'activity.cancelling',
                        'activity.disposing',
                        'activity.disposed',
                        'activity.initializing',
                        'activity.session_rejected',
                        'turn.agent_busy',
                        'goal.already_exists',
                        'goal.not_found',
                        'goal.objective_empty',
                        'goal.objective_too_long',
                        'goal.status_invalid',
                        'goal.metadata_reserved',
                        'goal.not_resumable',
                        'goal.unsupported_agent',
                        'model.not_configured',
                        'model.config_invalid',
                        'profile.thinking_alias_conflict',
                        'model.not_found',
                        'auth.login_required',
                        'auth.provisioning_required',
                        'auth.token_missing',
                        'auth.token_unauthorized',
                        'auth.model_not_resolved',
                        'context.overflow',
                        'loop.max_steps_exceeded',
                        'provider.api_error',
                        'provider.filtered',
                        'provider.rate_limit',
                        'provider.auth_error',
                        'provider.connection_error',
                        'provider.overloaded',
                        'provider.not_found',
                        'skill.not_found',
                        'skill.type_unsupported',
                        'skill.name_empty',
                        'records.write_failed',
                        'compaction.failed',
                        'compaction.unable',
                        'task.task_id_empty',
                        'usage.turn_id_conflict',
                        'mcp.server_not_found',
                        'mcp.server_disabled',
                        'mcp.startup_failed',
                        'mcp.tool_name_collision',
                        'message.not_found',
                        'plugin.not_found',
                        'plugin.load_failed',
                        'request.invalid',
                        'request.work_dir_required',
                        'request.prompt_input_empty',
                        'prompt.not_found',
                        'prompt.already_completed',
                        'session.busy',
                        'shell.git_bash_not_found',
                        'workspace.not_found',
                        'terminal.not_found',
                        'file.not_found',
                        'file.too_large',
                        'fs.path_not_found',
                        'fs.permission_denied',
                        'fs.path_escapes',
                        'fs.is_directory',
                        'fs.is_binary',
                        'fs.too_large',
                        'fs.already_exists',
                        'fs.too_many_results',
                        'fs.grep_timeout',
                        'fs.git_unavailable',
                        'validation.failed',
                        'not_implemented',
                        'internal',
                      ],
                      type: 'string',
                    },
                    details: {
                      additionalProperties: {},
                      propertyNames: {
                        type: 'string',
                      },
                      type: 'object',
                    },
                    message: {
                      type: 'string',
                    },
                    name: {
                      type: 'string',
                    },
                    retryable: {
                      type: 'boolean',
                    },
                    type: {
                      const: 'error',
                      type: 'string',
                    },
                  },
                  required: [
                    'code',
                    'message',
                    'retryable',
                    'type',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    code: {
                      type: 'string',
                    },
                    message: {
                      type: 'string',
                    },
                    type: {
                      const: 'warning',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'message',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    contextTokens: {
                      type: 'number',
                    },
                    contextUsage: {
                      type: 'number',
                    },
                    maxContextTokens: {
                      type: 'number',
                    },
                    model: {
                      type: 'string',
                    },
                    permission: {
                      enum: [
                        'manual',
                        'yolo',
                        'auto',
                      ],
                      type: 'string',
                    },
                    phase: {
                      oneOf: [
                        {
                          properties: {
                            kind: {
                              const: 'idle',
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
                              const: 'running',
                              type: 'string',
                            },
                            since: {
                              type: 'number',
                            },
                            step: {
                              type: 'number',
                            },
                            stepId: {
                              type: 'string',
                            },
                            turnId: {
                              type: 'number',
                            },
                          },
                          required: [
                            'kind',
                            'turnId',
                            'step',
                            'stepId',
                            'since',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            kind: {
                              const: 'streaming',
                              type: 'string',
                            },
                            since: {
                              type: 'number',
                            },
                            step: {
                              type: 'number',
                            },
                            stepId: {
                              type: 'string',
                            },
                            stream: {
                              enum: [
                                'assistant',
                                'thinking',
                                'tool_call',
                              ],
                              type: 'string',
                            },
                            toolCallId: {
                              type: 'string',
                            },
                            toolName: {
                              type: 'string',
                            },
                            turnId: {
                              type: 'number',
                            },
                          },
                          required: [
                            'kind',
                            'turnId',
                            'step',
                            'stepId',
                            'stream',
                            'since',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            kind: {
                              const: 'tool_call',
                              type: 'string',
                            },
                            name: {
                              type: 'string',
                            },
                            since: {
                              type: 'number',
                            },
                            step: {
                              type: 'number',
                            },
                            toolCallId: {
                              type: 'string',
                            },
                            turnId: {
                              type: 'number',
                            },
                          },
                          required: [
                            'kind',
                            'turnId',
                            'step',
                            'toolCallId',
                            'name',
                            'since',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            delayMs: {
                              type: 'number',
                            },
                            errorName: {
                              type: 'string',
                            },
                            failedAttempt: {
                              type: 'number',
                            },
                            kind: {
                              const: 'retrying',
                              type: 'string',
                            },
                            maxAttempts: {
                              type: 'number',
                            },
                            nextAttempt: {
                              type: 'number',
                            },
                            since: {
                              type: 'number',
                            },
                            statusCode: {
                              type: 'number',
                            },
                            step: {
                              type: 'number',
                            },
                            stepId: {
                              type: 'string',
                            },
                            turnId: {
                              type: 'number',
                            },
                          },
                          required: [
                            'kind',
                            'turnId',
                            'step',
                            'stepId',
                            'failedAttempt',
                            'nextAttempt',
                            'maxAttempts',
                            'delayMs',
                            'since',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            approval: {},
                            kind: {
                              const: 'awaiting_approval',
                              type: 'string',
                            },
                            since: {
                              type: 'number',
                            },
                            step: {
                              type: 'number',
                            },
                            turnId: {
                              type: 'number',
                            },
                          },
                          required: [
                            'kind',
                            'turnId',
                            'since',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            at: {
                              type: 'number',
                            },
                            kind: {
                              const: 'interrupted',
                              type: 'string',
                            },
                            message: {
                              type: 'string',
                            },
                            reason: {
                              enum: [
                                'aborted',
                                'max_steps',
                                'error',
                              ],
                              type: 'string',
                            },
                            step: {
                              type: 'number',
                            },
                            turnId: {
                              type: 'number',
                            },
                          },
                          required: [
                            'kind',
                            'turnId',
                            'reason',
                            'at',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            at: {
                              type: 'number',
                            },
                            durationMs: {
                              type: 'number',
                            },
                            kind: {
                              const: 'ended',
                              type: 'string',
                            },
                            reason: {
                              enum: [
                                'completed',
                                'cancelled',
                                'failed',
                                'blocked',
                              ],
                              type: 'string',
                            },
                            turnId: {
                              type: 'number',
                            },
                          },
                          required: [
                            'kind',
                            'turnId',
                            'reason',
                            'at',
                          ],
                          type: 'object',
                        },
                      ],
                    },
                    planMode: {
                      type: 'boolean',
                    },
                    swarmMode: {
                      type: 'boolean',
                    },
                    thinkingEffort: {
                      type: 'string',
                    },
                    type: {
                      const: 'agent.status.updated',
                      type: 'string',
                    },
                    usage: {
                      properties: {
                        byModel: {
                          additionalProperties: {
                            properties: {
                              inputCacheCreation: {
                                type: 'number',
                              },
                              inputCacheRead: {
                                type: 'number',
                              },
                              inputOther: {
                                type: 'number',
                              },
                              output: {
                                type: 'number',
                              },
                            },
                            required: [
                              'inputOther',
                              'output',
                              'inputCacheRead',
                              'inputCacheCreation',
                            ],
                            type: 'object',
                          },
                          propertyNames: {
                            type: 'string',
                          },
                          type: 'object',
                        },
                        currentTurn: {
                          properties: {
                            inputCacheCreation: {
                              type: 'number',
                            },
                            inputCacheRead: {
                              type: 'number',
                            },
                            inputOther: {
                              type: 'number',
                            },
                            output: {
                              type: 'number',
                            },
                          },
                          required: [
                            'inputOther',
                            'output',
                            'inputCacheRead',
                            'inputCacheCreation',
                          ],
                          type: 'object',
                        },
                        total: {
                          properties: {
                            inputCacheCreation: {
                              type: 'number',
                            },
                            inputCacheRead: {
                              type: 'number',
                            },
                            inputOther: {
                              type: 'number',
                            },
                            output: {
                              type: 'number',
                            },
                          },
                          required: [
                            'inputOther',
                            'output',
                            'inputCacheRead',
                            'inputCacheCreation',
                          ],
                          type: 'object',
                        },
                      },
                      type: 'object',
                    },
                  },
                  required: [
                    'type',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    patch: {
                      additionalProperties: {},
                      propertyNames: {
                        type: 'string',
                      },
                      type: 'object',
                    },
                    title: {
                      type: 'string',
                    },
                    type: {
                      const: 'session.meta.updated',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    session: {
                      properties: {
                        agent_config: {
                          properties: {
                            goal_control: {
                              enum: [
                                'pause',
                                'resume',
                                'cancel',
                              ],
                              type: 'string',
                            },
                            goal_objective: {
                              type: 'string',
                            },
                            mcp_servers: {
                              items: {
                                type: 'string',
                              },
                              type: 'array',
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
                            swarm_mode: {
                              type: 'boolean',
                            },
                            system_prompt: {
                              type: 'string',
                            },
                            thinking: {
                              minLength: 1,
                              type: 'string',
                            },
                            tools: {
                              items: {
                                type: 'string',
                              },
                              type: 'array',
                            },
                          },
                          required: [
                            'model',
                          ],
                          type: 'object',
                        },
                        archived: {
                          type: 'boolean',
                        },
                        busy: {
                          type: 'boolean',
                        },
                        created_at: {
                          type: 'string',
                        },
                        current_prompt_id: {
                          minLength: 1,
                          type: 'string',
                        },
                        id: {
                          minLength: 1,
                          type: 'string',
                        },
                        last_prompt: {
                          type: 'string',
                        },
                        last_seq: {
                          maximum: 9007199254740991,
                          minimum: 0,
                          type: 'integer',
                        },
                        last_turn_reason: {
                          enum: [
                            'completed',
                            'cancelled',
                            'failed',
                          ],
                          type: 'string',
                        },
                        main_turn_active: {
                          type: 'boolean',
                        },
                        message_count: {
                          maximum: 9007199254740991,
                          minimum: 0,
                          type: 'integer',
                        },
                        metadata: {
                          additionalProperties: {},
                          properties: {
                            cwd: {
                              minLength: 1,
                              type: 'string',
                            },
                          },
                          required: [
                            'cwd',
                          ],
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
                        permission_rules: {
                          items: {
                            properties: {
                              created_at: {
                                type: 'string',
                              },
                              created_by: {
                                enum: [
                                  'user',
                                  'agent',
                                ],
                                type: 'string',
                              },
                              decision: {
                                const: 'approved',
                                type: 'string',
                              },
                              id: {
                                minLength: 1,
                                type: 'string',
                              },
                              matcher: {
                                properties: {
                                  kind: {
                                    enum: [
                                      'command_prefix',
                                      'path_glob',
                                      'exact_input',
                                      'always',
                                    ],
                                    type: 'string',
                                  },
                                  value: {
                                    type: 'string',
                                  },
                                },
                                required: [
                                  'kind',
                                ],
                                type: 'object',
                              },
                              tool_name: {
                                minLength: 1,
                                type: 'string',
                              },
                            },
                            required: [
                              'id',
                              'tool_name',
                              'decision',
                              'created_at',
                              'created_by',
                            ],
                            type: 'object',
                          },
                          type: 'array',
                        },
                        title: {
                          type: 'string',
                        },
                        updated_at: {
                          type: 'string',
                        },
                        usage: {
                          properties: {
                            cache_creation_tokens: {
                              maximum: 9007199254740991,
                              minimum: 0,
                              type: 'integer',
                            },
                            cache_read_tokens: {
                              maximum: 9007199254740991,
                              minimum: 0,
                              type: 'integer',
                            },
                            context_limit: {
                              maximum: 9007199254740991,
                              minimum: 0,
                              type: 'integer',
                            },
                            context_tokens: {
                              maximum: 9007199254740991,
                              minimum: 0,
                              type: 'integer',
                            },
                            input_tokens: {
                              maximum: 9007199254740991,
                              minimum: 0,
                              type: 'integer',
                            },
                            output_tokens: {
                              maximum: 9007199254740991,
                              minimum: 0,
                              type: 'integer',
                            },
                            total_cost_usd: {
                              minimum: 0,
                              type: 'number',
                            },
                            turn_count: {
                              maximum: 9007199254740991,
                              minimum: 0,
                              type: 'integer',
                            },
                          },
                          required: [
                            'input_tokens',
                            'output_tokens',
                            'cache_read_tokens',
                            'cache_creation_tokens',
                            'total_cost_usd',
                            'context_tokens',
                            'context_limit',
                            'turn_count',
                          ],
                          type: 'object',
                        },
                        workspace_id: {
                          pattern: '^wd_[a-z0-9._-]+_[0-9a-f]{12}$',
                          type: 'string',
                        },
                      },
                      required: [
                        'id',
                        'workspace_id',
                        'title',
                        'created_at',
                        'updated_at',
                        'busy',
                        'metadata',
                        'agent_config',
                        'usage',
                        'permission_rules',
                        'message_count',
                        'last_seq',
                      ],
                      type: 'object',
                    },
                    type: {
                      const: 'event.session.created',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'session',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    type: {
                      const: 'event.workspace.created',
                      type: 'string',
                    },
                    workspace: {
                      properties: {
                        created_at: {
                          type: 'string',
                        },
                        id: {
                          pattern: '^wd_[a-z0-9._-]+_[0-9a-f]{12}$',
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
                        'created_at',
                        'last_opened_at',
                        'session_count',
                      ],
                      type: 'object',
                    },
                  },
                  required: [
                    'type',
                    'workspace',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    type: {
                      const: 'event.workspace.updated',
                      type: 'string',
                    },
                    workspace: {
                      properties: {
                        created_at: {
                          type: 'string',
                        },
                        id: {
                          pattern: '^wd_[a-z0-9._-]+_[0-9a-f]{12}$',
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
                        'created_at',
                        'last_opened_at',
                        'session_count',
                      ],
                      type: 'object',
                    },
                  },
                  required: [
                    'type',
                    'workspace',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    root: {
                      minLength: 1,
                      type: 'string',
                    },
                    type: {
                      const: 'event.workspace.deleted',
                      type: 'string',
                    },
                    workspace_id: {
                      minLength: 1,
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'workspace_id',
                    'root',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    busy: {
                      type: 'boolean',
                    },
                    last_turn_reason: {
                      enum: [
                        'completed',
                        'cancelled',
                        'failed',
                      ],
                      type: 'string',
                    },
                    main_turn_active: {
                      type: 'boolean',
                    },
                    pending_interaction: {
                      enum: [
                        'none',
                        'approval',
                        'question',
                      ],
                      type: 'string',
                    },
                    type: {
                      const: 'event.session.work_changed',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'busy',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    current_prompt_id: {
                      minLength: 1,
                      type: 'string',
                    },
                    previous_status: {
                      enum: [
                        'idle',
                        'running',
                        'awaiting_approval',
                        'awaiting_question',
                        'aborted',
                      ],
                      type: 'string',
                    },
                    status: {
                      enum: [
                        'idle',
                        'running',
                        'awaiting_approval',
                        'awaiting_question',
                        'aborted',
                      ],
                      type: 'string',
                    },
                    type: {
                      const: 'event.session.status_changed',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'status',
                    'previous_status',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    change: {
                      properties: {
                        actor: {
                          enum: [
                            'user',
                            'model',
                            'runtime',
                            'system',
                          ],
                          type: 'string',
                        },
                        kind: {
                          enum: [
                            'lifecycle',
                            'completion',
                          ],
                          type: 'string',
                        },
                        reason: {
                          type: 'string',
                        },
                        stats: {
                          properties: {
                            tokensUsed: {
                              type: 'number',
                            },
                            turnsUsed: {
                              type: 'number',
                            },
                            wallClockMs: {
                              type: 'number',
                            },
                          },
                          required: [
                            'turnsUsed',
                            'tokensUsed',
                            'wallClockMs',
                          ],
                          type: 'object',
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
                      },
                      required: [
                        'kind',
                      ],
                      type: 'object',
                    },
                    snapshot: {
                      anyOf: [
                        {
                          properties: {
                            budget: {
                              properties: {
                                overBudget: {
                                  type: 'boolean',
                                },
                                remainingTokens: {
                                  anyOf: [
                                    {
                                      type: 'number',
                                    },
                                    {
                                      type: 'null',
                                    },
                                  ],
                                },
                                remainingTurns: {
                                  anyOf: [
                                    {
                                      type: 'number',
                                    },
                                    {
                                      type: 'null',
                                    },
                                  ],
                                },
                                remainingWallClockMs: {
                                  anyOf: [
                                    {
                                      type: 'number',
                                    },
                                    {
                                      type: 'null',
                                    },
                                  ],
                                },
                                tokenBudget: {
                                  anyOf: [
                                    {
                                      type: 'number',
                                    },
                                    {
                                      type: 'null',
                                    },
                                  ],
                                },
                                tokenBudgetReached: {
                                  type: 'boolean',
                                },
                                turnBudget: {
                                  anyOf: [
                                    {
                                      type: 'number',
                                    },
                                    {
                                      type: 'null',
                                    },
                                  ],
                                },
                                turnBudgetReached: {
                                  type: 'boolean',
                                },
                                wallClockBudgetMs: {
                                  anyOf: [
                                    {
                                      type: 'number',
                                    },
                                    {
                                      type: 'null',
                                    },
                                  ],
                                },
                                wallClockBudgetReached: {
                                  type: 'boolean',
                                },
                              },
                              required: [
                                'tokenBudget',
                                'turnBudget',
                                'wallClockBudgetMs',
                                'remainingTokens',
                                'remainingTurns',
                                'remainingWallClockMs',
                                'tokenBudgetReached',
                                'turnBudgetReached',
                                'wallClockBudgetReached',
                                'overBudget',
                              ],
                              type: 'object',
                            },
                            completionCriterion: {
                              type: 'string',
                            },
                            goalId: {
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
                            terminalReason: {
                              type: 'string',
                            },
                            tokensUsed: {
                              type: 'number',
                            },
                            turnsUsed: {
                              type: 'number',
                            },
                            wallClockMs: {
                              type: 'number',
                            },
                          },
                          required: [
                            'goalId',
                            'objective',
                            'status',
                            'turnsUsed',
                            'tokensUsed',
                            'wallClockMs',
                            'budget',
                          ],
                          type: 'object',
                        },
                        {
                          type: 'null',
                        },
                      ],
                    },
                    type: {
                      const: 'goal.updated',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'snapshot',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    activationId: {
                      type: 'string',
                    },
                    skillArgs: {
                      type: 'string',
                    },
                    skillName: {
                      type: 'string',
                    },
                    skillPath: {
                      type: 'string',
                    },
                    skillSource: {
                      enum: [
                        'project',
                        'user',
                        'extra',
                        'builtin',
                      ],
                      type: 'string',
                    },
                    trigger: {
                      enum: [
                        'user-slash',
                        'model-tool',
                        'nested-skill',
                      ],
                      type: 'string',
                    },
                    type: {
                      const: 'skill.activated',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'activationId',
                    'skillName',
                    'trigger',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    activationId: {
                      type: 'string',
                    },
                    commandArgs: {
                      type: 'string',
                    },
                    commandName: {
                      type: 'string',
                    },
                    pluginId: {
                      type: 'string',
                    },
                    trigger: {
                      const: 'user-slash',
                      type: 'string',
                    },
                    type: {
                      const: 'plugin_command.activated',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'activationId',
                    'pluginId',
                    'commandName',
                    'trigger',
                  ],
                  type: 'object',
                },
                {
                  properties: {
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
                            activationId: {
                              type: 'string',
                            },
                            kind: {
                              const: 'skill_activation',
                              type: 'string',
                            },
                            skillArgs: {
                              type: 'string',
                            },
                            skillName: {
                              type: 'string',
                            },
                            skillPath: {
                              type: 'string',
                            },
                            skillSource: {
                              enum: [
                                'project',
                                'user',
                                'extra',
                                'builtin',
                              ],
                              type: 'string',
                            },
                            skillType: {
                              type: 'string',
                            },
                            trigger: {
                              enum: [
                                'user-slash',
                                'model-tool',
                                'nested-skill',
                              ],
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'activationId',
                            'skillName',
                            'trigger',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            activationId: {
                              type: 'string',
                            },
                            commandArgs: {
                              type: 'string',
                            },
                            commandName: {
                              type: 'string',
                            },
                            kind: {
                              const: 'plugin_command',
                              type: 'string',
                            },
                            pluginId: {
                              type: 'string',
                            },
                            trigger: {
                              const: 'user-slash',
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'activationId',
                            'pluginId',
                            'commandName',
                            'trigger',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            kind: {
                              const: 'injection',
                              type: 'string',
                            },
                            variant: {
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'variant',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            isError: {
                              type: 'boolean',
                            },
                            kind: {
                              const: 'shell_command',
                              type: 'string',
                            },
                            phase: {
                              enum: [
                                'input',
                                'output',
                              ],
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'phase',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            kind: {
                              const: 'compaction_summary',
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
                              const: 'system_trigger',
                              type: 'string',
                            },
                            name: {
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
                            kind: {
                              const: 'task',
                              type: 'string',
                            },
                            notificationId: {
                              type: 'string',
                            },
                            status: {
                              enum: [
                                'running',
                                'completed',
                                'failed',
                                'timed_out',
                                'killed',
                                'lost',
                              ],
                              type: 'string',
                            },
                            taskId: {
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'taskId',
                            'status',
                            'notificationId',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            kind: {
                              const: 'background_task',
                              type: 'string',
                            },
                            notificationId: {
                              type: 'string',
                            },
                            status: {
                              enum: [
                                'running',
                                'completed',
                                'failed',
                                'timed_out',
                                'killed',
                                'lost',
                              ],
                              type: 'string',
                            },
                            taskId: {
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'taskId',
                            'status',
                            'notificationId',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            coalescedCount: {
                              type: 'number',
                            },
                            cron: {
                              type: 'string',
                            },
                            jobId: {
                              type: 'string',
                            },
                            kind: {
                              const: 'cron_job',
                              type: 'string',
                            },
                            recurring: {
                              type: 'boolean',
                            },
                            stale: {
                              type: 'boolean',
                            },
                          },
                          required: [
                            'kind',
                            'jobId',
                            'cron',
                            'recurring',
                            'coalescedCount',
                            'stale',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            count: {
                              type: 'number',
                            },
                            kind: {
                              const: 'cron_missed',
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'count',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            blocked: {
                              type: 'boolean',
                            },
                            event: {
                              type: 'string',
                            },
                            kind: {
                              const: 'hook_result',
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'event',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            kind: {
                              const: 'retry',
                              type: 'string',
                            },
                            trigger: {
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
                    turnId: {
                      type: 'number',
                    },
                    type: {
                      const: 'turn.started',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'turnId',
                    'origin',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    durationMs: {
                      type: 'number',
                    },
                    error: {
                      properties: {
                        cause: {
                          $ref: '#/definitions/__schema0',
                        },
                        code: {
                          enum: [
                            'config.invalid',
                            'session.not_found',
                            'session.already_exists',
                            'session.id_invalid',
                            'session.id_required',
                            'session.id_empty',
                            'session.title_empty',
                            'session.state_not_found',
                            'session.state_invalid',
                            'session.fork_active_turn',
                            'session.undo_unavailable',
                            'session.export_not_found',
                            'session.export_missing_version',
                            'session.export_output_conflict',
                            'session.export_too_large',
                            'session.closed',
                            'session.permission_mode_invalid',
                            'session.thinking_empty',
                            'session.model_empty',
                            'session.plan_mode_invalid',
                            'session.approval_handler_error',
                            'session.question_handler_error',
                            'session.init_failed',
                            'agent.not_found',
                            'activity.agent_busy',
                            'activity.cancelling',
                            'activity.disposing',
                            'activity.disposed',
                            'activity.initializing',
                            'activity.session_rejected',
                            'turn.agent_busy',
                            'goal.already_exists',
                            'goal.not_found',
                            'goal.objective_empty',
                            'goal.objective_too_long',
                            'goal.status_invalid',
                            'goal.metadata_reserved',
                            'goal.not_resumable',
                            'goal.unsupported_agent',
                            'model.not_configured',
                            'model.config_invalid',
                            'profile.thinking_alias_conflict',
                            'model.not_found',
                            'auth.login_required',
                            'auth.provisioning_required',
                            'auth.token_missing',
                            'auth.token_unauthorized',
                            'auth.model_not_resolved',
                            'context.overflow',
                            'loop.max_steps_exceeded',
                            'provider.api_error',
                            'provider.filtered',
                            'provider.rate_limit',
                            'provider.auth_error',
                            'provider.connection_error',
                            'provider.overloaded',
                            'provider.not_found',
                            'skill.not_found',
                            'skill.type_unsupported',
                            'skill.name_empty',
                            'records.write_failed',
                            'compaction.failed',
                            'compaction.unable',
                            'task.task_id_empty',
                            'usage.turn_id_conflict',
                            'mcp.server_not_found',
                            'mcp.server_disabled',
                            'mcp.startup_failed',
                            'mcp.tool_name_collision',
                            'message.not_found',
                            'plugin.not_found',
                            'plugin.load_failed',
                            'request.invalid',
                            'request.work_dir_required',
                            'request.prompt_input_empty',
                            'prompt.not_found',
                            'prompt.already_completed',
                            'session.busy',
                            'shell.git_bash_not_found',
                            'workspace.not_found',
                            'terminal.not_found',
                            'file.not_found',
                            'file.too_large',
                            'fs.path_not_found',
                            'fs.permission_denied',
                            'fs.path_escapes',
                            'fs.is_directory',
                            'fs.is_binary',
                            'fs.too_large',
                            'fs.already_exists',
                            'fs.too_many_results',
                            'fs.grep_timeout',
                            'fs.git_unavailable',
                            'validation.failed',
                            'not_implemented',
                            'internal',
                          ],
                          type: 'string',
                        },
                        details: {
                          additionalProperties: {},
                          propertyNames: {
                            type: 'string',
                          },
                          type: 'object',
                        },
                        message: {
                          type: 'string',
                        },
                        name: {
                          type: 'string',
                        },
                        retryable: {
                          type: 'boolean',
                        },
                      },
                      required: [
                        'code',
                        'message',
                        'retryable',
                      ],
                      type: 'object',
                    },
                    reason: {
                      enum: [
                        'completed',
                        'cancelled',
                        'failed',
                        'blocked',
                      ],
                      type: 'string',
                    },
                    turnId: {
                      type: 'number',
                    },
                    type: {
                      const: 'turn.ended',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'turnId',
                    'reason',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    step: {
                      type: 'number',
                    },
                    stepId: {
                      type: 'string',
                    },
                    turnId: {
                      type: 'number',
                    },
                    type: {
                      const: 'turn.step.started',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'turnId',
                    'step',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    finishReason: {
                      type: 'string',
                    },
                    llmClientConsumeMs: {
                      type: 'number',
                    },
                    llmFirstTokenLatencyMs: {
                      type: 'number',
                    },
                    llmRequestBuildMs: {
                      type: 'number',
                    },
                    llmServerDecodeMs: {
                      type: 'number',
                    },
                    llmServerFirstTokenMs: {
                      type: 'number',
                    },
                    llmStreamDurationMs: {
                      type: 'number',
                    },
                    providerFinishReason: {
                      enum: [
                        'completed',
                        'tool_calls',
                        'truncated',
                        'filtered',
                        'paused',
                        'other',
                      ],
                      type: 'string',
                    },
                    rawFinishReason: {
                      type: 'string',
                    },
                    step: {
                      type: 'number',
                    },
                    stepId: {
                      type: 'string',
                    },
                    turnId: {
                      type: 'number',
                    },
                    type: {
                      const: 'turn.step.completed',
                      type: 'string',
                    },
                    usage: {
                      properties: {
                        inputCacheCreation: {
                          type: 'number',
                        },
                        inputCacheRead: {
                          type: 'number',
                        },
                        inputOther: {
                          type: 'number',
                        },
                        output: {
                          type: 'number',
                        },
                      },
                      required: [
                        'inputOther',
                        'output',
                        'inputCacheRead',
                        'inputCacheCreation',
                      ],
                      type: 'object',
                    },
                  },
                  required: [
                    'type',
                    'turnId',
                    'step',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    delayMs: {
                      type: 'number',
                    },
                    errorMessage: {
                      type: 'string',
                    },
                    errorName: {
                      type: 'string',
                    },
                    failedAttempt: {
                      type: 'number',
                    },
                    maxAttempts: {
                      type: 'number',
                    },
                    nextAttempt: {
                      type: 'number',
                    },
                    statusCode: {
                      type: 'number',
                    },
                    step: {
                      type: 'number',
                    },
                    stepId: {
                      type: 'string',
                    },
                    turnId: {
                      type: 'number',
                    },
                    type: {
                      const: 'turn.step.retrying',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'turnId',
                    'step',
                    'failedAttempt',
                    'nextAttempt',
                    'maxAttempts',
                    'delayMs',
                    'errorName',
                    'errorMessage',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    message: {
                      type: 'string',
                    },
                    reason: {
                      type: 'string',
                    },
                    step: {
                      type: 'number',
                    },
                    stepId: {
                      type: 'string',
                    },
                    turnId: {
                      type: 'number',
                    },
                    type: {
                      const: 'turn.step.interrupted',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'turnId',
                    'step',
                    'reason',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    delta: {
                      type: 'string',
                    },
                    turnId: {
                      type: 'number',
                    },
                    type: {
                      const: 'assistant.delta',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'turnId',
                    'delta',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    blocked: {
                      type: 'boolean',
                    },
                    content: {
                      type: 'string',
                    },
                    hookEvent: {
                      type: 'string',
                    },
                    turnId: {
                      type: 'number',
                    },
                    type: {
                      const: 'hook.result',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'hookEvent',
                    'content',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    delta: {
                      type: 'string',
                    },
                    turnId: {
                      type: 'number',
                    },
                    type: {
                      const: 'thinking.delta',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'turnId',
                    'delta',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    argumentsPart: {
                      type: 'string',
                    },
                    name: {
                      type: 'string',
                    },
                    toolCallId: {
                      type: 'string',
                    },
                    turnId: {
                      type: 'number',
                    },
                    type: {
                      const: 'tool.call.delta',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'turnId',
                    'toolCallId',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    args: {},
                    description: {
                      type: 'string',
                    },
                    display: {
                      oneOf: [
                        {
                          properties: {
                            command: {
                              type: 'string',
                            },
                            cwd: {
                              type: 'string',
                            },
                            description: {
                              type: 'string',
                            },
                            kind: {
                              const: 'command',
                              type: 'string',
                            },
                            language: {
                              const: 'bash',
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'command',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            after: {
                              type: 'string',
                            },
                            before: {
                              type: 'string',
                            },
                            content: {
                              type: 'string',
                            },
                            detail: {
                              type: 'string',
                            },
                            kind: {
                              const: 'file_io',
                              type: 'string',
                            },
                            operation: {
                              enum: [
                                'read',
                                'write',
                                'edit',
                                'glob',
                                'grep',
                              ],
                              type: 'string',
                            },
                            path: {
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'operation',
                            'path',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            after: {
                              type: 'string',
                            },
                            before: {
                              type: 'string',
                            },
                            hunks: {
                              type: 'number',
                            },
                            kind: {
                              const: 'diff',
                              type: 'string',
                            },
                            path: {
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'path',
                            'before',
                            'after',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            kind: {
                              const: 'search',
                              type: 'string',
                            },
                            query: {
                              type: 'string',
                            },
                            scope: {
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'query',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            kind: {
                              const: 'url_fetch',
                              type: 'string',
                            },
                            method: {
                              type: 'string',
                            },
                            url: {
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'url',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            agent_name: {
                              type: 'string',
                            },
                            background: {
                              type: 'boolean',
                            },
                            kind: {
                              const: 'agent_call',
                              type: 'string',
                            },
                            prompt: {
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'agent_name',
                            'prompt',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            args: {
                              type: 'string',
                            },
                            kind: {
                              const: 'skill_call',
                              type: 'string',
                            },
                            skill_name: {
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'skill_name',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            items: {
                              items: {
                                properties: {
                                  status: {
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
                            kind: {
                              const: 'todo_list',
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'items',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            description: {
                              type: 'string',
                            },
                            kind: {
                              const: 'task',
                              type: 'string',
                            },
                            status: {
                              type: 'string',
                            },
                            task_id: {
                              type: 'string',
                            },
                            task_kind: {
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'task_id',
                            'status',
                            'description',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            kind: {
                              const: 'task_stop',
                              type: 'string',
                            },
                            task_description: {
                              type: 'string',
                            },
                            task_id: {
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'task_id',
                            'task_description',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            kind: {
                              const: 'plan_review',
                              type: 'string',
                            },
                            options: {
                              items: {
                                properties: {
                                  description: {
                                    type: 'string',
                                  },
                                  label: {
                                    type: 'string',
                                  },
                                },
                                required: [
                                  'label',
                                  'description',
                                ],
                                type: 'object',
                              },
                              readOnly: true,
                              type: 'array',
                            },
                            path: {
                              type: 'string',
                            },
                            plan: {
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'plan',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            completionCriterion: {
                              type: 'string',
                            },
                            kind: {
                              const: 'goal_start',
                              type: 'string',
                            },
                            mode: {
                              enum: [
                                'manual',
                                'yolo',
                              ],
                              type: 'string',
                            },
                            objective: {
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'objective',
                            'mode',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            detail: {},
                            kind: {
                              const: 'generic',
                              type: 'string',
                            },
                            summary: {
                              type: 'string',
                            },
                          },
                          required: [
                            'kind',
                            'summary',
                          ],
                          type: 'object',
                        },
                      ],
                    },
                    name: {
                      type: 'string',
                    },
                    toolCallId: {
                      type: 'string',
                    },
                    turnId: {
                      type: 'number',
                    },
                    type: {
                      const: 'tool.call.started',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'turnId',
                    'toolCallId',
                    'name',
                    'args',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    toolCallId: {
                      type: 'string',
                    },
                    turnId: {
                      type: 'number',
                    },
                    type: {
                      const: 'tool.progress',
                      type: 'string',
                    },
                    update: {
                      properties: {
                        customData: {},
                        customKind: {
                          type: 'string',
                        },
                        kind: {
                          enum: [
                            'stdout',
                            'stderr',
                            'progress',
                            'status',
                            'custom',
                          ],
                          type: 'string',
                        },
                        percent: {
                          type: 'number',
                        },
                        text: {
                          type: 'string',
                        },
                      },
                      required: [
                        'kind',
                      ],
                      type: 'object',
                    },
                  },
                  required: [
                    'type',
                    'turnId',
                    'toolCallId',
                    'update',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    commandId: {
                      type: 'string',
                    },
                    type: {
                      const: 'shell.output',
                      type: 'string',
                    },
                    update: {
                      properties: {
                        customData: {},
                        customKind: {
                          type: 'string',
                        },
                        kind: {
                          enum: [
                            'stdout',
                            'stderr',
                            'progress',
                            'status',
                            'custom',
                          ],
                          type: 'string',
                        },
                        percent: {
                          type: 'number',
                        },
                        text: {
                          type: 'string',
                        },
                      },
                      required: [
                        'kind',
                      ],
                      type: 'object',
                    },
                  },
                  required: [
                    'type',
                    'commandId',
                    'update',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    commandId: {
                      type: 'string',
                    },
                    taskId: {
                      type: 'string',
                    },
                    type: {
                      const: 'shell.started',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'commandId',
                    'taskId',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    isError: {
                      type: 'boolean',
                    },
                    output: {},
                    synthetic: {
                      type: 'boolean',
                    },
                    toolCallId: {
                      type: 'string',
                    },
                    turnId: {
                      type: 'number',
                    },
                    type: {
                      const: 'tool.result',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'turnId',
                    'toolCallId',
                    'output',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    reason: {
                      enum: [
                        'mcp.connected',
                        'mcp.disconnected',
                        'mcp.failed',
                      ],
                      type: 'string',
                    },
                    serverName: {
                      type: 'string',
                    },
                    type: {
                      const: 'tool.list.updated',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'reason',
                    'serverName',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    server: {
                      properties: {
                        error: {
                          type: 'string',
                        },
                        name: {
                          type: 'string',
                        },
                        status: {
                          enum: [
                            'pending',
                            'connected',
                            'failed',
                            'disabled',
                            'needs-auth',
                          ],
                          type: 'string',
                        },
                        toolCount: {
                          type: 'number',
                        },
                        transport: {
                          enum: [
                            'stdio',
                            'http',
                          ],
                          type: 'string',
                        },
                      },
                      required: [
                        'name',
                        'transport',
                        'status',
                        'toolCount',
                      ],
                      type: 'object',
                    },
                    type: {
                      const: 'mcp.server.status',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'server',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    callerAgentId: {
                      type: 'string',
                    },
                    description: {
                      type: 'string',
                    },
                    parentAgentId: {
                      type: 'string',
                    },
                    parentToolCallId: {
                      type: 'string',
                    },
                    parentToolCallUuid: {
                      type: 'string',
                    },
                    runInBackground: {
                      type: 'boolean',
                    },
                    subagentId: {
                      type: 'string',
                    },
                    subagentName: {
                      type: 'string',
                    },
                    swarmIndex: {
                      type: 'number',
                    },
                    type: {
                      const: 'subagent.spawned',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'subagentId',
                    'subagentName',
                    'parentToolCallId',
                    'runInBackground',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    subagentId: {
                      type: 'string',
                    },
                    type: {
                      const: 'subagent.started',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'subagentId',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    reason: {
                      type: 'string',
                    },
                    subagentId: {
                      type: 'string',
                    },
                    type: {
                      const: 'subagent.suspended',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'subagentId',
                    'reason',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    contextTokens: {
                      type: 'number',
                    },
                    resultSummary: {
                      type: 'string',
                    },
                    subagentId: {
                      type: 'string',
                    },
                    type: {
                      const: 'subagent.completed',
                      type: 'string',
                    },
                    usage: {
                      properties: {
                        inputCacheCreation: {
                          type: 'number',
                        },
                        inputCacheRead: {
                          type: 'number',
                        },
                        inputOther: {
                          type: 'number',
                        },
                        output: {
                          type: 'number',
                        },
                      },
                      required: [
                        'inputOther',
                        'output',
                        'inputCacheRead',
                        'inputCacheCreation',
                      ],
                      type: 'object',
                    },
                  },
                  required: [
                    'type',
                    'subagentId',
                    'resultSummary',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    error: {
                      type: 'string',
                    },
                    subagentId: {
                      type: 'string',
                    },
                    type: {
                      const: 'subagent.failed',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'subagentId',
                    'error',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    instruction: {
                      type: 'string',
                    },
                    trigger: {
                      enum: [
                        'manual',
                        'auto',
                      ],
                      type: 'string',
                    },
                    type: {
                      const: 'compaction.started',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'trigger',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    turnId: {
                      type: 'number',
                    },
                    type: {
                      const: 'compaction.blocked',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    type: {
                      const: 'compaction.cancelled',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    result: {
                      properties: {
                        compactedCount: {
                          type: 'number',
                        },
                        droppedCount: {
                          type: 'number',
                        },
                        keptHeadUserMessageCount: {
                          type: 'number',
                        },
                        keptUserMessageCount: {
                          type: 'number',
                        },
                        summary: {
                          type: 'string',
                        },
                        tokensAfter: {
                          type: 'number',
                        },
                        tokensBefore: {
                          type: 'number',
                        },
                      },
                      required: [
                        'summary',
                        'compactedCount',
                        'tokensBefore',
                        'tokensAfter',
                      ],
                      type: 'object',
                    },
                    type: {
                      const: 'compaction.completed',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'result',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    info: {
                      oneOf: [
                        {
                          properties: {
                            command: {
                              type: 'string',
                            },
                            description: {
                              type: 'string',
                            },
                            detached: {
                              type: 'boolean',
                            },
                            endedAt: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            exitCode: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            kind: {
                              const: 'process',
                              type: 'string',
                            },
                            pid: {
                              type: 'number',
                            },
                            startedAt: {
                              type: 'number',
                            },
                            status: {
                              enum: [
                                'running',
                                'completed',
                                'failed',
                                'timed_out',
                                'killed',
                                'lost',
                              ],
                              type: 'string',
                            },
                            stopReason: {
                              type: 'string',
                            },
                            taskId: {
                              type: 'string',
                            },
                            terminalNotificationSuppressed: {
                              type: 'boolean',
                            },
                            timeoutMs: {
                              type: 'number',
                            },
                          },
                          required: [
                            'taskId',
                            'description',
                            'status',
                            'startedAt',
                            'endedAt',
                            'kind',
                            'command',
                            'pid',
                            'exitCode',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            agentId: {
                              type: 'string',
                            },
                            description: {
                              type: 'string',
                            },
                            detached: {
                              type: 'boolean',
                            },
                            endedAt: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            kind: {
                              const: 'agent',
                              type: 'string',
                            },
                            startedAt: {
                              type: 'number',
                            },
                            status: {
                              enum: [
                                'running',
                                'completed',
                                'failed',
                                'timed_out',
                                'killed',
                                'lost',
                              ],
                              type: 'string',
                            },
                            stopReason: {
                              type: 'string',
                            },
                            subagentType: {
                              type: 'string',
                            },
                            taskId: {
                              type: 'string',
                            },
                            terminalNotificationSuppressed: {
                              type: 'boolean',
                            },
                            timeoutMs: {
                              type: 'number',
                            },
                          },
                          required: [
                            'taskId',
                            'description',
                            'status',
                            'startedAt',
                            'endedAt',
                            'kind',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            description: {
                              type: 'string',
                            },
                            detached: {
                              type: 'boolean',
                            },
                            endedAt: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            kind: {
                              const: 'question',
                              type: 'string',
                            },
                            questionCount: {
                              type: 'number',
                            },
                            startedAt: {
                              type: 'number',
                            },
                            status: {
                              enum: [
                                'running',
                                'completed',
                                'failed',
                                'timed_out',
                                'killed',
                                'lost',
                              ],
                              type: 'string',
                            },
                            stopReason: {
                              type: 'string',
                            },
                            taskId: {
                              type: 'string',
                            },
                            terminalNotificationSuppressed: {
                              type: 'boolean',
                            },
                            timeoutMs: {
                              type: 'number',
                            },
                            toolCallId: {
                              type: 'string',
                            },
                          },
                          required: [
                            'taskId',
                            'description',
                            'status',
                            'startedAt',
                            'endedAt',
                            'kind',
                            'questionCount',
                          ],
                          type: 'object',
                        },
                      ],
                    },
                    type: {
                      const: 'task.started',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'info',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    info: {
                      oneOf: [
                        {
                          properties: {
                            command: {
                              type: 'string',
                            },
                            description: {
                              type: 'string',
                            },
                            detached: {
                              type: 'boolean',
                            },
                            endedAt: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            exitCode: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            kind: {
                              const: 'process',
                              type: 'string',
                            },
                            pid: {
                              type: 'number',
                            },
                            startedAt: {
                              type: 'number',
                            },
                            status: {
                              enum: [
                                'running',
                                'completed',
                                'failed',
                                'timed_out',
                                'killed',
                                'lost',
                              ],
                              type: 'string',
                            },
                            stopReason: {
                              type: 'string',
                            },
                            taskId: {
                              type: 'string',
                            },
                            terminalNotificationSuppressed: {
                              type: 'boolean',
                            },
                            timeoutMs: {
                              type: 'number',
                            },
                          },
                          required: [
                            'taskId',
                            'description',
                            'status',
                            'startedAt',
                            'endedAt',
                            'kind',
                            'command',
                            'pid',
                            'exitCode',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            agentId: {
                              type: 'string',
                            },
                            description: {
                              type: 'string',
                            },
                            detached: {
                              type: 'boolean',
                            },
                            endedAt: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            kind: {
                              const: 'agent',
                              type: 'string',
                            },
                            startedAt: {
                              type: 'number',
                            },
                            status: {
                              enum: [
                                'running',
                                'completed',
                                'failed',
                                'timed_out',
                                'killed',
                                'lost',
                              ],
                              type: 'string',
                            },
                            stopReason: {
                              type: 'string',
                            },
                            subagentType: {
                              type: 'string',
                            },
                            taskId: {
                              type: 'string',
                            },
                            terminalNotificationSuppressed: {
                              type: 'boolean',
                            },
                            timeoutMs: {
                              type: 'number',
                            },
                          },
                          required: [
                            'taskId',
                            'description',
                            'status',
                            'startedAt',
                            'endedAt',
                            'kind',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            description: {
                              type: 'string',
                            },
                            detached: {
                              type: 'boolean',
                            },
                            endedAt: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            kind: {
                              const: 'question',
                              type: 'string',
                            },
                            questionCount: {
                              type: 'number',
                            },
                            startedAt: {
                              type: 'number',
                            },
                            status: {
                              enum: [
                                'running',
                                'completed',
                                'failed',
                                'timed_out',
                                'killed',
                                'lost',
                              ],
                              type: 'string',
                            },
                            stopReason: {
                              type: 'string',
                            },
                            taskId: {
                              type: 'string',
                            },
                            terminalNotificationSuppressed: {
                              type: 'boolean',
                            },
                            timeoutMs: {
                              type: 'number',
                            },
                            toolCallId: {
                              type: 'string',
                            },
                          },
                          required: [
                            'taskId',
                            'description',
                            'status',
                            'startedAt',
                            'endedAt',
                            'kind',
                            'questionCount',
                          ],
                          type: 'object',
                        },
                      ],
                    },
                    type: {
                      const: 'task.terminated',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'info',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    info: {
                      oneOf: [
                        {
                          properties: {
                            command: {
                              type: 'string',
                            },
                            description: {
                              type: 'string',
                            },
                            detached: {
                              type: 'boolean',
                            },
                            endedAt: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            exitCode: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            kind: {
                              const: 'process',
                              type: 'string',
                            },
                            pid: {
                              type: 'number',
                            },
                            startedAt: {
                              type: 'number',
                            },
                            status: {
                              enum: [
                                'running',
                                'completed',
                                'failed',
                                'timed_out',
                                'killed',
                                'lost',
                              ],
                              type: 'string',
                            },
                            stopReason: {
                              type: 'string',
                            },
                            taskId: {
                              type: 'string',
                            },
                            terminalNotificationSuppressed: {
                              type: 'boolean',
                            },
                            timeoutMs: {
                              type: 'number',
                            },
                          },
                          required: [
                            'taskId',
                            'description',
                            'status',
                            'startedAt',
                            'endedAt',
                            'kind',
                            'command',
                            'pid',
                            'exitCode',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            agentId: {
                              type: 'string',
                            },
                            description: {
                              type: 'string',
                            },
                            detached: {
                              type: 'boolean',
                            },
                            endedAt: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            kind: {
                              const: 'agent',
                              type: 'string',
                            },
                            startedAt: {
                              type: 'number',
                            },
                            status: {
                              enum: [
                                'running',
                                'completed',
                                'failed',
                                'timed_out',
                                'killed',
                                'lost',
                              ],
                              type: 'string',
                            },
                            stopReason: {
                              type: 'string',
                            },
                            subagentType: {
                              type: 'string',
                            },
                            taskId: {
                              type: 'string',
                            },
                            terminalNotificationSuppressed: {
                              type: 'boolean',
                            },
                            timeoutMs: {
                              type: 'number',
                            },
                          },
                          required: [
                            'taskId',
                            'description',
                            'status',
                            'startedAt',
                            'endedAt',
                            'kind',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            description: {
                              type: 'string',
                            },
                            detached: {
                              type: 'boolean',
                            },
                            endedAt: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            kind: {
                              const: 'question',
                              type: 'string',
                            },
                            questionCount: {
                              type: 'number',
                            },
                            startedAt: {
                              type: 'number',
                            },
                            status: {
                              enum: [
                                'running',
                                'completed',
                                'failed',
                                'timed_out',
                                'killed',
                                'lost',
                              ],
                              type: 'string',
                            },
                            stopReason: {
                              type: 'string',
                            },
                            taskId: {
                              type: 'string',
                            },
                            terminalNotificationSuppressed: {
                              type: 'boolean',
                            },
                            timeoutMs: {
                              type: 'number',
                            },
                            toolCallId: {
                              type: 'string',
                            },
                          },
                          required: [
                            'taskId',
                            'description',
                            'status',
                            'startedAt',
                            'endedAt',
                            'kind',
                            'questionCount',
                          ],
                          type: 'object',
                        },
                      ],
                    },
                    type: {
                      const: 'background.task.started',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'info',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    info: {
                      oneOf: [
                        {
                          properties: {
                            command: {
                              type: 'string',
                            },
                            description: {
                              type: 'string',
                            },
                            detached: {
                              type: 'boolean',
                            },
                            endedAt: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            exitCode: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            kind: {
                              const: 'process',
                              type: 'string',
                            },
                            pid: {
                              type: 'number',
                            },
                            startedAt: {
                              type: 'number',
                            },
                            status: {
                              enum: [
                                'running',
                                'completed',
                                'failed',
                                'timed_out',
                                'killed',
                                'lost',
                              ],
                              type: 'string',
                            },
                            stopReason: {
                              type: 'string',
                            },
                            taskId: {
                              type: 'string',
                            },
                            terminalNotificationSuppressed: {
                              type: 'boolean',
                            },
                            timeoutMs: {
                              type: 'number',
                            },
                          },
                          required: [
                            'taskId',
                            'description',
                            'status',
                            'startedAt',
                            'endedAt',
                            'kind',
                            'command',
                            'pid',
                            'exitCode',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            agentId: {
                              type: 'string',
                            },
                            description: {
                              type: 'string',
                            },
                            detached: {
                              type: 'boolean',
                            },
                            endedAt: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            kind: {
                              const: 'agent',
                              type: 'string',
                            },
                            startedAt: {
                              type: 'number',
                            },
                            status: {
                              enum: [
                                'running',
                                'completed',
                                'failed',
                                'timed_out',
                                'killed',
                                'lost',
                              ],
                              type: 'string',
                            },
                            stopReason: {
                              type: 'string',
                            },
                            subagentType: {
                              type: 'string',
                            },
                            taskId: {
                              type: 'string',
                            },
                            terminalNotificationSuppressed: {
                              type: 'boolean',
                            },
                            timeoutMs: {
                              type: 'number',
                            },
                          },
                          required: [
                            'taskId',
                            'description',
                            'status',
                            'startedAt',
                            'endedAt',
                            'kind',
                          ],
                          type: 'object',
                        },
                        {
                          properties: {
                            description: {
                              type: 'string',
                            },
                            detached: {
                              type: 'boolean',
                            },
                            endedAt: {
                              anyOf: [
                                {
                                  type: 'number',
                                },
                                {
                                  type: 'null',
                                },
                              ],
                            },
                            kind: {
                              const: 'question',
                              type: 'string',
                            },
                            questionCount: {
                              type: 'number',
                            },
                            startedAt: {
                              type: 'number',
                            },
                            status: {
                              enum: [
                                'running',
                                'completed',
                                'failed',
                                'timed_out',
                                'killed',
                                'lost',
                              ],
                              type: 'string',
                            },
                            stopReason: {
                              type: 'string',
                            },
                            taskId: {
                              type: 'string',
                            },
                            terminalNotificationSuppressed: {
                              type: 'boolean',
                            },
                            timeoutMs: {
                              type: 'number',
                            },
                            toolCallId: {
                              type: 'string',
                            },
                          },
                          required: [
                            'taskId',
                            'description',
                            'status',
                            'startedAt',
                            'endedAt',
                            'kind',
                            'questionCount',
                          ],
                          type: 'object',
                        },
                      ],
                    },
                    type: {
                      const: 'background.task.terminated',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'info',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    origin: {
                      properties: {
                        coalescedCount: {
                          type: 'number',
                        },
                        cron: {
                          type: 'string',
                        },
                        jobId: {
                          type: 'string',
                        },
                        kind: {
                          const: 'cron_job',
                          type: 'string',
                        },
                        recurring: {
                          type: 'boolean',
                        },
                        stale: {
                          type: 'boolean',
                        },
                      },
                      required: [
                        'kind',
                        'jobId',
                        'cron',
                        'recurring',
                        'coalescedCount',
                        'stale',
                      ],
                      type: 'object',
                    },
                    prompt: {
                      type: 'string',
                    },
                    type: {
                      const: 'cron.fired',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'origin',
                    'prompt',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    content: {
                      items: {
                        oneOf: [
                          {
                            properties: {
                              text: {
                                type: 'string',
                              },
                              type: {
                                const: 'text',
                                type: 'string',
                              },
                            },
                            required: [
                              'type',
                              'text',
                            ],
                            type: 'object',
                          },
                          {
                            properties: {
                              input: {},
                              tool_call_id: {
                                minLength: 1,
                                type: 'string',
                              },
                              tool_name: {
                                minLength: 1,
                                type: 'string',
                              },
                              type: {
                                const: 'tool_use',
                                type: 'string',
                              },
                            },
                            required: [
                              'type',
                              'tool_call_id',
                              'tool_name',
                              'input',
                            ],
                            type: 'object',
                          },
                          {
                            properties: {
                              is_error: {
                                type: 'boolean',
                              },
                              output: {},
                              tool_call_id: {
                                minLength: 1,
                                type: 'string',
                              },
                              type: {
                                const: 'tool_result',
                                type: 'string',
                              },
                            },
                            required: [
                              'type',
                              'tool_call_id',
                              'output',
                            ],
                            type: 'object',
                          },
                          {
                            properties: {
                              source: {
                                oneOf: [
                                  {
                                    properties: {
                                      kind: {
                                        const: 'url',
                                        type: 'string',
                                      },
                                      url: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                    },
                                    required: [
                                      'kind',
                                      'url',
                                    ],
                                    type: 'object',
                                  },
                                  {
                                    properties: {
                                      data: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                      kind: {
                                        const: 'base64',
                                        type: 'string',
                                      },
                                      media_type: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                    },
                                    required: [
                                      'kind',
                                      'media_type',
                                      'data',
                                    ],
                                    type: 'object',
                                  },
                                  {
                                    properties: {
                                      file_id: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                      kind: {
                                        const: 'file',
                                        type: 'string',
                                      },
                                    },
                                    required: [
                                      'kind',
                                      'file_id',
                                    ],
                                    type: 'object',
                                  },
                                ],
                              },
                              type: {
                                const: 'image',
                                type: 'string',
                              },
                            },
                            required: [
                              'type',
                              'source',
                            ],
                            type: 'object',
                          },
                          {
                            properties: {
                              source: {
                                oneOf: [
                                  {
                                    properties: {
                                      kind: {
                                        const: 'url',
                                        type: 'string',
                                      },
                                      url: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                    },
                                    required: [
                                      'kind',
                                      'url',
                                    ],
                                    type: 'object',
                                  },
                                  {
                                    properties: {
                                      data: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                      kind: {
                                        const: 'base64',
                                        type: 'string',
                                      },
                                      media_type: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                    },
                                    required: [
                                      'kind',
                                      'media_type',
                                      'data',
                                    ],
                                    type: 'object',
                                  },
                                  {
                                    properties: {
                                      file_id: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                      kind: {
                                        const: 'file',
                                        type: 'string',
                                      },
                                    },
                                    required: [
                                      'kind',
                                      'file_id',
                                    ],
                                    type: 'object',
                                  },
                                ],
                              },
                              type: {
                                const: 'video',
                                type: 'string',
                              },
                            },
                            required: [
                              'type',
                              'source',
                            ],
                            type: 'object',
                          },
                          {
                            properties: {
                              file_id: {
                                minLength: 1,
                                type: 'string',
                              },
                              media_type: {
                                minLength: 1,
                                type: 'string',
                              },
                              name: {
                                type: 'string',
                              },
                              size: {
                                maximum: 9007199254740991,
                                minimum: 0,
                                type: 'integer',
                              },
                              type: {
                                const: 'file',
                                type: 'string',
                              },
                            },
                            required: [
                              'type',
                              'file_id',
                              'name',
                              'media_type',
                              'size',
                            ],
                            type: 'object',
                          },
                          {
                            properties: {
                              signature: {
                                type: 'string',
                              },
                              thinking: {
                                type: 'string',
                              },
                              type: {
                                const: 'thinking',
                                type: 'string',
                              },
                            },
                            required: [
                              'type',
                              'thinking',
                            ],
                            type: 'object',
                          },
                        ],
                      },
                      type: 'array',
                    },
                    createdAt: {
                      type: 'string',
                    },
                    promptId: {
                      type: 'string',
                    },
                    status: {
                      enum: [
                        'running',
                        'queued',
                        'blocked',
                      ],
                      type: 'string',
                    },
                    type: {
                      const: 'prompt.submitted',
                      type: 'string',
                    },
                    userMessageId: {
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'promptId',
                    'userMessageId',
                    'status',
                    'content',
                    'createdAt',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    finishedAt: {
                      type: 'string',
                    },
                    promptId: {
                      type: 'string',
                    },
                    reason: {
                      enum: [
                        'completed',
                        'failed',
                        'blocked',
                      ],
                      type: 'string',
                    },
                    type: {
                      const: 'prompt.completed',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'promptId',
                    'finishedAt',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    abortedAt: {
                      type: 'string',
                    },
                    promptId: {
                      type: 'string',
                    },
                    type: {
                      const: 'prompt.aborted',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'promptId',
                    'abortedAt',
                  ],
                  type: 'object',
                },
                {
                  properties: {
                    activePromptId: {
                      type: 'string',
                    },
                    content: {
                      items: {
                        oneOf: [
                          {
                            properties: {
                              text: {
                                type: 'string',
                              },
                              type: {
                                const: 'text',
                                type: 'string',
                              },
                            },
                            required: [
                              'type',
                              'text',
                            ],
                            type: 'object',
                          },
                          {
                            properties: {
                              input: {},
                              tool_call_id: {
                                minLength: 1,
                                type: 'string',
                              },
                              tool_name: {
                                minLength: 1,
                                type: 'string',
                              },
                              type: {
                                const: 'tool_use',
                                type: 'string',
                              },
                            },
                            required: [
                              'type',
                              'tool_call_id',
                              'tool_name',
                              'input',
                            ],
                            type: 'object',
                          },
                          {
                            properties: {
                              is_error: {
                                type: 'boolean',
                              },
                              output: {},
                              tool_call_id: {
                                minLength: 1,
                                type: 'string',
                              },
                              type: {
                                const: 'tool_result',
                                type: 'string',
                              },
                            },
                            required: [
                              'type',
                              'tool_call_id',
                              'output',
                            ],
                            type: 'object',
                          },
                          {
                            properties: {
                              source: {
                                oneOf: [
                                  {
                                    properties: {
                                      kind: {
                                        const: 'url',
                                        type: 'string',
                                      },
                                      url: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                    },
                                    required: [
                                      'kind',
                                      'url',
                                    ],
                                    type: 'object',
                                  },
                                  {
                                    properties: {
                                      data: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                      kind: {
                                        const: 'base64',
                                        type: 'string',
                                      },
                                      media_type: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                    },
                                    required: [
                                      'kind',
                                      'media_type',
                                      'data',
                                    ],
                                    type: 'object',
                                  },
                                  {
                                    properties: {
                                      file_id: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                      kind: {
                                        const: 'file',
                                        type: 'string',
                                      },
                                    },
                                    required: [
                                      'kind',
                                      'file_id',
                                    ],
                                    type: 'object',
                                  },
                                ],
                              },
                              type: {
                                const: 'image',
                                type: 'string',
                              },
                            },
                            required: [
                              'type',
                              'source',
                            ],
                            type: 'object',
                          },
                          {
                            properties: {
                              source: {
                                oneOf: [
                                  {
                                    properties: {
                                      kind: {
                                        const: 'url',
                                        type: 'string',
                                      },
                                      url: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                    },
                                    required: [
                                      'kind',
                                      'url',
                                    ],
                                    type: 'object',
                                  },
                                  {
                                    properties: {
                                      data: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                      kind: {
                                        const: 'base64',
                                        type: 'string',
                                      },
                                      media_type: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                    },
                                    required: [
                                      'kind',
                                      'media_type',
                                      'data',
                                    ],
                                    type: 'object',
                                  },
                                  {
                                    properties: {
                                      file_id: {
                                        minLength: 1,
                                        type: 'string',
                                      },
                                      kind: {
                                        const: 'file',
                                        type: 'string',
                                      },
                                    },
                                    required: [
                                      'kind',
                                      'file_id',
                                    ],
                                    type: 'object',
                                  },
                                ],
                              },
                              type: {
                                const: 'video',
                                type: 'string',
                              },
                            },
                            required: [
                              'type',
                              'source',
                            ],
                            type: 'object',
                          },
                          {
                            properties: {
                              file_id: {
                                minLength: 1,
                                type: 'string',
                              },
                              media_type: {
                                minLength: 1,
                                type: 'string',
                              },
                              name: {
                                type: 'string',
                              },
                              size: {
                                maximum: 9007199254740991,
                                minimum: 0,
                                type: 'integer',
                              },
                              type: {
                                const: 'file',
                                type: 'string',
                              },
                            },
                            required: [
                              'type',
                              'file_id',
                              'name',
                              'media_type',
                              'size',
                            ],
                            type: 'object',
                          },
                          {
                            properties: {
                              signature: {
                                type: 'string',
                              },
                              thinking: {
                                type: 'string',
                              },
                              type: {
                                const: 'thinking',
                                type: 'string',
                              },
                            },
                            required: [
                              'type',
                              'thinking',
                            ],
                            type: 'object',
                          },
                        ],
                      },
                      type: 'array',
                    },
                    promptIds: {
                      items: {
                        type: 'string',
                      },
                      type: 'array',
                    },
                    steeredAt: {
                      type: 'string',
                    },
                    type: {
                      const: 'prompt.steered',
                      type: 'string',
                    },
                  },
                  required: [
                    'type',
                    'activePromptId',
                    'promptIds',
                    'content',
                    'steeredAt',
                  ],
                  type: 'object',
                },
              ],
            },
            {
              properties: {
                agentId: {
                  type: 'string',
                },
                sessionId: {
                  type: 'string',
                },
              },
              required: [
                'agentId',
                'sessionId',
              ],
              type: 'object',
            },
          ],
        },
        seq: {
          maximum: 9007199254740991,
          minimum: 0,
          type: 'integer',
        },
        session_id: {
          type: 'string',
        },
        timestamp: {
          type: 'string',
        },
        type: {
          type: 'string',
        },
        volatile: {
          type: 'boolean',
        },
      },
      required: [
        'type',
        'seq',
        'timestamp',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'subscribe',
    title: 'Subscribe',
    summary: 'Subscribe the connection to one or more session event streams.',
    direction: 'client_to_server',
    payload: {
      properties: {
        id: {
          type: 'string',
        },
        payload: {
          properties: {
            agent_filter: {
              additionalProperties: {
                items: {
                  type: 'string',
                },
                minItems: 1,
                type: 'array',
              },
              propertyNames: {
                type: 'string',
              },
              type: 'object',
            },
            cursors: {
              additionalProperties: {
                properties: {
                  epoch: {
                    minLength: 1,
                    type: 'string',
                  },
                  seq: {
                    maximum: 9007199254740991,
                    minimum: 0,
                    type: 'integer',
                  },
                },
                required: [
                  'seq',
                ],
                type: 'object',
              },
              propertyNames: {
                type: 'string',
              },
              type: 'object',
            },
            session_ids: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
            watch_fs: {
              additionalProperties: {
                properties: {
                  paths: {
                    items: {
                      type: 'string',
                    },
                    type: 'array',
                  },
                  recursive: {
                    type: 'boolean',
                  },
                },
                required: [
                  'paths',
                ],
                type: 'object',
              },
              propertyNames: {
                type: 'string',
              },
              type: 'object',
            },
          },
          required: [
            'session_ids',
          ],
          type: 'object',
        },
        type: {
          const: 'subscribe',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'subscribe.ack',
    title: 'Subscribe Ack',
    summary: 'Acknowledgement for subscribe.',
    direction: 'server_to_client',
    payload: {
      properties: {
        code: {
          maximum: 9007199254740991,
          minimum: -9007199254740991,
          type: 'integer',
        },
        id: {
          type: 'string',
        },
        msg: {
          type: 'string',
        },
        payload: {
          properties: {
            accepted: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
            cursors: {
              additionalProperties: {
                properties: {
                  epoch: {
                    minLength: 1,
                    type: 'string',
                  },
                  seq: {
                    maximum: 9007199254740991,
                    minimum: 0,
                    type: 'integer',
                  },
                },
                required: [
                  'seq',
                ],
                type: 'object',
              },
              propertyNames: {
                type: 'string',
              },
              type: 'object',
            },
            not_found: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
            resync_required: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
          },
          required: [
            'accepted',
            'not_found',
            'resync_required',
          ],
          type: 'object',
        },
        type: {
          const: 'ack',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'code',
        'msg',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'terminal_attach',
    title: 'Terminal Attach',
    summary: 'Attach this connection to a terminal stream.',
    direction: 'client_to_server',
    payload: {
      properties: {
        id: {
          type: 'string',
        },
        payload: {
          properties: {
            session_id: {
              minLength: 1,
              type: 'string',
            },
            since_seq: {
              maximum: 9007199254740991,
              minimum: 0,
              type: 'integer',
            },
            terminal_id: {
              minLength: 1,
              type: 'string',
            },
          },
          required: [
            'session_id',
            'terminal_id',
          ],
          type: 'object',
        },
        type: {
          const: 'terminal_attach',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'terminal_attach.ack',
    title: 'Terminal Attach Ack',
    summary: 'Acknowledgement for terminal_attach.',
    direction: 'server_to_client',
    payload: {
      properties: {
        code: {
          maximum: 9007199254740991,
          minimum: -9007199254740991,
          type: 'integer',
        },
        id: {
          type: 'string',
        },
        msg: {
          type: 'string',
        },
        payload: {
          properties: {
            attached: {
              const: true,
              type: 'boolean',
            },
            replayed: {
              maximum: 9007199254740991,
              minimum: 0,
              type: 'integer',
            },
          },
          required: [
            'attached',
            'replayed',
          ],
          type: 'object',
        },
        type: {
          const: 'ack',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'code',
        'msg',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'terminal_close',
    title: 'Terminal Close',
    summary: 'Close a terminal.',
    direction: 'client_to_server',
    payload: {
      properties: {
        id: {
          type: 'string',
        },
        payload: {
          properties: {
            session_id: {
              minLength: 1,
              type: 'string',
            },
            terminal_id: {
              minLength: 1,
              type: 'string',
            },
          },
          required: [
            'session_id',
            'terminal_id',
          ],
          type: 'object',
        },
        type: {
          const: 'terminal_close',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'terminal_close.ack',
    title: 'Terminal Close Ack',
    summary: 'Acknowledgement for terminal_close.',
    direction: 'server_to_client',
    payload: {
      properties: {
        code: {
          maximum: 9007199254740991,
          minimum: -9007199254740991,
          type: 'integer',
        },
        id: {
          type: 'string',
        },
        msg: {
          type: 'string',
        },
        payload: {
          properties: {
            closed: {
              const: true,
              type: 'boolean',
            },
          },
          required: [
            'closed',
          ],
          type: 'object',
        },
        type: {
          const: 'ack',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'code',
        'msg',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'terminal_detach',
    title: 'Terminal Detach',
    summary: 'Detach this connection from a terminal stream.',
    direction: 'client_to_server',
    payload: {
      properties: {
        id: {
          type: 'string',
        },
        payload: {
          properties: {
            session_id: {
              minLength: 1,
              type: 'string',
            },
            terminal_id: {
              minLength: 1,
              type: 'string',
            },
          },
          required: [
            'session_id',
            'terminal_id',
          ],
          type: 'object',
        },
        type: {
          const: 'terminal_detach',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'terminal_detach.ack',
    title: 'Terminal Detach Ack',
    summary: 'Acknowledgement for terminal_detach.',
    direction: 'server_to_client',
    payload: {
      properties: {
        code: {
          maximum: 9007199254740991,
          minimum: -9007199254740991,
          type: 'integer',
        },
        id: {
          type: 'string',
        },
        msg: {
          type: 'string',
        },
        payload: {
          properties: {
            detached: {
              const: true,
              type: 'boolean',
            },
          },
          required: [
            'detached',
          ],
          type: 'object',
        },
        type: {
          const: 'ack',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'code',
        'msg',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'terminal_input',
    title: 'Terminal Input',
    summary: 'Write raw input bytes to a terminal.',
    direction: 'client_to_server',
    payload: {
      properties: {
        id: {
          type: 'string',
        },
        payload: {
          properties: {
            data: {
              type: 'string',
            },
            session_id: {
              minLength: 1,
              type: 'string',
            },
            terminal_id: {
              minLength: 1,
              type: 'string',
            },
          },
          required: [
            'session_id',
            'terminal_id',
            'data',
          ],
          type: 'object',
        },
        type: {
          const: 'terminal_input',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'terminal_input.ack',
    title: 'Terminal Input Ack',
    summary: 'Acknowledgement for terminal_input.',
    direction: 'server_to_client',
    payload: {
      properties: {
        code: {
          maximum: 9007199254740991,
          minimum: -9007199254740991,
          type: 'integer',
        },
        id: {
          type: 'string',
        },
        msg: {
          type: 'string',
        },
        payload: {
          properties: {
            accepted: {
              const: true,
              type: 'boolean',
            },
          },
          required: [
            'accepted',
          ],
          type: 'object',
        },
        type: {
          const: 'ack',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'code',
        'msg',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'terminal_resize',
    title: 'Terminal Resize',
    summary: 'Resize a terminal.',
    direction: 'client_to_server',
    payload: {
      properties: {
        id: {
          type: 'string',
        },
        payload: {
          properties: {
            cols: {
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
              type: 'integer',
            },
            rows: {
              exclusiveMinimum: 0,
              maximum: 9007199254740991,
              type: 'integer',
            },
            session_id: {
              minLength: 1,
              type: 'string',
            },
            terminal_id: {
              minLength: 1,
              type: 'string',
            },
          },
          required: [
            'session_id',
            'terminal_id',
            'cols',
            'rows',
          ],
          type: 'object',
        },
        type: {
          const: 'terminal_resize',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'terminal_resize.ack',
    title: 'Terminal Resize Ack',
    summary: 'Acknowledgement for terminal_resize.',
    direction: 'server_to_client',
    payload: {
      properties: {
        code: {
          maximum: 9007199254740991,
          minimum: -9007199254740991,
          type: 'integer',
        },
        id: {
          type: 'string',
        },
        msg: {
          type: 'string',
        },
        payload: {
          properties: {
            resized: {
              const: true,
              type: 'boolean',
            },
          },
          required: [
            'resized',
          ],
          type: 'object',
        },
        type: {
          const: 'ack',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'code',
        'msg',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'unsubscribe',
    title: 'Unsubscribe',
    summary: 'Remove one or more session event stream subscriptions.',
    direction: 'client_to_server',
    payload: {
      properties: {
        id: {
          type: 'string',
        },
        payload: {
          properties: {
            session_ids: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
          },
          required: [
            'session_ids',
          ],
          type: 'object',
        },
        type: {
          const: 'unsubscribe',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'unsubscribe.ack',
    title: 'Unsubscribe Ack',
    summary: 'Acknowledgement for unsubscribe.',
    direction: 'server_to_client',
    payload: {
      properties: {
        code: {
          maximum: 9007199254740991,
          minimum: -9007199254740991,
          type: 'integer',
        },
        id: {
          type: 'string',
        },
        msg: {
          type: 'string',
        },
        payload: {
          properties: {
            accepted: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
            cursors: {
              additionalProperties: {
                properties: {
                  epoch: {
                    minLength: 1,
                    type: 'string',
                  },
                  seq: {
                    maximum: 9007199254740991,
                    minimum: 0,
                    type: 'integer',
                  },
                },
                required: [
                  'seq',
                ],
                type: 'object',
              },
              propertyNames: {
                type: 'string',
              },
              type: 'object',
            },
            not_found: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
            resync_required: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
          },
          required: [
            'accepted',
            'not_found',
            'resync_required',
          ],
          type: 'object',
        },
        type: {
          const: 'ack',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'code',
        'msg',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'watch_fs_add',
    title: 'Watch Fs Add',
    summary: 'Add filesystem watch paths for a subscribed session.',
    direction: 'client_to_server',
    payload: {
      properties: {
        id: {
          type: 'string',
        },
        payload: {
          properties: {
            paths: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
            recursive: {
              type: 'boolean',
            },
            session_id: {
              type: 'string',
            },
          },
          required: [
            'session_id',
            'paths',
          ],
          type: 'object',
        },
        type: {
          const: 'watch_fs_add',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'watch_fs_add.ack',
    title: 'Watch Fs Add Ack',
    summary: 'Acknowledgement for watch_fs_add.',
    direction: 'server_to_client',
    payload: {
      properties: {
        code: {
          maximum: 9007199254740991,
          minimum: -9007199254740991,
          type: 'integer',
        },
        id: {
          type: 'string',
        },
        msg: {
          type: 'string',
        },
        payload: {
          properties: {
            current_count: {
              maximum: 9007199254740991,
              minimum: 0,
              type: 'integer',
            },
            watched_paths: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
          },
          type: 'object',
        },
        type: {
          const: 'ack',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'code',
        'msg',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'watch_fs_remove',
    title: 'Watch Fs Remove',
    summary: 'Remove filesystem watch paths for a subscribed session.',
    direction: 'client_to_server',
    payload: {
      properties: {
        id: {
          type: 'string',
        },
        payload: {
          properties: {
            paths: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
            session_id: {
              type: 'string',
            },
          },
          required: [
            'session_id',
            'paths',
          ],
          type: 'object',
        },
        type: {
          const: 'watch_fs_remove',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'payload',
      ],
      type: 'object',
    },
  },
  {
    name: 'watch_fs_remove.ack',
    title: 'Watch Fs Remove Ack',
    summary: 'Acknowledgement for watch_fs_remove.',
    direction: 'server_to_client',
    payload: {
      properties: {
        code: {
          maximum: 9007199254740991,
          minimum: -9007199254740991,
          type: 'integer',
        },
        id: {
          type: 'string',
        },
        msg: {
          type: 'string',
        },
        payload: {
          properties: {
            current_count: {
              maximum: 9007199254740991,
              minimum: 0,
              type: 'integer',
            },
            watched_paths: {
              items: {
                type: 'string',
              },
              type: 'array',
            },
          },
          type: 'object',
        },
        type: {
          const: 'ack',
          type: 'string',
        },
      },
      required: [
        'type',
        'id',
        'code',
        'msg',
        'payload',
      ],
      type: 'object',
    },
  },
] as const satisfies readonly KimiWebSocketMessage[]

export type KimiWebSocketMessageName = (typeof KIMI_WEB_SOCKET_MESSAGES)[number]['name']
