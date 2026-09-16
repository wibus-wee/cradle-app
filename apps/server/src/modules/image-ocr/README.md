# Image OCR

`image-ocr` owns local OCR for images attached to Cradle conversations.

- `POST /image-ocr/recognize` accepts existing chat file parts and returns ordered Light OCR text.
- Source images must be `data:image/...;base64,...` values or local `file:` URLs. The service never fetches remote URLs.
- The PP-OCRv6 Small engine is process-local and closed through the server runtime-resource registry.
- The model bundle resolves through `CRADLE_LIGHT_OCR_BUNDLE_PATH` → the managed `{image-ocr, model, ppocrv6-small}` resource → the bundled `@arcships/light-ocr-model-ppocrv6-small` package (absent in packaged desktop builds). Nothing resolving raises `image_ocr_model_not_installed` on first use; managed installs land under `<data>/runtimes/image-ocr/ppocrv6-small/`.
- Chat runtime owns the separate concern of projecting the returned OCR metadata into text-only provider input; this module does not send prompts or persist messages.
