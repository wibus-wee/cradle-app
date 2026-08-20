# HTTP

Cross-cutting Elysia infrastructure for authentication, request identity, error handling, validation, and API documentation.

| Area | Location | Responsibility |
| --- | --- | --- |
| Authentication | [`auth.ts`](./auth.ts), [`browser-auth-session.ts`](./browser-auth-session.ts), [`single-use-ticket.ts`](./single-use-ticket.ts) | Validates Server credentials and owns short-lived browser sessions plus audience-bound, single-use WebSocket and resource tickets. |
| Actor context | [`actor-context.ts`](./actor-context.ts) | Resolves server-owned mutation provenance and rejects profile-only runtime contexts as authors. |
| Request identity | [`request-id.ts`](./request-id.ts) | Assigns request IDs and exports the shared header contract. |
| Error mapping | [`error-mapping.ts`](./error-mapping.ts) | Maps `AppError` values to HTTP responses and records unhandled failures through observability. |
| OpenAPI | [`openapi.ts`](./openapi.ts) | Configures Elysia OpenAPI output and the `/openapi.json` and `/docs` paths. |
| Validation | [`validation.ts`](./validation.ts) | Normalizes TypeBox/Elysia validation and matches feature-owned route profiles. |

Browser resource tickets authorize one GET for one exact pathname. They support browser-managed requests such as dynamic module imports that cannot attach an Authorization header; they must not replace normal authenticated API requests. Shared plugin dependency wrappers under `/api/plugins/-/deps/` are public code resources so every plugin resolves the same stable browser module URL; they expose no Server or user data.
