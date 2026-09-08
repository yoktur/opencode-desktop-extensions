# Changelog

## 0.2.0

### Added

- An isolated OCDX channel with its own app identity, Desktop and Chromium profiles, server registration, credentials, configuration, cache, and database. OpenCode Beta and Stable can remain open alongside OCDX.
- `desktop.sidePanel.add()` for extension tabs beside native browser, file, and review tabs, with reactive badges, visibility state, keyboard navigation, and lifecycle cleanup.
- `Cell.effect()` to run a subscriber immediately and on subsequent changes.

### Changed

- Updated compatibility to OpenCode Desktop beta 19278 and pinned the SDK's UI/client peers to the tested beta 19271 packages.
- Pane size and visibility use cells. Obsolete overloads and tab-avatar access were removed.
- The server SDK now uses `@opencode-ai/client` and OCDX's main-process connection bridge instead of the removed `window.api` preload interface.
- Settings contributions support Desktop's full-page settings view.
- Archive discovery, validation, and caching now run in the bootstrap. OCDX bundles its own ZIP reader.
- The source OpenCode installation owns updates and protocol registration; OCDX does not modify either.

### Verification

- Type checking, a channel-isolation test, and four browser tests passed.
- Live Windows checks covered Desktop beta 19278, native browser/tab switching, settings, and light/dark/RTL layouts.

Existing OpenCode sessions, settings, and sign-ins are not imported into the new OCDX channel automatically.
