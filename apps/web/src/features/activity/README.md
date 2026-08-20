# Features/Activity

Renderer-owned UI activity pipeline: resolves the entity the user is on, emits
segment started/ended events for entity switch, idle (with idle resume), and
hidden/visible, and fans out to built-in sinks (product analytics, Jarvis
ambient observations). Plugins consume the narrower Code Activity projection
instead of this internal bus.

## Files

- **types.ts**: Entity types, event shapes, idle/observation constants
- **entity-resolver.ts**: Browser-panel tab → focused split → surface route
- **activity-engine.ts**: Segment lifecycle (entity / idle / hidden / idle resume)
- **activity-bus.ts**: Process-wide bus with Cradle-owned handler isolation
- **activity-runtime.tsx**: App boot runtime that ticks resolution and installs sinks
