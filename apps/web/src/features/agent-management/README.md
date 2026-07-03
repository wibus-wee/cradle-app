<!-- Once this directory changes, update this README.md -->

# Features/Agent Management

Agent Management 负责 Provider 与 Agent Identity 的统一设置界面。
Provider 配置决定模型与运行时来源，Agent Identity 决定 persona、system prompt 与专属 Skills 工作区。
Agent 专属 Skills 基于文件系统表达，存储在 `~/.cradle/agents/{agentId}/skills/`。
Agent Management 的用户可见文案由 `agentManagement` i18n namespace 负责，默认英文源位于 `src/locales/default/agent-management.ts`。Provider-backed Agent 的 thinking effort 支持 `low`、`medium`、`high`、`xhigh`。
Session title generation is no longer configured from provider details. Chat settings own the provider/model/thinking-effort preference; provider detail panels only edit provider connection and model inventory state.

## Files

- **agent-detail.tsx**: Agent 详情页，提供内联编辑 identity、provider/model/thinking 统一选择器、system prompt、Claude Agent SDK haiku / sonnet / opus alias、CLI TUI env 输入反馈与 agent-private Skills 管理；provider/model picker 的数据源统一为兼容当前 runtime 的全部 `provider_targets`，包括 disabled external provider；选择 disabled provider 时保留配置能力并显示不可启动原因；alias 清空后直接映射主模型并打开当前 provider target 的模型列表，并确保 provider 切换时默认模型与 thinking 能力会同步到 state
- **agent-detail.test.ts**: Agent detail 的纯函数契约测试，覆盖 CLI TUI env 解析反馈、Claude Agent SDK alias config 序列化与创建按钮禁用原因
- **agent-batch-configuration.ts**: Settings Agents 多选批量配置 helper，生成 provider/model/thinking 批量更新 patch，并基于 runtime catalog descriptor 跳过非 provider-backed Agent
- **agent-batch-configuration.test.ts**: Agent 批量 provider 配置的纯函数回归测试，覆盖 identity/config 保留与 descriptor-driven 跳过语义
- **agent-list.tsx**: Agent 列表，显示所有 Agent 卡片；点击行导航到 agent-detail；支持显式 Import 操作，将本机 Claude/Codex allowlisted 配置导入为去重后的 Agent；如果本机配置指向 CC Switch 本地代理，则导入仍创建 Local Claude / Local Codex Agent，但 provider/model/alias 配置来自 CC Switch 当前 upstream provider；支持 Settings overlay 的一次性 Agent focus target，用于从 Smart Mention 等外部入口直接定位对应 Agent；列表行现在展示绑定的 provider target 名称，避免多个同类 provider 时无法分辨归属；支持多选批量启停、删除、provider/model/thinking 配置以及列表内 `Cmd/Ctrl+A`、`Escape`、`Delete/Backspace` 快捷键和 `Shift+click` 连续区间选择；draft row 使用即时布局挂载，避免列表高度动画；Settings Agents 首屏在 agents 与 provider targets 两条 server-backed query 成功后记录 performance gate
- **agent-runtime-settings.tsx**: 统一 Agent Profile 管理界面；Provider 列表展示 Cradle-owned manual provider profiles 与 external runtime target records，由 TanStack Query owner 驱动，壳层只保留选中/草稿/过滤 UI 状态；manual provider 支持单项编辑 / 删除 / 启停、多选批量操作以及列表内 `Cmd/Ctrl+A`、`Escape`、`Delete/Backspace` 快捷键和 `Shift+click` 连续区间选择，external record 打开 external record 详情；draft provider row 使用即时布局挂载，避免列表高度动画；新增 / 导入 manual provider 后立即触发 provider model cache warm，不等用户打开模型面板；Settings Providers 首屏在 profiles 与 external source/record queries 成功后记录 performance gate
- **agent-status-dot.tsx**: Agent Management 列表行复用的启用状态圆点，避免 Agent 列表依赖 Provider 设置页组件
- **custom-models-editor.tsx**: Provider 自定义模型编辑器，支持手动添加模型、models.dev 匹配补全与可访问的模型操作按钮
- **custom-models-editor.test.tsx**: Custom models editor 的交互回归测试，覆盖 icon-only action label 与手动模型添加 fallback
- **claude-model-matrix-editor.tsx**: Claude Agent haiku / sonnet / opus model matrix 的纯 UI editor，由 manual provider、external provider 与 Chat Session 弹窗复用；不拥有持久化语义，只通过调用方传入的 aliases 与 callbacks 工作。
- **external-provider-record-detail-panel.tsx**: CC-Switch external provider record 详情面板，只展示用户可识别的来源、登录状态、应用、端点与默认模型；完全没有本地模型缓存时主动发起一次 Fetch Models，并通过 provider-target API 维护模型可见性、custom models 与 Cradle-owned Claude model matrix provider default。
- **index.ts**: Agent Management 功能模块的 barrel export
- **import-provider-dialog.tsx**: 手动 Import Provider 弹窗，调用配置片段 parser 自动识别 API key 与 endpoint，并以每个 provider 自己的解码后 apiKey 创建 credential，避免展示解码值但保存编码值
- **import-provider-parser.ts**: Provider 配置片段解析器，从 export 环境变量或自由文本中提取 URL 与 key，使用浏览器原生 Base64 解码后输出 provider 候选
- **provider-list-groups.ts**: Provider sidebar 的纯排序 / 分组 helper，为 Cradle-owned manual provider profiles 与 external records 生成分组，把 enabled/active provider 排在 disabled/inactive provider 前，并对空 external query inputs 保持安全默认值
- **provider-list-groups.test.ts**: Provider sidebar 分组排序回归测试，覆盖 enabled-first 与 manual profile 分组语义
- **provider-settings-utils.ts**: Provider settings 的共享常量与纯函数，承载 provider kind label、draft provider 类型、profile id 构造与 preset 匹配逻辑
- **provider-model-cache.ts**: Manual provider 创建后的模型缓存预热 helper，封装 `/providers/models` 请求体并保持 provider cache 写入归属在 Cradle provider catalog。
- **provider-target-model-settings.ts**: Provider-target 模型偏好客户端 helper，封装 model settings 读取、model visibility 保存、custom models 保存与 `connectionConfigJson.claudeAgent.modelAliases` 保存，供 manual profile、external runtime target 与 Chat Session 的 provider-default 写入共用
- **settings-multi-selection.ts**: Agent Management settings 列表的共享 selection helper，封装 visible selection merge / remove、selected id 收敛与 prune 逻辑，供 Providers 与 Agents 两个列表复用
- **settings-multi-selection.test.ts**: Shared selection helper 的回归测试，覆盖 toggle、prune、visible merge / remove 与 selected-id 收敛行为
- **settings-selection-shortcuts.ts**: Agent Management settings 列表的局部快捷键 helper，封装可见项全选、清空选择、批量删除与输入框 / overlay 跳过语义
- **settings-selection-shortcuts.test.ts**: Settings selection shortcuts 的回归测试，覆盖 editable target 跳过、overlay 跳过、全选、清空与删除快捷键门禁
- **models-panel.tsx**: Provider 模型可见性面板，复用 Agent Runtime 的模型可见性语义，显示 models.dev exact / fuzzy / manual / alias / unmatched 状态，并支持按 Available Model 行保存全局 registry 映射或手工 registry 条目；完全没有本地模型缓存时由 manual profile detail 或 CC-Switch external record detail 主动发起一次 Fetch Models
- **profile-detail-panel.tsx**: Manual provider 详情面板，继续以 RHF 作为表单 owner，并把模型缓存读取 / 手动 inventory refresh / registry 映射 / 健康检查 / Claude model matrix provider default / 自动保存 / 删除确认等瞬时 UI 状态收口到局部 reducer，避免细碎 `useState` 级联；模型 registry 映射通过全局 model registry API 保存，custom models 通过 provider-target API 保存，以便和 external runtime target 使用同一语义
