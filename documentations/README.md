# Cradle 文档站

这个目录是 Cradle 的 Fumadocs 文档站。它承载用户文档、管理员文档、开发者文档、运维排障页和 LLM 友好的 Markdown 输出。

## 本地开发

在本目录运行：

```bash
pnpm install
pnpm dev
```

默认开发地址是 `http://localhost:3000`。文档入口是 `/docs`。

## 验证

提交文档改动前至少运行：

```bash
pnpm types:check
pnpm build
```

`types:check` 会执行 `fumadocs-mdx`、`next typegen` 和 `tsc --noEmit`。它用于捕获 frontmatter、MDX、Next route types 和 TypeScript 问题。

## 内容结构

文档内容位于 `content/docs/`。每个目录使用 `meta.json` 固定侧栏标题、图标和页面顺序。页面文件使用 English kebab-case slug，正文使用简体中文。

核心约定：

- 每个 `.mdx` 页面必须包含 `title` 和 `description` frontmatter。
- 每个多页目录必须有 `meta.json`。
- 页面正文先说明读者能完成什么，再进入配置、使用、边界和排障。
- 代码块、命令、路径、API 名、frontmatter key 和标识符保持 English。
- 不要保留 scaffold 或测试页面；它们会进入 sidebar、search、`/llms.txt` 和 `/llms-full.txt`。

## 站点实现

主要文件：

- `source.config.ts` 定义 Fumadocs MDX collection。
- `lib/source.ts` 把 collection 加载为 Fumadocs page tree。
- `app/docs/[[...slug]]/page.tsx` 渲染文档页面。
- `app/plugin-marketplace/page.tsx` 渲染独立 Plugin Marketplace 页面，不使用 docs sidebar / toc layout。
- `app/api/search/route.ts` 提供搜索。
- `app/api/plugin-marketplace/route.ts` 提供 Plugin Marketplace registry JSON。
- `app/llms.txt/route.ts` 和 `app/llms-full.txt/route.ts` 提供 LLM 文本入口。
- `app/llms.mdx/docs/[[...slug]]/route.ts` 提供单页 Markdown。
- `lib/plugin-marketplace.ts` 是 Marketplace 页面和 registry API 的静态数据源。

## 写作准则

Cradle 文档采用任务导向结构：短段落、明确读者、清晰产品语气、真实边界和可验证步骤。用户页按工作域组织，开发者页按 owner、namespace、lifecycle、validation 和 boundary 组织。
