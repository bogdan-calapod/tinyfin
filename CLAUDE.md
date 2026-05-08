# CLAUDE.md - Project Context for TinyFin

## Project Overview

TinyFin is a kid-friendly Jellyfin web client (PWA) designed for young children who cannot read. The UI is icon-only (no text labels), inspired by YouTube Kids. It supports both tablet (touch) and Android TV (D-pad navigation).

**Stack:** Vanilla HTML/CSS/JS — no frameworks, no build tools, no npm dependencies (except dev tooling). Single HTML file, inline SVGs for all icons, no external icon library.

## Architecture

- `index.html` — All markup, nav bar with inline SVG icons
- `css/styles.css` — All styles
- `js/app.js` — Main app class (TinyFinApp), handles UI, navigation, video playback
- `js/jellyfin-api.js` — Jellyfin API wrapper (JellyfinAPI class), global `jellyfinAPI` instance
- `js/download-manager.js` — Offline download support, global `downloadManager` instance
- `js/fullscreen.js` — Fullscreen management
- `js/tv-navigation.js` — D-pad/remote navigation for Android TV
- `sw.js` — Service worker for PWA offline caching
- `android/` — Minimal Android TV WebView wrapper app (Kotlin)

## Jellyfin Libraries

The user's Jellyfin server has these libraries:
- **Collections** 
- **Movies** — content type: Movie
- **Music**
- **Shows** — content type: Episode
- **Stories** — content type: Home Videos (Video), displayed via the Stories nav button (book icon)
- **YouTube** — content type: Home Videos (Video), displayed via the Videos nav button (play icon)
- **Music Noah** — displayed via the Music Noah nav button (music note icon)

## Key Technical Decisions

### Jellyfin API: Library-specific queries
- `/Library/VirtualFolders` requires **admin privileges** and returns HTTP 403 for regular users. Do NOT use this endpoint.
- `/Users/{userId}/Views` works for all users and returns library views with `Id` that can be used as `ParentId`.
- To query items from a specific library: use `ParentId={viewId}` with `Recursive=true` on `/Users/{userId}/Items`.
- The `getLibraryIdByName(name)` method looks up a library by name via Views and caches the result.

### TV Mode Detection
- Enabled via `?tv=1` URL parameter (persisted to localStorage), or auto-detected via Android WebView user agent (`/Android/` + `/\bwv\b/`).
- The Android app (`MainActivity.kt`) always appends `?tv=1` to the URL as a reliable fallback.
- When enabled, `document.body` gets the `tv-mode` CSS class.

### TV Mode CSS
- `.tv-mode .content-grid` must use `!important` to override the responsive media queries (`@media min-width`) that set `auto-fill` grid columns.
- TV mode uses single-column layout.
- Download UI (buttons, badges, progress, Downloads nav tab) is hidden in TV mode via CSS `display: none !important`.

### TV Navigation (D-pad)
- `gridColumns` is always `1` in TV mode (hardcoded in `detectGridColumns()`), regardless of CSS computed value.
- Non-TV mode reads actual grid columns from `getComputedStyle(grid).gridTemplateColumns`.

### Service Worker Caching
- **Critical:** The service worker (`sw.js`) caches all app shell files. When making CSS/JS changes, you MUST bump `CACHE_VERSION` in `sw.js` or users will see stale cached files.
- After deploying, users may need a hard refresh for the new service worker to activate.

### Multi-file Script Globals
- Classes are defined across separate `<script>` files loaded in order. They share globals via `window`.
- Global instances: `jellyfinAPI` (JellyfinAPI), `downloadManager` (DownloadManager), `window.app` (TinyFinApp), `window.fullscreenManager`, `window.tvNavigation`.
- ESLint is configured with `no-undef: off` because of this multi-script architecture.

## Android TV App (`android/`)

- Minimal WebView wrapper, single Activity (~220 lines of Kotlin)
- Targets Android TV (Leanback) but also works on phones/tablets
- Loads TinyFin from a remote URL (set `TINYFIN_URL` in `MainActivity.kt`)
- Configured for: JS enabled, media autoplay, fullscreen video, D-pad key forwarding, screen-on
- **Build requirement:** JDK 17 (Zulu) — JDK 25 is incompatible with Gradle 8.9's Kotlin compiler. `gradle.properties` sets `org.gradle.java.home` to the Zulu 17 path.
- Signing config reads from `local.properties` (gitignored)
- Build AAB: `cd android && ./gradlew bundleRelease`
- Build APK: `cd android && ./gradlew assembleDebug`

## Dev Tooling

- **Prettier** (`.prettierrc`): 4-space indent, single quotes, no trailing commas, 100 char width
- **ESLint** (`eslint.config.mjs`): ESLint 10, recommended rules + best practices, `eslint-config-prettier`
- **Pre-commit hook** (husky + lint-staged): Prettier + ESLint on staged `.js` files, Prettier on `.html/.css/.json`
- Run `npm install` after cloning to set up hooks

## Hosted At

- GitHub Pages: `https://bogdan-calapod.github.io/tinyfin/`
- Jellyfin server: `https://jellyfin.noahbox.org`
