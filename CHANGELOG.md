# Changelog

Notable changes to the macOS distribution layer of this fork. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions are tagged with SemVer.

## [Unreleased]

## [0.2.751-macos] - 2026-07-01

### Maps
- The map is interactive now. Click anywhere to drop a named, color-coded pin; pins persist on the server and a "Pins" panel lists them with fly-to and delete. The map also gains a scale bar with a metric/imperial toggle, a live coordinate readout under the cursor, and it reopens where you left it instead of snapping back to the default view.

### Knowledge base
- Kiwix now serves content in library mode. Adding or removing a ZIM updates a managed library file that Kiwix reloads on its own, so new content appears without restarting the container, and one corrupt file no longer takes down every other ZIM. A missing or damaged library file is rebuilt automatically on startup, and existing installs migrate on their next boot or restart.
- The knowledge-base scan tracks each file's ingest state instead of guessing from search-index contents. Files that finished indexing, failed, or were left mid-ingest are told apart, so a sync no longer re-embeds settled files, and the chunk count recorded for a large ZIM is the true total rather than the last batch's. Groundwork for a Manual indexing mode is in place; the default behavior is unchanged.

### Appearance
- Night Ops: a dark mode. The toggle sits at the bottom of the sidebar (moon to switch in, sun to switch back) and turns the desert palette into a warm charcoal. The choice is remembered per browser and follows you across pages without a flash of the light theme.

## [0.2.750-macos] - 2026-06-28

### Supply Depot
- The Supply Depot table matches the upstream Apps layout again. The Version column no longer shows a raw 64-character image digest for digest-pinned apps; it shows the tag, or a short id when an image is pinned only by digest. The Category column is gone, which gives each app's description room to show in full instead of truncating mid-word. Stop/Start and Restart now sit inline next to Open and Update; Pin, the custom-app actions, and Wipe & reinstall stay in the row's overflow menu.

## [0.2.749-macos] - 2026-06-28

### Updates
- Automatic updates, opt-in and off by default. Settings → Updates has three switches: the NOMAD admin itself, installed apps, and maps/knowledge-base content. When a switch is on, NOMAD checks during a nightly window (default 02:00–05:00), waits out a cool-off after a new version first appears, then applies it. A run that fails three times in a row turns itself off, and an offline server is left alone instead of counted as a failure. Installed apps update only the ones you opt into per app, and never across a major version; turn an app's auto-update on from its Supply Depot row. The admin update runs `nomad upgrade` on the host and restarts the admin to finish.

## [0.2.748-macos] - 2026-06-28

### Knowledge base
- Downloading or updating general Wikipedia no longer deletes the curated topic tiers (medicine, simple, Wikivoyage, climate) you have installed. The cleanup that runs after a Wikipedia download matched every file beginning with `wikipedia_en_`, so finishing one corpus removed the others from disk. It now removes only older dated copies of the same corpus. Ports upstream's fix for issue #884.

## [0.2.747-macos] - 2026-06-27

Ports a set of upstream v1.33 bug fixes to this fork.

### Maps
- A map no longer goes blank when an old and a new copy of the same region are both on disk. The duplicate files produced a style MapLibre rejects; the newest file per region is now the one used.

### Knowledge base
- Curated Wikipedia-themed ZIMs (such as the medicine tier) keep their entry across restarts. The reconcile step skipped every file beginning with `wikipedia_en_`, which wiped the medicine tier and quietly downgraded it. It now skips only the single general-Wikipedia file you selected.
- When a curated map or ZIM updates, the previous version's file is removed from disk instead of being left behind. Only Wikipedia was cleaned up before, so other updates piled up old files.
- AI answers make better use of retrieved context. Context blocks now show their source title instead of a raw relevance percentage, the prompt no longer pushes the model to hedge with phrases like "according to the information available," and a heading-keyword match helps surface the right passage.

### Updates
- The Ollama update check works again for images with more than 1000 tags. The registry returns a relative URL for the next page of tags, which broke the second-page fetch, so the check stopped early and the app looked pinned at its installed version.

### AI chat
- Chat suggestions no longer hang when a very large model is installed. They now use your selected chat model, or the smallest installed one, instead of always loading the largest.

## [0.2.746-macos] - 2026-06-26

### Settings
- Grocy food readiness is now a single on/off toggle. NOMAD installs and runs Grocy, so it provisions its own read access when you turn the integration on, instead of asking you to paste a Grocy base URL and API key. Turning it off leaves Grocy untouched.

### Home
- The sidebar gains a Documentation link, so the built-in help is reachable from the Command Center again. It had no link after the home was reorganized.

### Supply Depot
- An app that ships with a built-in default login now shows it on its row once installed. Grocy lists its `admin` / `admin` default with a note to change it, so a fresh install isn't stranded at Grocy's own login screen with no idea what the credentials are.

## [0.2.745-macos] - 2026-06-25

### Settings
- The Grocy (Food Readiness) settings page no longer renders under the sidebar. It was the only settings page missing the sidebar-clearance padding, so its content was clipped along the left edge. A guard test now checks that every settings page clears the sidebar, so the next one can't ship the same way.

## [0.2.744-macos] - 2026-06-25

### Home
- Command Center app cards grow to fit their content instead of clipping. A long description no longer pushes the card icon past the top edge or cuts the text off at the bottom; cards in a row still share a height.
- Card icons render at 40px, between the thin 48px original and the too-small 32px from the previous build.
- Mesh Bridge's card description drops the internal build note. Curated card descriptions now refresh on update, so a copy fix reaches apps that are already installed.

## [0.2.743-macos] - 2026-06-25

### Home
- The Command Center app-card icons render at 32px with a heavier stroke instead of 48px at the default stroke, so they read as solid rather than thin against the cards. Mesh Bridge keeps its radio glyph.

## [0.2.742-macos] - 2026-06-24

### Home
- Apps on the Command Center home can be pinned or unpinned. The home still defaults to the core band (`display_order <= 8`), but a pin toggle on each card removes it from the home, and the Supply Depot overflow menu offers "Pin to home" for everything else. Choices persist per app in a `home.pins` setting.

## [0.2.741-macos] - 2026-06-24

### Home
- The Command Center home is reorganized: pinned apps (the core band shown first on a fresh login) are grouped into scenario decks (Secure & AI, Communicate, Knowledge & maps, Health & supplies, Tools & workshop) instead of one flat grid. The home now uses the same left sidebar as the rest of the app, so navigation (Supply Depot, Documentation, Settings) moves to the rail; a "Browse all apps" button reaches everything else. The descriptive app cards are unchanged.

## [0.2.740-macos] - 2026-06-24

### Supply Depot
- Per-row app actions collapse into a single overflow menu: Open stays inline (and Update when one is waiting), while Stop/Start, Restart, the custom-app actions, and Wipe & reinstall move into a `⋯` menu, so a row no longer wraps into a stacked pile.
- Vaultwarden is served over self-signed HTTPS so the LAN web vault gets the secure context passkeys need; an existing HTTP install migrates to HTTPS on the next boot.
- Easy Setup offers the offline FDA drug reference as an optional download.
- The drug-interaction comparison stays readable at the full five-drug comparison instead of crushing the columns into slivers.
- MeshCore Web tiles open over the correct `https://host:port` scheme.
- Real install failures surface in the UI and the admin logs instead of failing silently.
- A reseed syncs an app's container image, so a catalog image-tag correction reaches existing installs; two image tags that did not exist on the registry were fixed.
- Fixed a stray "0" that rendered next to the actions on non-custom installed rows.

macOS distribution layer, landed 2026-05-30.

### Added
- **`nomad update`** — one command to update an existing install: it locates the
  active bundle (recorded as `NOMAD_BUNDLE_DIR` at install time), refreshes it
  (git pull for a clean checkout, otherwise a validated release tarball), and
  re-runs the install in place. No data loss, no model re-pull.
- **`install/bootstrap.sh`** — a one-line first-run installer for a fresh Apple
  Silicon Mac:
  `curl -fsSL https://raw.githubusercontent.com/caweis/project-nomad/main/install/bootstrap.sh | bash`.
  It fetches the bundle to `~/Applications/project-nomad` (override with
  `NOMAD_HOME`) and hands off to `nomad install`, which still asks where to store
  content (typically an external drive).
- **Full man-page set** — a rewritten `nomad(1)` overview grouped by purpose,
  plus a `nomad-<command>(1)` page for every subcommand. `man nomad` and
  `man nomad-<command>` work after install.
- **`nomad reset-ollama --internal` / `--drive`** — `reset-ollama` now detects a
  mounted-but-wedged external data drive, falls back to internal models so the
  daemon stays responsive, auto-pulls a RAM-appropriate model set when the
  internal store is empty, and restores to the drive once it is healthy again.
- **`nomad install-field-desk` / `nomad uninstall-field-desk`** — optional
  coexistence install for [SysAdminDoc/project-nomad-desktop](https://github.com/SysAdminDoc/project-nomad-desktop)
  (NOMAD Field Desk), a separate preparedness app that shares the native Ollama
  daemon on port 11434.
- **Continuous integration** (`.github/workflows/checks.yml`) — runs the shell
  test suites and the command↔man-page and allow-list drift guards on macOS
  runners for changes to the install layer.

### Changed
- The host-command-bridge allow-list is now single-sourced from
  `admin/constants/host_commands.ts`, consumed by both the admin controller and
  the UI; the host-side `run_cmd` allow-list is verified against it in CI.
- `nomad install` records the bundle path (`NOMAD_BUNDLE_DIR`) in `.env` so
  `nomad update` always knows which bundle to refresh.
- The README install instructions now use the one-line bootstrap.

### Fixed
- Self-update and bootstrap URLs and the in-CLI recovery hints now reference the
  repository's current name (`caweis/project-nomad`); they previously relied on a
  GitHub redirect from the former name.

### Removed
- The pre-CLI standalone macOS installer (`install/install_nomad_macos.sh`),
  superseded by `nomad install`. The unified `nomad` command is the single
  first-run path; git history preserves the original.
