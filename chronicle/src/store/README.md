# Chronicle Store

`store/` 现在负责 Rust runtime 的本地 evidence outbox，不是 Chronicle memory store。

- `outbox/events.ndjson`: append-only evidence queue。每一行是一条 `ChronicleOutboxEvent`，包含 `id`、`kind`、`createdAt` 和 Server ingest body-shaped `payload`。

Outbox 不替代 artifact 文件，也不是 canonical product state。Server/DB 拥有 Chronicle memory、activity、knowledge、search 和 privacy projection；Rust outbox 只保证本地 capture/audio/model evidence 在 Server 暂不可用时不会丢。
