<!-- Once this directory changes, update this README.md -->

# Components/Editor

Shared Tiptap-based Markdown editor with WYSIWYG editing, slash commands, Smart Mention references, and syntax highlighting.
Extracted from workspace-detail feature for reuse across kanban issue descriptions and other features.
Extensions: StarterKit, HeadingWithId, Markdown, SlashCommand, SmartMention, ShikiCodeBlock, BubbleMenu.

## Files

- **index.ts**: Barrel export for the editor module
- **markdown-editor.tsx**: Main `MarkdownEditor` component (content/documentId/onSave/readonly/placeholder/className/smartMentions/assetImages) with guarded external-content synchronization so background refreshes do not overwrite local edits; Cradle asset image uploads insert canonical Markdown URLs and use Tiptap image resize for persisted display dimensions.
- **asset-image-extension.ts**: Cradle-aware Tiptap Image extension that renders `cradle-asset://...` Markdown URLs through server content URLs, parses and writes display dimensions on the image reference URL, and keeps resize commits serializable through Markdown.
- **markdown-editor.test.tsx**: Regression tests for editor extension composition
- **editor-bubble-menu.tsx**: Floating toolbar for inline formatting (bold/italic/strike/code/link) with named toolbar actions and decorative icons
- **editor-bubble-menu.test.tsx**: Regression tests for BubbleMenu toolbar accessible names, decorative icons, and formatting/link callback wiring
- **slash-command.tsx**: Tiptap extension for `/` command menu
- **slash-command-list.tsx**: Dropdown UI for slash command suggestions
- **smart-mention.tsx**: Tiptap inline atom node and `@` suggestion menu for feature-owned resource references, with hover preview and `cradle://mention` Markdown serialization.
- **smart-mention-list.tsx**: Grouped, keyboard-navigable dropdown UI for Smart Mention suggestions.
- **smart-mention-utils.ts**: Smart Mention attribute, URL, parser, and readable Markdown label helpers.
- **smart-mention-utils.test.ts**: Regression coverage for Smart Mention href roundtrip and readable Markdown labels.
- **heading-with-id.ts**: Heading extension with auto-slugified anchor IDs
- **shiki-code-block.tsx**: Code block extension with Shiki syntax highlighting
- **shiki-highlighter.ts**: Lazy Shiki highlighter loader，延后加载 themes、languages 和 tokenizer，避免 Markdown editor 入口同步拉取完整 Shiki runtime
- **code-block-view.tsx**: React NodeView for code blocks with language selector
