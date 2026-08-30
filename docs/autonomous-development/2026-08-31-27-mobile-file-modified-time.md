# Show file freshness in mobile previews

- **Date:** 2026-08-31
- **Problem:** File previews showed size and MIME type but hid the server-provided modification time, making it hard to tell whether content was current.
- **Motivation:** Freshness is essential context when inspecting generated output, logs, notes, or recently changed source from a phone.
- **Product behavior:** The preview metadata now includes a localized “Modified” date and time for supported and unsupported files.
- **Implementation:** The fixture-driven View formats the existing millisecond timestamp with the device locale. No additional request or frontend data projection is introduced.
- **Systems affected:** Mobile file preview and mobile product documentation.
- **Validation:** Mobile TypeScript typecheck, scoped ESLint, and diff validation.
- **Tradeoffs:** This reports filesystem modification time, not Git commit time, and follows the device timezone.
- **Follow-up ideas:** Expose commit history separately if mobile review workflows need authored or committed timestamps.
