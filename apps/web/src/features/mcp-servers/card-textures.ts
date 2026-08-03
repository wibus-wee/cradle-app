/**
 * Shared card texture treatment for the MCP server surfaces.
 * Relies on the --border token so it adapts to dark mode.
 */
export const cardDotTexture
  = 'pointer-events-none absolute inset-x-0 top-0 h-16 [background-image:radial-gradient(circle,var(--border)_1px,transparent_1px)] [background-size:14px_14px] [mask-image:linear-gradient(to_bottom,black,transparent)]'
