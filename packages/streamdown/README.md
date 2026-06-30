<!-- Once this directory changes, update this README.md -->

# Packages/Streamdown

Streamdown is Cradle's Markdown rendering package for streaming chat output. It owns Markdown AST typing, static rendering, and React stream rendering primitives used by the web app.

## Files

- **package.json**: package metadata, peer dependencies, and Markdown rendering dependencies including `@types/mdast` for typed Markdown AST integration.
- **src/index.ts**: public package exports.
- **src/static-render.tsx**: static Markdown rendering entry point.
- **src/streamdown-render.tsx**: React renderer adapter for streamed Markdown content.
- **src/streamdown.tsx**: main Streamdown component implementation.
- **src/types.ts**: shared Streamdown TypeScript types.
