---
title: Chat is for exploration. Work is for finishing.
date: 2026-07-16
cover: /blog/covers/cradle-work.svg
tags: Product
author: Cradle Team
description: Conversations are great for understanding problems, but real work has an objective, an environment, and a delivery. Cradle Work is a new concept built for finishing.
---

> Chat is for exploration. Work is for finishing.

A conversation can help you understand a problem, explore a direction, or change some code. But real work usually lives longer: it has a clear objective, needs its own environment, moves through execution, waiting, review, and revision — and eventually has to become a commit or a pull request.

The shape of a chat can't carry that process. The conversation ends; the work doesn't. The window closes; the job isn't done. That's why we introduced **Cradle Work**.

## Work is not another chat

Cradle Work does not depend on an issue or a kanban item. You can create a Work at any time, describe what you want to accomplish, and choose the right agent, model, and execution environment. Issues and kanban are optional sources of context, not prerequisites.

A Work remembers its objective, working environment, related sessions, current progress, and delivery state. Conversations can pause, continue, or be handed off — without the work itself disappearing.

## A clear path to delivery

`Objective → Isolated execution → Review changes → Local commit → User confirmation → Pull request`

![The delivery path from objective to pull request: the agent executes, the boundaries belong to you](/blog/figures/work-delivery.svg)

The agent works in an isolated environment first. When it finishes, Cradle brings the changes back into a reviewable surface, where you decide whether to revise them, create a local commit, or enter the delivery flow. Remote actions — pushing, opening a PR — only happen after your explicit confirmation.

The most important design in this path is that **every boundary belongs to you**. The agent executes; you decide what "done" means.

## Why it matters

Most AI coding tools spend their energy on starting — generating code faster. But the bottleneck in software work was never starting. It's finishing: reviewing, revising, waiting, delivering.

Work turns that entire stretch into a first-class citizen. It has states (running, waiting, blocked, Draft PR, Ready PR, merged), it has memory, and it has boundaries. You're no longer the person staring at a chat box waiting for a result — you're the person standing at the end of the delivery path, making the call.

This is not a new chat mode. It's a new way to finish work with an agent.

## A workbench, not just a grouping

As Work lands, the Workspace grows from "a way to group sessions" into a real workbench.

You can open a browser on the right to read documentation, inspect deployments, or operate web tools, and pull up Terminal or TUI panels from the bottom. These panels follow the Workspace lifecycle and release their resources when closed.

The workbench has answers for the unhappy paths too. If a project directory moves or a disk becomes temporarily unavailable, Cradle marks the Workspace as missing and lets you relink it to a new location. When a remote Workspace's host goes offline, the interface clearly blocks new actions instead of letting messages fail silently.

Even Cradle's own data directory can move — databases, logs, plugins, and runtime files can all migrate to another disk. Migration goes through a staging copy with file-by-file verification and a health check against the new location; the switch only happens once the new root is confirmed healthy, and the previous directory stays around as a backup.

## Bring past work home

Work is about the future. The Import Center is about the past.

It discovers Claude Code and Codex sessions on your machine or a connected server, reconstructs the projects they belonged to, and presents a recoverable Workspace — you choose which conversations to bring back. Once imported, those histories are no longer JSONL files scattered across provider directories; they become Cradle sessions you can search, browse, continue, and archive.

External data stays read-only throughout: Cradle first creates its own bundle, verifies it by size and SHA-256, and projects chat history from that copy. The original Claude and Codex data directories are never modified.

## Understand what agent work costs

Once an agent finishes whole pieces of work instead of conversations, a new question appears: what did that work cost?

Usage now presents two complementary views: the device-level authoritative totals recorded in the local Claude and Codex archives, and the activity Cradle can attribute directly to particular runs and sessions. Consumption from a primary session and all its subagents aggregates into a complete session tree. Prompt, Completion, Cache, and Reasoning tokens — plus estimated cost — can be inspected by time, model, and session.

Finishing work starts with understanding it — including what it costs.
