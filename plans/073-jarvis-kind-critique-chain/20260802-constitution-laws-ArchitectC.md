# Constitutional Laws — Jarvis-as-Kind without a Second Brain

**Role:** Exploration Agent C — Constitutional Architect / anti-orchestration-gravity  
**Date:** 2026-08-02  
**Audience:** decision-makers and subsequent critique-chain agents  
**Scope:** platform-level laws only. No APIs, schemas, Function taxonomies, engineering phases, or Jarvis internals.

---

## Premise (self-contained)

Cradle wants a Jarvis-like presence: a continuous system organism that can manage the platform and beyond, across heterogeneous model workers. The strategic claim under scrutiny is that Jarvis is not one agent but a **Kind** (species) — many capabilities, one durable system identity.

This brief asserts: that vision is only constitutional if Cradle remains an **honest control tower** and never becomes a **magic orchestrator**. If Cradle starts owning native turn/session scheduling, micro-approving worker steps, or forcing every actor to ask permission before acting, the Kind collapses into a central brain with remote procedures attached. That failure mode is already named in Cradle's IRON LAW for Claude; the same law must bind every native cognition substrate and the species concept itself.

---

## 1. Platform laws (constitutional invariants)

Each law is stated so a future auditor could, in principle, construct a falsifying scenario without needing a particular API.

**L1 — Projection, never schedule ownership.**  
Cradle may observe, record, project, and surface native runtime events. Cradle may not become the owner of turn coalescing, result boundaries, interrupt/still-queued semantics, or any peer-native equivalent.  
*Falsifier:* A native worker continues cognitive work under a Cradle-invented turn/run identity that the native substrate did not schedule.

**L2 — No synthetic continuation of the same native work.**  
When a native substrate emits an empty, early, or ambiguous completion signal, Cradle must not close a user-visible unit of work and reopen a system-origin unit to "keep going." Continuity of native work belongs to the native substrate.  
*Falsifier:* Empty/early native result → Cradle clears active user-originated projection → opens system-origin projection for the same ongoing native cognition.

**L3 — Kind is identity-of-purpose, not a second scheduler.**  
An AgentKind (species) may name durable role, trust envelope, memory scope, and allowed initiative. It must not be implemented as a platform process that sequences other agents' turns.  
*Falsifier:* Workers routinely block on "Kind said proceed" before each native action that the worker's own substrate could already take.

**L4 — Local competence over central permission.**  
A worker that has been honestly delegated work acts within its scope without per-step permission from Cradle or from a Kind control process. Structural routing and receipt collection are allowed; semantic micro-management is not.  
*Falsifier:* The modal worker loop is ask-control-plane → wait → act → report → ask again for the next micro-step.

**L5 — External state is shadow, not substance.**  
Platform stores (runs, queue, work graph, chronicle, situation pictures) are projections for humans, audit, and inter-agent *results*. They are never treated as the live cognitive state of a model worker. Resuming from platform state creates a new context told a story — not a resumed mind.  
*Falsifier:* Product or Kind policy claims "we restored the agent" solely by reinjecting structured platform snapshots into a fresh context, and treats discontinuities as bugs in the worker rather than expected reconstruction loss.

**L6 — Silence is not death; absence is not authority.**  
Non-observation must not trigger automatic replacement, retry, or reassignment. Only explicit outcomes, receipts, or human/Kind decisions may change work ownership.  
*Falsifier:* Timeout or quiet period alone causes Cradle to kill/replace a worker or reassign its mandate.

**L7 — Honest outcomes over comforting narratives.**  
Every composed mutation with external effects must yield an explicit outcome. Worker self-reports remain labeled as worker reports, not platform-verified truth. The control tower may be incomplete; it may not lie about completeness.  
*Falsifier:* UI or Kind narrative presents "done/verified" when only a worker claim or a partial projection exists.

**L8 — Ownership namespaces bind Kind power.**  
Read across, write within. A Kind may propose or act only inside namespaces it owns or has been explicitly granted. Cross-namespace writes require a clear owning feature's consent semantics — not Kind convenience.  
*Falsifier:* Platform Kind freely mutates another feature's lifecycle data because "the organism needs it."

**L9 — Strategy stays with Kind and human; platform owns truthfulness.**  
Decomposition, topology, placement, parallelism, and recovery *strategy* are chosen by the Kind (or human), not by Cradle's control plane. Cradle owns durable truth of what was asked, what was accepted, what was observed, and what was receipted.  
*Falsifier:* Cradle auto-chooses worker placement/strategy and presents that as Kind intention.

**L10 — Initiative is gated policy, never ambient privilege.**  
Default species posture is propose-or-observe unless an explicit, revocable policy grants act. Ambient surfaces (HiJarvis-like) must not silently inherit platform-act authority because they share a brand or catalog label with a Kind.  
*Falsifier:* Catalog placement `jarvis` or ambient personal surface can mutate platform work without a named initiative grant.

**L11 — Heterogeneous natives remain first-class.**  
Claude, Codex, Kimi, OpenCode, ACP, plugins, and future substrates keep their own scheduling authority. Cradle's species layer must not homogenize them into Cradle-turns.  
*Falsifier:* Supporting a new provider requires teaching Cradle to "drive" that provider's turn machine rather than project it.

**L12 — Prefer deleting wrong seams over adding ownership.**  
If making Kind work appears to require Cradle to own native lifecycle again, the correct move is stop and redesign — not a compatibility shim that reintroduces schedule ownership.  
*Falsifier:* A Kind feature lands whose correctness proof depends on Cradle interpreting native scheduling as Cradle turns.

---

## 2. Honest control tower vs magic orchestrator

| | Honest control tower | Magic orchestrator |
|---|---|---|
| **Job** | Make work, delegation, receipts, and risk *legible* | Decide what everyone should do next |
| **Authority** | Truth of record; policy fences; blast-radius envelopes | Semantic strategy; step approval; turn ownership |
| **Relationship to workers** | Projects their events; binds mandates to receipts | Becomes their scheduler and conscience |
| **Failure mode it avoids** | Lying completeness; silent reassignment; stolen turns | Bottleneck + knowledge sink + cascade SPOF |
| **Success signal** | Human/Kind can answer: who has what mandate, what was observed, what is unverified | System "just handles it" — until it can't and no one can see why |
| **builder-orchestrator products-aligned non-goal echo** | No hidden scheduler, no silence-as-death, no fake verification | Those non-goals inverted into product features |

**Honest control tower means:** Cradle is the place you trust *not to invent cognition*. It shows the situation picture, holds the work graph, records delegate→receipt contracts, enforces ownership and initiative gates, and refuses to paper over native ambiguity with synthetic runs.

**Magic orchestrator means:** Cradle (or a Kind-as-process mistaken for Cradle) becomes the brain every worker asks. That feels like architecture. It is Orchestration Gravity. At that point "agents" are RPCs with context windows.

Jarvis-as-Kind is allowed to *be strategic*. Cradle is not allowed to *become* Jarvis's scheduler — nor to become the scheduler Jarvis uses as a substitute for its own judgment.

---

## 3. How IRON LAW constrains the species concept itself

IRON LAW today is written for Claude Agent SDK. Constitutionally it is not a Claude quirk; it is a **substrate sovereignty** law.

Applied to species:

1. **Kind continuity ≠ Cradle turn continuity.**  
   A Kind may have long-lived identity, memory scope, and work attachment. That continuity must not be implemented by stitching Cradle UI runs across native result boundaries. Species memory and mandate continuity live above projection; native turns live below. Confusing the layers re-creates the empty-user→system-synthetic failure as a product feature.

2. **Species cannot be "the thing that owns everyone's turns."**  
   If Jarvis Kind is defined as the organism that sequences heterogeneous workers the way a workflow engine sequences jobs, Cradle will be pressured to mediate every native lifecycle. That pressure is exactly what IRON LAW forbids. Therefore the species concept must be defined as **identity + mandate + policy + memory envelope**, not as **platform-owned multi-runtime scheduler**.

3. **Projection honesty is Kind honesty.**  
   A Kind that narrates progress from Cradle projections must inherit the same bans: no inventing completion, no absorbing queue ownership by heuristic, no treating `currentTurn` as native truth. Otherwise the Kind becomes a laundering layer for schedule theft.

4. **Provider-native crews stay provider-native.**  
   Where a runtime already has crews/threads, Cradle projects them; Kind may *strategically* delegate into them; Cradle must not re-host that crew's scheduling as Cradle multi-session orchestration pretending to be the same work.

5. **If Kind power requires schedule ownership, Kind definition is wrong.**  
   L12 applies at the species boundary: redesign the Kind's constitutional shape rather than carve an IRON LAW exception "just for Jarvis."

---

## 4. Where Orchestration Gravity will attack this vision

Predictable attack vectors — treat as watchlist, not as features to build:

1. **"Jarvis should just coordinate everything."**  
   Product language slides from Kind-as-organism to Kind-as-central-coordinator. Workers start asking what to do next. Local competence dies.

2. **"One situation picture means one decision brain."**  
   Unified observability is legitimate for a control tower. Gravity will demand that the picture also *decide*. Resist: picture ≠ pilot.

3. **"Empty result looks broken — invent a system run."**  
   Already a known Cradle failure mode. Gravity will rename it "Kind continuity" or "ambient follow-through."

4. **"Externalize all Kind state into the work graph."**  
   State externalization fallacy: the graph becomes the pretended mind; restoration theater replaces context health. Gravity loves dashboards that look like control.

5. **"Silence means replace the worker."**  
   Ops anxiety → automatic retry/replacement. Violates L6; creates thrash and false authority.

6. **"Catalog label `jarvis` = platform act rights."**  
   Placement and brand bleed into initiative. Ambient personal surface quietly becomes god-mode.

7. **"Homogenize providers so Kind can drive them."**  
   Heterogeneous projection is hard; Gravity offers a Cradle-turn abstraction. That is schedule ownership by another name.

8. **"Legion mode as default."**  
   Seed leaves legion open. Gravity will pull default toward always-on multi-agent fan-out with Cradle as router. Escalation ladder says: climb only on evidence of failure at lower rungs.

9. **"Status snapshots every turn for the Kind."**  
   Snapshot anti-pattern: fills context with management theater; Kind looks governable and becomes less so.

10. **"Kind writes everywhere for coherence."**  
    Ownership law erodes "for the organism." Blast radius becomes the whole machine.

---

## 5. Answers to the five super-choices

These are constitutional positions. They may disagree with a Strategist who optimizes for power or speed.

### 5.1 Species first-class?

**Yes — but as a narrow constitutional object.**  
Jarvis must be a first-class AgentKind (species), parallel to something like a Coding Kind — not a chat upgrade, not a catalog placement, not HiJarvis ambient alone.  

**Bound:** first-class means identity, trust envelope, memory scope, initiative policy, and mandate/receipt participation — **not** a platform scheduler process. Without species, "Jarvis" remains branding. With an over-wide species, IRON LAW dies.

### 5.2 Build order?

**Control-tower honesty and work-plane completeness before species power.**  
Agree with the seed's prior claim. Expanding Kind initiative or ambient act rights on top of synthetic-run risk, weak receipts, and no situation honesty produces a charismatic liar.  

Power without truthfulness is not strategy; it is unsafe theater. Build the tower's ability to refuse lies before giving the Kind more keys.

### 5.3 Product center of gravity?

**Work/Issue as the durable center; Session as execution carrier; Kind as strategic actor attached to work — not as chat avatar.**  
Shift emphasis from Session/Chat as the product nucleus toward Work/Issue as the graph humans and Kind share. Sessions remain where native cognition runs and where IRON LAW binds.  

**Caveat:** do not make the work graph pretend to be cognitive state (L5). The center is *shared durable intent and mandate*, not a substitute mind.

### 5.4 Orchestration ceiling?

**Platform ceiling = honest delegation semantics + truth of record + policy fences.**  
Strategy, decomposition, and "what next" stay with Kind/human.  

**No default legion mode.** A later product choice for legion is only constitutional if it remains Kind/human-chosen strategy executed through honest delegate→receipt, without Cradle schedule ownership. Platform must not climb the orchestration ladder because the ladder looks impressive.

### 5.5 Initiative red line?

**Default propose-only (and observe); act only under explicit, revocable, Kind-scoped policy.**  
Unresolved in the seed — resolve it here toward caution. Ambient personal surfaces default to observe/propose. Platform-wide act is never implied by brand.  

Autonomous act inside owned namespaces may exist later as policy grants, not as species birthright. Human must be able to see and revoke the grant. When uncertain whether an action is propose or act, it is propose.

---

## 6. Ranked gaps (constitution / safety lens)

Ranked by what most blocks a *safe* platform species from existing — not by engineering difficulty.

1. **No constitutional species object** — without Kind as first-class (narrowly defined), Jarvis is catalog/UX; gravity fills the vacuum with a central brain.  
2. **No IRON-LAW-generalized substrate sovereignty** — Claude-only law invites "exceptions" for Kind continuity across providers.  
3. **Missing honest delegate→receipt contract as platform semantics** — without it, Kind strategy cannot couple to workers without becoming a permission bottleneck or a liar.  
4. **Weak / dishonest situation picture** — incomplete is fine; comforting false completeness is not. Species cannot be accountable on a lying tower.  
5. **Initiative / sense→act policy layer absent** — ambient can observe but Kind-shaped act rights are undefined → either paralysis or silent god-mode.  
6. **Trust / blast-radius envelopes not Kind-scoped** — species power without write-within bounds violates ownership and invites whole-platform mutation.  
7. **Kind-scoped continuity memory undefined** — risk of implementing "memory" as Cradle turn stitching or snapshot restoration theater.  
8. **Work plane incomplete relative to Session plane** — if Session remains the only real center, Kind will be implemented as chat orchestration (gravity wins).  
9. **Constitutional vocabulary missing** — without shared words for projection vs schedule, mandate vs turn, report vs verified, every feature debate rediscovers gravity.

---

## 7. Explicit non-goals (multi-year horizon)

For the foreseeable multi-year horizon, Cradle **will not** pursue:

1. Cradle-owned universal turn/session scheduler across providers.  
2. Automatic placement, capacity allocation, fairness queues, or priority aging as Kind infrastructure.  
3. Automatic retry/replacement of workers based on silence or dashboard anxiety.  
4. Kind-as-central-brain that micro-approves worker steps.  
5. Homogenizing heterogeneous natives into Cradle-turn abstractions.  
6. Treating platform stores as resumable minds.  
7. Ambient personal surface as default platform-act authority.  
8. Legion/multi-agent fan-out as the default product mode.  
9. Magic completeness: UI narratives that upgrade worker reports into verified truth without evidence.  
10. Compatibility shims that reintroduce schedule ownership "temporarily" for Kind.  
11. A product requirement that every worker ask Cradle or Kind-control what to do next.  
12. Designing Jarvis internal Function maps, MCP tool lists, or phased guts plans as a substitute for these laws (out of scope here and constitutionally premature).

These echo builder-orchestrator products's orchestration non-goals as *principles*: strong primitives and truthfulness, little magic; agents own strategy; platform owns honest mechanics — not a second cognition.

---

## 8. Tension register (must remain visible)

Do not "resolve" these by rhetoric. Keep them on the wall.

| ID | Tension | Why it stays open |
|----|---------|-------------------|
| T1 | **Continuous organism identity** vs **substrate-sovereign discontinuous turns** | Kind wants continuity; natives emit awkward results. The illegal resolution is synthetic Cradle runs. The legal resolution is mandate/memory continuity *above* projection — always slightly unsatisfying. |
| T2 | **Unified situation picture** vs **anti-central-brain** | One picture looks like one pilot. Tower needs the picture; Kind needs not to become RPC dispatcher. |
| T3 | **Work graph as product center** vs **context window as real state** | Work must be shared and durable; cognition is not in the graph. Over-centering either side produces either chat chaos or restoration theater. |
| T4 | **Species power** vs **propose-default initiative** | A weak Kind is branding; a strong Kind without gates is unsafe. The useful Kind lives in the discomfort between. |
| T5 | **Honest incompleteness** vs **user trust** | Users want "Jarvis handled it." Honesty sometimes looks like incompetence. Lying looks like magic until the crash. |
| T6 | **Local competence** vs **cross-app coherence** | Loose coupling fights whole-platform organism myths. Coherence must come from shared mandates and receipts, not per-step central control. |
| T7 | **Heterogeneous projection** vs **one Kind experience** | One identity over many schedulers will always feel uneven. Homogenization is the unconstitutional shortcut. |
| T8 | **Strategist ambition** vs **constitutional ceiling** | Growth pressure will always ask to raise the orchestration ceiling. The ceiling is a law, not a mood. Raising it requires explicit constitution change — not feature creep. |

---

## Closing stance

Cradle can host a Jarvis Kind. Cradle cannot *be* Jarvis's nervous system for every worker's next token.

The multi-year constitution is therefore:

- **Species** names who may care and under what fences.  
- **Control tower** makes mandates, observations, and receipts honest.  
- **Native substrates** keep their clocks.  
- **Humans and Kind** keep strategy.  
- **Gravity** is the permanent adversary.

If a proposal requires Cradle to own native lifecycle, micro-manage workers, or narrate unverified completion as truth — it is not a Jarvis feature. It is a constitutional violation.
)
