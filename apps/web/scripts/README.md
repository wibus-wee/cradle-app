<!-- Once this directory changes, update this README.md -->

# scripts

`apps/web/scripts` owns package-local development and CI workflow commands. Scripts in this directory are invoked through `pnpm --filter @cradle/web ...` so their working directory is the web package root.

## Directories

- **i18n-workflow/**: Translation resource generation, validation, report creation, and cleanup commands for the Cradle web i18n architecture.
