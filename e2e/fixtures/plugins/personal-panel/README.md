# E2E Personal Panel

Deterministic fixture for the personal Plugin installation journey. It builds
one versioned Web panel and requests the workspace metadata permission so the
test can verify checksum-bound review and activation.

Run `npm run build` to generate `dist/web.mjs`. The `version.txt` fixture input
accepts `v1` or `v2`; any other value intentionally fails the build.
