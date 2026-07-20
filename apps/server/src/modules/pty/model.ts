import { t } from 'elysia'

export const PtyModel = {
  sessionIdParams: t.Object({
    sessionId: t.String({ minLength: 1 }),
  }),

  ptyIdParams: t.Object({
    ptyId: t.String({ minLength: 1 }),
  }),

  startOrAttachBody: t.Object({
    cols: t.Integer({ minimum: 1 }),
    rows: t.Integer({ minimum: 1 }),
  }),

  startOrAttachResponse: t.Object({
    sessionId: t.String(),
    running: t.Boolean(),
    mode: t.Union([
      t.Literal('live-attach'),
      t.Literal('resume'),
      t.Literal('fresh'),
      t.Literal('history'),
    ]),
    agent: t.Optional(t.String()),
    restore: t.Optional(t.Object({
      mode: t.Union([
        t.Literal('live-attach'),
        t.Literal('resume'),
        t.Literal('fresh'),
        t.Literal('history'),
      ]),
      agent: t.Optional(t.String()),
      reason: t.Optional(t.String()),
    })),
  }),

  hostResponse: t.Object({
    sessionId: t.String(),
    role: t.Literal('cli-tui'),
    running: t.Boolean(),
    phase: t.Union([
      t.Literal('absent'),
      t.Literal('running'),
      t.Literal('exited'),
    ]),
    mode: t.Nullable(t.Union([
      t.Literal('live-attach'),
      t.Literal('resume'),
      t.Literal('fresh'),
      t.Literal('history'),
    ])),
    agent: t.Nullable(t.String()),
    workspacePath: t.String(),
    ptyStartedAt: t.Nullable(t.Number()),
    providerSession: t.Nullable(t.Object({
      source: t.String(),
      agent: t.String(),
      kind: t.Union([t.Literal('id'), t.Literal('path')]),
      value: t.String(),
      workspacePath: t.String(),
      capturedAt: t.Number(),
      startedAt: t.Number(),
      sourcePath: t.Optional(t.String()),
      confidence: t.Union([t.Literal('exact'), t.Literal('heuristic')]),
    })),
    historyEnabled: t.Boolean(),
    hasHistory: t.Boolean(),
  }),

  providerSessionBody: t.Object({
    source: t.String({ minLength: 1 }),
    agent: t.String({ minLength: 1 }),
    kind: t.Optional(t.Union([t.Literal('id'), t.Literal('path')])),
    value: t.String({ minLength: 1, maxLength: 512 }),
    sourcePath: t.Optional(t.String({ minLength: 1 })),
    confidence: t.Optional(t.Union([t.Literal('exact'), t.Literal('heuristic')])),
  }),

  providerSessionResponse: t.Object({
    sessionId: t.String(),
    providerSession: t.Nullable(t.Object({
      source: t.String(),
      agent: t.String(),
      kind: t.Union([t.Literal('id'), t.Literal('path')]),
      value: t.String(),
      workspacePath: t.String(),
      capturedAt: t.Number(),
      startedAt: t.Number(),
      sourcePath: t.Optional(t.String()),
      confidence: t.Union([t.Literal('exact'), t.Literal('heuristic')]),
    })),
  }),

  startShellResponse: t.Object({
    ptyId: t.String(),
    running: t.Boolean(),
  }),

  inputBody: t.Object({
    data: t.String({ minLength: 1 }),
  }),

  resizeBody: t.Object({
    cols: t.Integer({ minimum: 1 }),
    rows: t.Integer({ minimum: 1 }),
  }),

  okResponse: t.Object({
    ok: t.Literal(true),
  }),

  resourcesResponse: t.Object({
    terminals: t.Array(
      t.Object({
        id: t.String(),
        role: t.Union([t.Literal('cli-tui'), t.Literal('bottom-panel')]),
        pid: t.Number(),
        executable: t.String(),
        cwd: t.String(),
        running: t.Boolean(),
        startedAt: t.Number(),
        cols: t.Number(),
        rows: t.Number(),
        rssMB: t.Nullable(t.Number()),
        cpuPercent: t.Nullable(t.Number()),
        descendantCount: t.Nullable(t.Number()),
      }),
    ),
    totals: t.Object({
      cliTuiRssMB: t.Number(),
      bottomPanelRssMB: t.Number(),
      cliTuiCpuPercent: t.Number(),
      bottomPanelCpuPercent: t.Number(),
    }),
    timestamp: t.Number(),
  }),

  startShellBody: t.Object({
    ptyId: t.String({ minLength: 1 }),
    cwd: t.String({ minLength: 1 }),
    cols: t.Integer({ minimum: 1 }),
    rows: t.Integer({ minimum: 1 }),
  }),

  liveChannelQuery: t.Object({
    fromSeq: t.Optional(t.Numeric({ minimum: 0 })),
  }),

  clientEvent: t.Any(),

  serverEvent: t.Any(),
}
