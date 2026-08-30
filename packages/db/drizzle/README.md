<!-- Once this directory changes, update this README.md -->

# Drizzle

这里存放 SQLite 的 Drizzle migration 产物，是运行时真正执行的 schema 历史。
SQL 文件负责重放数据库结构，`meta/` 负责 journal 与 snapshot，三者必须成套维护。
当前历史已在首次个人/公开使用前重新基线化。后续一旦有外部或长期本地数据需要保留，就只能追加 migration，不要重写历史。

## Files

- **0000_initial_release_baseline.sql**: 当前 schema 的干净 baseline migration。
- **0001_cradle_diffs.sql**: Cradle Diffs / `diff-review` lifecycle schema.
- **0002_diff_review_guides.sql**: Guided review generation persistence for `diff-review` revisions.
- **0010_drop_diff_review_rule_based_commit_plans.sql**: Removes legacy rule-based Cradle Diffs commit plans.
- **0011_remote_hosts.sql**: Remote runtime host registry and chat-session-to-remote-agent link tables.
- **0015_diff_review_agent_fix_target_revision.sql**: Adds revision ownership to diff-review agent fixes so stale planning runs do not apply to later working-tree revisions.
- **0020_repair_relay_host_enrollments.sql**: Idempotently creates relay host enrollment tables for databases that skipped 0019 because its journal timestamp predates 0018.
- **0029_unknown_mentallo.sql**: Adds the reusable durable Background Job lifecycle table and links generated Diff Review commit plans to their originating agent fix for idempotent projection.
- **0042_sudden_pepper_potts.sql**: Terminalizes inherited streaming Chat Runtime rows as `response.interrupted` before installing the one-streaming-run-per-session partial unique index; startup recovery appends missing terminal facts without deleting event history.
- **0053_drop_diff_review_guides_and_commit_plans.sql**: Drops Diff Review guide + commit-plan tables; those flows moved to Chat prompt intents / transcript directives.
- **0054_provider_targets_provider_id.sql**: Nullable `provider_id` on `provider_targets` for explicit Provider identity (never inferred from endpoint URL).
- **0062_fabric_session_projection_ownership.sql**: Records whether a Fabric Session projection created its remote authority or discovered an existing remote Session, so local deletion follows the correct ownership rule.
- **0063_fabric_work_projection_ownership.sql**: Maps controller-local Work projections to their authoritative Fabric Node Work and workspace IDs; worktree lifecycle remains Node-owned.
- **0066_remote_session_activity_clock.sql**: Caches remote user and assistant message clocks on node Session links so controller-side pagination and sidebar ordering retain the authoritative Session activity order.
- **0068_drop_acp_auth_secret_refs.sql**: Removes the retired ACP auth credential-reference persistence while keeping auth method selection and remote transport header Secret references intact. The same generated migration also removes the orphaned Work acceptance-criteria column left in migration history after the delivery control plane was reverted.
- **meta/**: Drizzle journal 与 schema snapshot，用于 tooling 和 migration 顺序管理；该目录必须保持 JSON-only，否则 `drizzle-kit generate` 会解析失败

## Regenerate Before Release Boundary

如果还没有任何需要保留的用户数据，可以删除 `*.sql` 和 `meta/` 后重新生成 baseline。
一旦 release 边界成立，就不要再做这件事；所有 schema 变化都必须追加新的 migration。
