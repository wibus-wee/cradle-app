#!/bin/bash
# Generate PDFs from demo HTML files using headless Chrome.
#
# Copy this file to scripts/generate-pdfs.sh in the target design-system package.
# Run with: bash scripts/generate-pdfs.sh  (or: pnpm demo:pdf)
#
# CUSTOMIZE: Edit the DEMOS array below to match your project's demo file names.

set -e

# ---------------------------------------------------------------------------
# CUSTOMIZE: List your demo base names here (without language suffix or ext).
# Each entry produces {name}.pdf and {name}.en.pdf from {name}.html and
# {name}.en.html in the DEMOS_DIR directory.
# ---------------------------------------------------------------------------
DEMOS=(
  "demo-post"
  "demo-resume"
  "demo-report"
)
# ---------------------------------------------------------------------------

# Locate Chrome: macOS path → standard Linux paths.
if [ -f "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
elif command -v google-chrome >/dev/null 2>&1; then
  CHROME="google-chrome"
elif command -v chromium >/dev/null 2>&1; then
  CHROME="chromium"
else
  echo "Chrome not found. Install Google Chrome or set CHROME env var."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMOS_DIR="$(cd "$SCRIPT_DIR/../showcase/public/demos" && pwd)"

generate() {
  local name="$1"
  local html="$DEMOS_DIR/$name.html"
  local pdf="$DEMOS_DIR/$name.pdf"

  if [ ! -f "$html" ]; then
    echo "  ✗ source not found: $html"
    return 1
  fi

  printf "  → %-26s" "$name.pdf"

  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --no-pdf-header-footer \
    --hide-scrollbars \
    --no-sandbox \
    --print-to-pdf="$pdf" \
    "file://$html" 2>/dev/null

  if [ -f "$pdf" ]; then
    local size
    size=$(du -h "$pdf" | awk '{print $1}')
    printf "ok (%s)\n" "$size"
  else
    printf "failed\n"
    return 1
  fi
}

echo "Generating PDFs from $DEMOS_DIR"
for demo in "${DEMOS[@]}"; do
  generate "$demo"
  generate "$demo.en"
done
echo "Done."
