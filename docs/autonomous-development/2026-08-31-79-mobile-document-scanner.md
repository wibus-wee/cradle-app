# Scan multi-page documents into Chat on iOS

- **Date:** 2026-08-31
- **Problem:** A normal camera attachment is awkward for paper documents because every page needs manual framing and perspective correction.
- **Motivation:** Cradle users should be able to give an agent clean physical-document context without leaving the conversation or installing a separate scanning app.
- **Product behavior:** The iOS Chat composer now offers **Scan document**. Apple's system scanner detects page edges, corrects perspective, supports a multi-page capture session, and lets the user review the result. Saving adds each scanned page to the current draft in order; cancelling leaves the draft unchanged.
- **Implementation summary:** Added a focused Expo native module around VisionKit's `VNDocumentCameraViewController`. The bridge returns the scanner's corrected pages as JPEG data, and the existing composer attachment workflow owns draft persistence, removal, and sending. Camera authorization and Settings recovery are shared with **Take photo**.
- **Files / systems affected:** Mobile Chat composer and the iOS native-module layer.
- **Validation performed:** Targeted Mobile ESLint, Mobile TypeScript typecheck, Expo module discovery inspection, an unsigned Xcode 27 iOS 26 Simulator build, and diff whitespace validation.
- **Tradeoffs:** Each page remains an individual image attachment so users can remove pages independently and the current chat protocol needs no new file format. Large scans therefore consume more draft memory than a single compressed PDF.
- **Follow-up ideas:** Offer optional on-device text recognition or PDF assembly if users need searchable document workflows.
- **Out of scope:** OCR, PDF generation, Android, a custom scanner UI, and editing outside VisionKit's review screen.
