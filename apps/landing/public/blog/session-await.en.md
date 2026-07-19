---
title: Session Await: agents that know how to wait
date: 2026-07-10
cover: /blog/covers/session-await.svg
tags: Engineering
author: Cradle Team
description: Your agent pushed a PR and it's waiting for CI — but you don't have to wait with it. Session Await suspends a session on a condition and resumes it the moment the condition fires.
---

> Your agent pushed a PR. It's waiting for CI. You don't have to be.

There's an invisible kind of waste in software work: waiting. Waiting for CI to finish, for a review to land, for a file to change. The waiting itself costs no compute — but it holds your attention hostage. You can't walk away, because "it might be done any minute."

Session Await is our way of giving that attention back.

## Turn waiting into a condition

In Cradle, you can attach a condition to a session: CI passing, a review approving, a file changing. Once the condition is set, Cradle suspends the session — not ending it, just putting it to sleep.

When the condition fires, the agent picks up exactly where it left off. The context is still there. The objective is still there. The progress is still there.

![The Session Await lifecycle: run, set a condition, suspend, resume when the condition fires](/blog/figures/await-lifecycle.svg)

## Close your laptop. The work continues.

It means you can genuinely leave. Close the laptop, go to the meeting, go to sleep. When the condition is met, Cradle resumes, reports, and moves on — no babysitting required.

The point isn't automation for its own sake. It's the **decoupling of attention**. An agent's working rhythm is event-driven; a human's is not. Session Await lets the two rhythms run independently: the agent waits for its events, and you live your life.

## How it works

An await condition is essentially a subscription to an external event: CI status polling, a PR review changing, a filesystem update. When a session suspends, Cradle preserves the full execution context — the objective, the conversation context, queued instructions not yet sent, and file changes already produced. Resuming isn't "starting a new chat"; the run continues from its checkpoint.

Reliability comes from the streaming architecture underneath. Incremental synchronization uses monotonic cursors, so reconnects neither duplicate nor lose output. A running session accepts follow-ups, and queued instructions can be edited or rearranged — including the intent that accumulated while it was suspended.

## Waiting doesn't stand alone

Await is one facet of a lifecycle shared with Cradle's other mechanisms: Turn Checkpoint lets a long task resume from any turn; Environment Handoff lets work continue on a different machine; and durable background jobs mean long processes like Diff Review and Commit Plan still know where they stopped after an app restart — and which surface should receive their result.

All of these share one conviction: agent work is long-lived, and the runtime must outlive any single session.

## Waiting is part of the work

We've come to believe that a good agent runtime isn't one that makes the agent run faster — it's one that lets the agent **stop gracefully when it should**. Execute, wait, resume, report: that's a full lifecycle, and waiting is its most underrated stage.
