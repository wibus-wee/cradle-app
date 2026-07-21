# Kimi Runtime Gaps

This file records native Kimi Web capabilities that the current Cradle Chat Runtime contract cannot represent without changing the contract. They are deliberately not exposed as misleading provider behavior.

## Session deletion

Kimi Web exposes `POST /api/v1/sessions/{session_id}:archive`, but no irreversible session-delete operation. Cradle's `deleteProviderThread` contract promises deletion, so the Kimi provider does not implement it. Archive remains available in Kimi itself and is returned by provider-thread listing when requested.

## Background task control

Kimi exposes typed task list, inspect, and cancel operations (`cancelTask`). Cradle projects task state into the `progress` UI slot, but has no session-scoped task-control contract or UI action owner. The provider therefore does not expose cancel as a terminal or turn cancellation surrogate.

## Target-scoped model inventory

Kimi's model catalog is produced by a particular Kimi host and its provider configuration. Cradle's `ListRuntimeModelsInput` contains only an optional workspace path, not a provider target/profile. Returning a global catalog would cross credentials and targets, so Kimi currently returns no runtime-global model catalog. The active session model remains supported and visible through the model UI slot.

## Terminal transcript streaming

Kimi exposes terminal metadata and close operations, which Cradle supports through its background-terminal contract. It does not expose a typed terminal-output stream in the current Chat Runtime contract. Tool progress is streamed through the normal turn event mapper, but a standalone terminal transcript surface needs a new contract owner before it can be added.
