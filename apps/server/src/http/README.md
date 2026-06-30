# HTTP

Cross-cutting Elysia HTTP infrastructure for the new explicit server composition path.

## Files

- **actor-context.ts**: server-owned mutation actor resolver for runtime session provenance; rejects profile-only runtime contexts instead of treating profiles as authors.
- **request-id.ts**: request-id hook for the Elysia skeleton and shared header constant.
- **error-mapping.ts**: AppError-to-HTTP JSON mapping for the Elysia skeleton, and records unhandled HTTP failures into the observability module for local diagnostics.
- **openapi.ts**: Elysia OpenAPI plugin setup and compatibility path constants for `/openapi.json` and `/docs`.
- **validation.ts**: shared TypeBox/Elysia validation normalization plus explicit route-profile matching for feature-owned error semantics.
