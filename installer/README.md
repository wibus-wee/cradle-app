# Cradle Installer

This directory contains the free macOS distribution path for Cradle.

macOS does not support DMG autorun, and an unsigned SwiftUI installer app is itself subject to Gatekeeper before it can run any cleanup. The practical no-Developer-ID path is a double-clickable `.command` script.

## Files

- `Install Cradle.command` installs Cradle from a hidden bundled payload, or downloads the latest GitHub release when no payload is bundled.
- `build-dmg.sh` creates a DMG with `Install Cradle.command` visible, a custom Finder icon from `.github/Cradle.png`, and `.payload/Cradle.app` hidden.

## Build A Bundled DMG

Build the desktop app first, then pass the generated app, release DMG, or release zip:

```sh
installer/build-dmg.sh --app apps/desktop/release/mac-arm64/Cradle.app
```

or:

```sh
installer/build-dmg.sh --app apps/desktop/release/Cradle-0.0.1-arm64.dmg
```

The output defaults to:

```text
installer/dist/Cradle-Installer.dmg
```

The command icon defaults to `.github/Cradle.png`. Override it with:

```sh
installer/build-dmg.sh --app apps/desktop/release/mac-arm64/Cradle.app --icon path/to/Icon.png
```

When users open that DMG, they double-click `Install Cradle.command`. The command copies the hidden `.payload/Cradle.app` to `/Applications/Cradle.app`, runs `xattr -cr`, fixes ownership when admin permission is needed, and opens Cradle.

## Ship The Command Alone

You can also distribute `Install Cradle.command` without a payload. In that mode it downloads the best macOS `.dmg` or `.zip` asset from:

```text
https://github.com/wibus-wee/Cradle/releases/latest
```

Useful overrides:

```sh
CRADLE_GITHUB_REPO=owner/repo ./installer/Install\ Cradle.command
CRADLE_DOWNLOAD_URL=https://example.com/Cradle.dmg ./installer/Install\ Cradle.command
CRADLE_APP_PATH=/path/to/Cradle.app ./installer/Install\ Cradle.command
CRADLE_INSTALL_DIR=/Applications ./installer/Install\ Cradle.command
CRADLE_INSTALLER_NO_PAUSE=1 ./installer/Install\ Cradle.command
CRADLE_INSTALLER_SKIP_STOP=1 CRADLE_INSTALLER_SKIP_OPEN=1 ./installer/Install\ Cradle.command
```

## Notes

- Keep `Install Cradle.command` executable. `build-dmg.sh` sets this automatically inside the DMG.
- The scripts use only macOS built-in tools: `bash`, `curl`, `ditto`, `hdiutil`, `osascript`, `xattr`, and `sudo`.
- A DMG can hide the payload, but it cannot run the installer automatically when opened.
