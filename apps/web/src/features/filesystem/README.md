<!-- Once this directory changes, update this README.md -->

# features/filesystem

Filesystem selection feature for browser fallback directory picking. Electron uses the native open-directory dialog; browser mode uses the custom `DirectoryBrowserDialog`.

## Files

- **directory-browser-dialog.tsx**: Custom browser fallback directory picker with favorites, breadcrumb/path editing, directory-only selection, visible descriptions, and keyboard selection for the directory list.
- **directory-browser-dialog.test.ts**: Unit coverage for directory list keyboard selection bounds.
- **directory-picker-provider.tsx**: Context provider that chooses Electron native directory selection when available and falls back to `DirectoryBrowserDialog` in browser mode.
