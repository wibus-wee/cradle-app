# Attach Chat photos from the iOS camera

- **Date:** 2026-08-31
- **Problem:** Mobile Chat could attach existing photos and files, but capturing something in the moment required leaving Cradle, opening Camera, then returning through the photo library.
- **Motivation:** A direct camera path removes a repetitive detour when a user needs to show physical context, handwritten notes, or a nearby device state to an agent.
- **Product behavior:** The iOS composer menu now offers **Take photo**. Cradle requests camera access only when the action is used, opens the system camera, and adds the captured image to the current draft. Denied access presents an **Open Settings** recovery action. Cancelling the camera preserves the draft without adding an attachment.
- **Implementation summary:** Added an iOS-only camera action using Expo Image Picker's system capture flow and reused the existing image-to-chat attachment path. Added matching camera privacy descriptions to Expo and the tracked iOS app configuration, while explicitly disabling microphone permission because this workflow captures still images only.
- **Files / systems affected:** Mobile Chat composer, Expo iOS permissions, and the native iOS Info.plist.
- **Validation performed:** Targeted Mobile ESLint, Mobile TypeScript typecheck, Expo public-config inspection, Info.plist validation, and diff whitespace validation.
- **Tradeoffs:** Captured photos use the same compressed JPEG-quality setting and in-draft base64 representation as photo-library attachments. This keeps behavior coherent but is not intended for lossless capture.
- **Follow-up ideas:** Add a document-scanning action if camera attachments prove useful for structured paper input.
- **Out of scope:** Video, audio, scanning, crop/edit controls, Android behavior, and custom camera UI.
