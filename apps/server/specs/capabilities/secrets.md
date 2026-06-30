# Capability: Secrets

## User / System Goal

- 系统需要提供 server-owned 的加密 secret 存储，不把 secret 明文暴露给客户端。
- secret schema 必须是泛化的 `kind`，而不是把 secret 语义绑死到 provider taxonomy。
- API 只返回 masked metadata；真实 secret 只在 server 内部读取给 provider/runtime 使用。

## Current Behavior Evidence

- 旧 agent runtime 使用 credential vault 存储 API key，并返回 masked metadata。
- server 侧通过 `CRADLE_CREDENTIAL_SECRET` 负责 AES-256-GCM 加密。
- profile 与 provider metadata 都通过 `credentialRef` / `secretRef` 间接引用 secret。

## Target API

- `GET /secrets` → 列出 masked secret metadata
- `POST /secrets` → 保存 secret
- `DELETE /secrets/:id` → 删除 secret

## Target Module Design

- `SecretsModule`
  - `SecretsController`: HTTP 参数校验与错误边界
  - `SecretsService`: 配置检查与错误映射
  - `SecretsStore`: `agent_credentials` 读写、masked metadata 投影
  - `SecretCipher`: 基于 `CRADLE_CREDENTIAL_SECRET` 的加解密边界

## Test Plan

- 保存后列表只返回 maskedSecret，不返回明文。
- 未配置 `CRADLE_CREDENTIAL_SECRET` 时返回结构化错误。
- `kind` 接受泛化字符串；缺失字段返回结构化错误。
