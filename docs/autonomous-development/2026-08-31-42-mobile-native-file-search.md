# Search workspace files from the native header

- **Date:** 2026-08-31
- **Problem:** Workspace Files kept a custom search input inside the content area on iOS and Android, reducing visible list space and behaving differently from the other searchable Mobile collections.
- **Motivation:** File search is navigation rather than page content. Moving it into the system header gives users familiar activation, cancellation, clearing, keyboard, and scroll-collapse behavior while keeping directory rows visible.
- **Product behavior:** Native Mobile builds now search workspace files from a stacked navigation SearchBar that hides while scrolling and remains mounted during loading or error states. Opening a file hides search for the preview; returning restores the prior query and results. Web retains the inline search field.
- **Implementation:** The file Container owns the native `Stack.SearchBar` beside its existing search and navigation state. The fixture-driven View gained a `showsInlineSearch` presentation prop, leaving query selection, directory navigation, file preview, and API contracts unchanged.
- **Systems affected:** Mobile Workspace Files Container and View.
- **Validation:** Mobile TypeScript and ESLint passed; Expo production exports passed for iOS, Android, and Web.
- **Tradeoffs:** Native and Web use different search placement but one state and one server query flow. Search is hidden during file preview to keep the header focused on the selected file.
- **Follow-up ideas:** Dogfood deep directory navigation and consider a native breadcrumb menu only if repeated parent traversal remains cumbersome.
- **Out of scope:** Search ranking, server API changes, file content search, preview rendering, directory breadcrumbs, and file operations.
