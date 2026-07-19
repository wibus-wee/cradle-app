---
title: 在同一个代码库上同时跑四个 Agent
date: 2026-07-06
cover: /blog/covers/multi-agent.svg
tags: Engineering
author: Cradle Team
description: 喜欢 Claude Code？那就跑四个。Cradle 把每个 agent 编排成并行的工作者——各自有任务、有看板卡片、有实时状态，互不干扰。
---

> Run four agents on the same codebase. At the same time.

单个 agent 已经能写代码了，那瓶颈在哪？在你。你一次只能盯一个会话，等它跑完，再派下一个活。Agent 的吞吐是并发的，人的调度却是串行的。

Cradle 的多 agent 编排就是来拆掉这个瓶颈的。

## 每个 Agent 都是一个并行工作者

在 Cradle 里，每个 agent 都是一个独立的 worker：有自己的任务、自己的看板卡片、自己的实时状态。你可以同时跑四个 Claude Code，或者把不同的活派给不同的运行时——一个表面上，所有 runner 同时推进。

关键是它们不会互相踩到。Cradle 用 worktree 做会话级隔离：每个任务活在自己的工作树里，配合清理策略（最大数量 / 最大磁盘占用）自动回收。并行不再是"开四个终端祈祷不出事"，而是一种被管理的状态。

![会话级隔离：每个 agent 活在自己的 worktree 里，互不触碰对方的文件](/blog/figures/worktree-isolation.svg)

## 编排者的视角

当 worker 变多，你需要的就不是聊天框，而是控制塔。

看板让你一眼看清每个任务在哪一列、卡在哪一步；会话状态（running、waiting、blocked）是统一的语言；任何一个 surface——Chat、Workspace、Diffs、Kanban——都可以撕下来变成独立窗口，放在你顺手的任何位置。

你的角色也随之改变：不再是逐字逐句陪跑的人，而是派活、盯异常、做决策的人。

## 一个表面，多个视角

盯四个 worker 不是盯四个窗口。Cradle 的分屏工作台（基于 Dockview）允许你把会话从侧边栏拖出来，在同一个窗口里摆出多面板布局：左边看 agent A 的执行流，右边审 agent B 的 diff，焦点和布局都随你安排。

还不够？任何一个 surface——Chat、Workspace、Diffs、Kanban、插件界面——都可以撕下来变成独立的 Electron 窗口。主屏看全局看板，副屏盯某一个执行流，这是编排者该有的工位。

## 不止一台机器

并行也不该被一台机器的核数限制住。通过 relay 配对字符串，你可以把远端机器注册进本地控制台：家里的台式机、公司的构建机、云上的常驻实例，都可以成为 worker 的运行环境。网络接入模式（仅局域网 / 公网）和公网 URL 都可以配置。

底层的资源账也算过了：OpenCode 从"每个会话一个进程"改成了全会话共享的服务进程，开机预热一次，所有会话复用；OpenCode 运行时还会按 Workspace 做池化，避免重复启动的开销。并行四倍的 worker，不再是四倍的内存。

## 为什么不是"开四个终端"

因为并行真正的成本不在启动，而在**跟踪**。四个终端给你四倍的输出，也给你四倍的心智负担。Cradle 做的事情，是把"同时发生"翻译成"一眼可读"——状态、进度、隔离、回收，都有统一的表达。

Agent 的并行是廉价的，人的注意力是昂贵的。好的编排，就是把前者榨干，把后者省下来。
