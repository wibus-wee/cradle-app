/**
 * Features — sticky scroll panel with interactive demos
 */

import {
  CheckCircle2, Clock, Play, Plus, Puzzle, RefreshCw, Shield, Square, Zap,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'

const demoOuter: React.CSSProperties = {
  border: '1px solid var(--border)',
  background: 'var(--bg-subtle)',
  overflow: 'hidden',
}

const demoHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', padding: '8px 14px',
  borderBottom: '1px solid var(--border-subtle)', gap: 8,
}

const demoBtn: React.CSSProperties = {
  padding: '2px 8px', border: '1px solid var(--border)', background: 'var(--fill)',
  color: 'var(--text-secondary)', fontSize: 10, cursor: 'pointer', display: 'flex',
  alignItems: 'center', gap: 4,
}

/* ─── Demos ─────────────────────────────────────────────────────── */

const ORCH_AGENTS = [
  { id: 1, name: 'Claude Code', task: 'refactor auth', progress: 68, accent: '#8b5cf6' },
  { id: 2, name: 'Codex', task: 'write tests', progress: 41, accent: '#3b82f6' },
  { id: 3, name: 'Cursor', task: 'update docs', progress: 83, accent: '#10b981' },
]

function OrchestrationDemo() {
  const [running, setRunning] = useState(true)
  const [agents, setAgents] = useState(ORCH_AGENTS)
  const toggle = () => setRunning(r => !r)
  const reset = () => { setAgents(ORCH_AGENTS.map(a => ({ ...a, progress: Math.floor(Math.random() * 55) + 20 }))); setRunning(true) }

  return (
    <div style={demoOuter}>
      <div style={demoHeader}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', flex: 1 }}>{agents.length} parallel agents</span>
        <motion.button whileTap={{ scale: 0.92 }} onClick={toggle} style={demoBtn}>
          {running ? <><Square style={{ width: 8, height: 8 }} />pause</> : <><Play style={{ width: 8, height: 8 }} />resume</>}
        </motion.button>
        <motion.button whileTap={{ scale: 0.92 }} onClick={reset} style={{ ...demoBtn, gap: 0, padding: '2px 6px' }}>
          <RefreshCw style={{ width: 8, height: 8 }} />
        </motion.button>
      </div>
      <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {agents.map(a => (
          <div key={a.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <motion.span style={{ width: 7, height: 7, borderRadius: '50%', background: a.accent, flexShrink: 0, display: 'block' }} animate={running ? { opacity: [1, 0.3, 1] } : {}} transition={{ duration: 1.5, repeat: Infinity }} />
              <span style={{ fontSize: 11, color: a.accent, fontWeight: 600, flex: 1 }}>{a.name}</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{a.task}</span>
            </div>
            <div style={{ height: 3, background: 'var(--bg-muted)', overflow: 'hidden' }}>
              <motion.div style={{ height: '100%', background: a.accent }} animate={{ width: running ? `${Math.min(100, a.progress + 15)}%` : `${a.progress}%` }} transition={{ duration: running ? 2.8 : 0.3, ease: 'linear', repeat: running ? Infinity : 0 }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SessionAwaitDemo() {
  const [phase, setPhase] = useState<'waiting' | 'passed' | 'resumed'>('waiting')
  const advance = () => setPhase(p => p === 'waiting' ? 'passed' : p === 'passed' ? 'resumed' : 'waiting')
  const steps = [
    { label: 'PR #142 pushed', done: true },
    { label: 'Waiting for CI…', done: phase !== 'waiting', active: phase === 'waiting' },
    { label: 'CI passed ✓', done: phase === 'resumed', active: phase === 'passed' },
    { label: 'Session resumed', done: false, active: phase === 'resumed' },
  ]

  return (
    <div style={{ ...demoOuter, padding: 0 }}>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 14 }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: !s.done && !s.active ? 0.3 : 1 }}>
            <div style={{
              width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
              background: s.done ? 'rgba(16,185,129,0.1)' : s.active ? 'rgba(245,158,11,0.08)' : 'var(--fill)',
              border: `1px solid ${s.done ? 'rgba(16,185,129,0.3)' : s.active ? 'rgba(245,158,11,0.3)' : 'var(--border)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            >
              {s.done ? <CheckCircle2 style={{ width: 10, height: 10, color: '#10b981' }} />
                : s.active ? <motion.span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b', display: 'block' }} animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
                : null}
            </div>
            <span style={{ fontSize: 11, color: s.done || s.active ? 'var(--text-secondary)' : 'var(--text-muted)' }}>{s.label}</span>
          </div>
        ))}
      </div>
      <div style={{ padding: '0 16px 16px' }}>
        <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }} onClick={advance} style={{
          width: '100%', padding: '8px', border: '1px solid var(--border)', background: 'var(--fill)',
          color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer',
        }}
        >
          {phase === 'waiting' ? '→ Simulate CI pass' : phase === 'passed' ? '→ Resume session' : '↺ Reset'}
        </motion.button>
      </div>
    </div>
  )
}

function LocalFirstDemo() {
  const [hovered, setHovered] = useState<string | null>(null)
  const rows = [
    { key: 'API keys', val: 'Keychain encrypted' },
    { key: 'Session history', val: 'Local SQLite' },
    { key: 'Agent output', val: 'On-disk only' },
    { key: 'Telemetry', val: 'None — ever' },
  ]
  return (
    <div style={demoOuter}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Shield style={{ width: 12, height: 12, color: '#10b981' }} />
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Data stays on your machine</span>
      </div>
      {rows.map(r => (
        <motion.div key={r.key} onHoverStart={() => setHovered(r.key)} onHoverEnd={() => setHovered(null)} animate={{ background: hovered === r.key ? 'rgba(16,185,129,0.04)' : 'transparent' }} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '9px 14px', borderBottom: '1px solid var(--border-subtle)', cursor: 'default',
        }}
        >
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{r.key}</span>
          <span style={{ fontSize: 10, padding: '2px 8px', border: '1px solid rgba(16,185,129,0.15)', background: 'rgba(16,185,129,0.05)', color: '#10b981' }}>{r.val}</span>
        </motion.div>
      ))}
    </div>
  )
}

const PLUGINS_DATA = [
  { name: 'browser-use', desc: 'Web automation', accent: '#8b5cf6', installed: true },
  { name: 'system-info', desc: 'System metrics', accent: '#3b82f6', installed: true },
  { name: 'cc-switch', desc: 'Context switching', accent: '#10b981', installed: false },
]

function PluginsDemo() {
  const [plugins, setPlugins] = useState(PLUGINS_DATA)
  const toggle = useCallback((name: string) => {
    setPlugins(prev => prev.map(p => p.name === name ? { ...p, installed: !p.installed } : p))
  }, [])

  return (
    <div style={demoOuter}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Plugin registry</span>
      </div>
      {plugins.map(p => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', gap: 12 }}>
          <div style={{ width: 28, height: 28, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Puzzle style={{ width: 12, height: 12, color: p.accent }} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{p.name}</p>
            <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>{p.desc}</p>
          </div>
          <motion.button whileTap={{ scale: 0.9 }} onClick={() => toggle(p.name)} style={{
            padding: '3px 10px', border: `1px solid ${p.installed ? 'rgba(16,185,129,0.2)' : 'var(--border)'}`,
            background: p.installed ? 'rgba(16,185,129,0.05)' : 'var(--fill)', color: p.installed ? '#10b981' : 'var(--text-secondary)',
            fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            transition: 'background 0.2s, border-color 0.2s, color 0.2s',
          }}
          >
            {p.installed ? <><CheckCircle2 style={{ width: 9, height: 9 }} />installed</> : <><Plus style={{ width: 9, height: 9 }} />install</>}
          </motion.button>
        </div>
      ))}
      <div style={{ padding: '10px 14px' }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>+ build your own with the plugin SDK →</span>
      </div>
    </div>
  )
}

/* ─── Features config ──────────────────────────────────────────── */

const FEATURES = [
  { id: 'orchestration', Icon: Zap, accent: '#8b5cf6', badge: 'Multi-agent', title: 'Run four agents on the same codebase. Simultaneously.', desc: 'Love Claude Code? Run four of them at once. Cradle orchestrates every agent as a parallel worker — each with its own task, Kanban card, and live status.', Demo: OrchestrationDemo },
  { id: 'session-await', Icon: Clock, accent: '#f59e0b', badge: 'Session Await', title: 'Your agent pushed a PR. It\'s waiting for CI. You don\'t have to be.', desc: 'Set a condition — "resume when CI passes" — and Cradle suspends the session. When the condition fires, the agent picks up exactly where it left off.', Demo: SessionAwaitDemo },
  { id: 'local-first', Icon: Shield, accent: '#10b981', badge: 'Local-first', title: 'Your code is yours. It never leaves your machine.', desc: 'No cloud relay, no telemetry, no third-party logging. API keys in system keychain. Session history in local SQLite.', Demo: LocalFirstDemo },
  { id: 'plugins', Icon: Puzzle, accent: '#3b82f6', badge: 'Extensible', title: 'A plugin system built for what we haven\'t imagined yet.', desc: 'Cradle ships with a plugin SDK. Add new runtimes, tools, workflow triggers — the surface area is yours.', Demo: PluginsDemo },
]

/* ─── Features section ─────────────────────────────────────────── */

export function Features() {
  const [activeId, setActiveId] = useState(FEATURES[0].id)
  const activeFeature = FEATURES.find(f => f.id === activeId) ?? FEATURES[0]

  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) { const id = (entry.target as HTMLElement).dataset.feature; if (id) setActiveId(id) }
      }
    }, { threshold: 0.55 })
    const nodes = document.querySelectorAll('[data-feature]')
    nodes.forEach(n => observer.observe(n))
    return () => observer.disconnect()
  }, [])

  return (
    <section style={{ padding: '80px 24px', borderTop: '1px solid var(--border-subtle)' }} id="features">
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <h2 style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.02em', color: 'var(--text)', marginBottom: 12 }}>
            Everything you need to orchestrate AI.
            <br />
            <span style={{ color: 'var(--text-muted)' }}>Nothing you don't.</span>
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'start' }}>
          <div>
            {FEATURES.map((f, i) => (
              <div
                key={f.id}
                data-feature={f.id}
                style={{
                  minHeight: '55vh',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center',
                  transition: 'opacity 0.3s',
                  opacity: activeId === f.id ? 1 : 0.35,
                  border: '1px dashed var(--border)',
                  padding: '24px',
                  margin: i === 0 ? '0 0 24px 0' : '24px 0',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <div style={{ width: 24, height: 24, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <f.Icon style={{ width: 12, height: 12, color: f.accent }} />
                  </div>
                  <span style={{ fontSize: 11, color: f.accent, fontWeight: 500 }}>{f.badge}</span>
                </div>
                <h3 style={{ fontSize: 'clamp(1rem, 1.8vw, 1.2rem)', fontWeight: 600, lineHeight: 1.35, letterSpacing: '-0.015em', color: 'var(--text)', marginBottom: 12 }}>{f.title}</h3>
                <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text-secondary)' }}>{f.desc}</p>
              </div>
            ))}
          </div>

          <div style={{ position: 'sticky', top: 80, alignSelf: 'flex-start' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              {FEATURES.map(f => (
                <motion.div key={f.id} animate={{ width: activeId === f.id ? 16 : 5, background: activeId === f.id ? f.accent : 'var(--border)' }} transition={{ duration: 0.3 }} style={{ height: 3 }} />
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={activeFeature.id} initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -12, filter: 'blur(4px)' }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
                <activeFeature.Demo />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  )
}
