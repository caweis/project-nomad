# Changelog

Notable changes to the macOS distribution layer of this fork. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions are tagged with SemVer.

## [Unreleased]

## [0.2.758-macos] - 2026-08-05

### Downloads
- A failed download no longer blocks that URL forever. The failed job stayed in
  the queue under a fixed id, so every later attempt — Apply update, category
  tiers, the Wikipedia switcher, map regions, direct ZIM downloads — either
  reported success while downloading nothing or claimed a download was already
  in progress. Stale finished jobs are now cleared before re-dispatch. (Ports
  the fix from upstream PR #1213 and applies it to every download guard.)
- The same trap existed for model downloads and knowledge-base embedding, where
  it was worse: a model could never be reinstalled after deletion, the Retry
  button on a failed model download did nothing while reporting success, and
  "force re-embed" could delete a file's vectors and then never rebuild them.
  All three paths now clear the stale job first.

### Security
- Dependency fixes: undici 6.28, ip-address 10.4, tar 7.5.22 (fixes a critical
  crash advisory), protobufjs 7.6.5 (critical), form-data, brace-expansion,
  postcss, yaml, and bullmq updated within their current majors. Production
  advisories drop from 34 (2 critical) to 16, all remaining ones tied to major
  upgrades tracked separately (sharp, dockerode, AdonisJS line).

## [0.2.757-macos] - 2026-08-05

### Content
- Curated collections can now include gated content you host yourself. Mark a
  manifest resource with auth: "nomad_app_key" and NOMAD sends your
  HOSTED_CONTENT_APP_KEY as a bearer token when downloading it. A rejected key
  fails the download immediately with a message that says what to fix, instead
  of silently retrying for hours. Gated items always download from their
  manifest URL — never a catalog mirror — and sit out automatic content
  updates. (Ports upstream #1172 and #1205; unlike upstream, no key ships in
  the image — you set your own.)

### Benchmark
- Results now record the platform they ran on: CPU architecture, the container
  VM's OS, the engine (OrbStack, Docker Desktop, Colima, Lima), and whether the
  native or sysbench benchmark produced the scores. Shown under Benchmark
  Details. Leaderboard submissions are unchanged. (Ports upstream #1158,
  adapted.)

## [0.2.756-macos] - 2026-08-05

Integrates upstream's v1.34.0 final release (their rc.2 → final delta).

### Knowledge base
- Collections now stick. Assigning a collection to a file before it's indexed
  reaches the vectors when indexing runs, ZIM content is tagged at all (it
  previously never was, so ZIM files couldn't be filtered by collection), and
  assigning a collection to a not-yet-indexed file no longer reports success
  while storing nothing. (Ports upstream #1200.)
- The collection dropdown isn't clipped to a sliver by the table row anymore,
  and the Knowledge Base modal is wider. (Ports upstream #1198.)

### Downloads
- Interrupted content downloads resume from where they stopped instead of
  restarting multi-GB files from byte zero. A partial file that no longer
  matches what the server has (Kiwix replaced the build under the same name) is
  discarded instead of erroring forever. (Ports upstream #1202.)
- The downloads panel no longer breaks permanently when an orphaned queue entry
  with no payload shows up. (Ports upstream #1191.)

### Drug Reference
- Comparing labels uses the full width of the screen — one drug reads
  full-width, two split it — instead of narrow fixed columns beside empty
  space. Two leftover light-mode-only colors now follow the theme. (Ports
  upstream #1163.)
- The in-app docs gain a Drug Reference guide. (Ports upstream #1161.)

### Content
- Curated collections refreshed to upstream v1.34.0: the dead Wikipedia
  download links point at current builds, Survival & Preparedness is rebalanced
  and gains CD3WD, ready.gov, knots, water purification, post-disaster guides,
  and the ham radio and outdoors Stack Exchange archives. (Ports upstream
  #1148, #1189, and the v1.34 rebalance.)

### Chat
- "Open Full Chat" from the chat modal navigates in place instead of spawning a
  new window. (Ports upstream #1181.)

### Under the hood
- A failed AI-benchmark warm-up is logged instead of silently swallowed (ports
  part of upstream #1164; the rest of their benchmark-submission gating doesn't
  apply to this fork's native-Ollama architecture).
- Supply Depot docs point MeshCore Web at the official meshcore.io site. Deps:
  tar 7.5.16, vite 6.4.3.

## [0.2.755-macos] - 2026-07-24

### Drug Reference
- Redesigned into three tabs: Search by drug, By situation, and FDA data. Each
  tab runs one search direction, replacing the two overlapping result sections.
- Drug search now groups results by active ingredient — "Ibuprofen, 28 products"
  — with single-ingredient medicines ranked above combination products, and
  result rows lead with the ingredient instead of the marketing label title. No
  more homeopathic products burying the real OTC options.
- You can select several situations at once (say, fever plus cough) and see the
  drugs that match.
- A one-time disclaimer now opens before first use, spelling out what the tool
  is and isn't (not medical advice, not an interaction checker). Each browser
  acknowledges it once.
- Natural-remedy sections carry a clearer amber safety note, and the Drug
  Reference pages use a compact header so the search box sits near the top of
  the screen. (Ports upstream #1137.)

## [0.2.754-macos] - 2026-07-24

Small fixes from upstream's post-rc.2 work.

### Knowledge base
- Large ingestions run noticeably faster. The vector-store collection and its
  indexes were being re-verified on every embedded document — roughly 45% of
  per-document database time on big ZIM ingestions; that check now runs once.
  (Ports upstream #1135.)

### Benchmark
- The progress display no longer flashes a stale "Starting benchmark" state over
  live progress. (Ports upstream #1136.)
- When a leaderboard submission fails, the message now tells you why — including
  the one-submission-per-hour limit — instead of a generic failure. (Ports
  upstream #1138.)

### Under the hood
- Dependency bumps: axios 1.18.1, systeminformation 5.31.7, matching upstream.

## [0.2.753-macos] - 2026-07-22

Finishes the v1.34 upstream port batch: custom AI instructions, knowledge-base
collections, fresher curated ZIM downloads, and the per-model thinking switch.

### AI
- NOMAD.md custom instructions. Keep standing instructions for your assistant —
  persona, tone, priorities, house rules — in a NOMAD.md file, edited from a new
  button in the chat sidebar (a markdown editor with highlighting and dark-mode
  support) or directly on disk at storage/NOMAD.md. Its contents are sent as the
  leading system prompt on every chat; an empty file changes nothing. (Ports
  upstream #1127.)
- The per-model thinking override is here. Models that support thinking get a
  Thinking switch in the chat header; the choice is remembered per model, and the
  global default in AI settings still covers models you haven't toggled.
  (Completes the port of upstream #1079.)

### Knowledge base
- Collections. Tag uploads with a subject at upload time (recipes, health,
  survival, or type your own), retag any stored file from the KB table, and
  rename or remove tags without touching the files themselves. In chat, a
  "Search in" picker scopes the assistant's retrieval to one collection.
  (Ports upstream #1063.)

### Downloads
- Curated ZIM downloads now check the live Kiwix catalog before starting. Kiwix
  rotates dated filenames and deletes old files, so the pinned URLs in curated
  collections eventually 404; the download now resolves the current file and
  falls back to the pinned URL when offline. (Fork-native take on upstream
  #1091, built on our OPDS path.)

## [0.2.752-macos] - 2026-07-21

Ports a batch of upstream v1.34 fixes and small features to this fork, and adds a
home-layout choice.

### Home
- The Command Center opens as a flat tile grid again by default. The categorized
  scenario decks stay available: a Grid / Decks switch on the home flips between
  them, and your choice is remembered.
- A dismissable "What's new" banner appears on the dashboard listing the recent
  highlights. Once you dismiss it, it stays gone for that release. (Ports upstream
  #1112.)

### AI
- Model thinking is now opt-in. Capable models used to always show their
  reasoning; a "Model Thinking" switch in AI settings turns that on or off, and it
  starts off. (Ports upstream #1079. The per-model override in the chat picker is
  still to come.)

### Downloads
- Large Wikimedia downloads work again. download.kiwix.org routes the big
  Wikipedia-family ZIMs to a mirror that returns 403 for a generic User-Agent,
  which silently stalled the full Wikipedia. We now send a descriptive one. (Ports
  upstream #1114.)
- Failed downloads get a Retry button that re-runs the download with its original
  settings. (Ports upstream #1059.)
- After an admin update, superseded images are pruned to reclaim disk instead of
  piling up across releases. (Ports upstream #1101.)

### Knowledge base
- Word documents (.docx) extract as clean text for the AI Assistant now, instead
  of the ZIP/XML garbage the plain-text reader produced. (Ports upstream #1100.)
- ZIM article extraction skips reference sections (References, See also, External
  links) so that boilerplate stops reaching search and embeddings, and it renders
  tables as readable rows instead of running every cell together. (Ports upstream
  #1044.)

### Diagnostics
- The Debug Info bundle now reports the storage path, Docker engine version, Kiwix
  library book count, and auto-update state, the fields support usually asks for.
  (Ports upstream #1102.)

### Under the hood
- The Linux install and uninstall scripts define the colors and header helper they
  referenced but never set, so they stop erroring on those lines. (Ports upstream
  #1098.)
- CONTRIBUTING gains a UI-consistency section. (Ports upstream #1080.)

## [0.2.751-macos] - 2026-07-01

### Maps
- The map is interactive now. Click anywhere to drop a named, color-coded pin; pins persist on the server and a "Pins" panel lists them with fly-to and delete. The map also gains a scale bar with a metric/imperial toggle, a live coordinate readout under the cursor, and it reopens where you left it instead of snapping back to the default view.

### Knowledge base
- Kiwix now serves content in library mode. Adding or removing a ZIM updates a managed library file that Kiwix reloads on its own, so new content appears without restarting the container, and one corrupt file no longer takes down every other ZIM. A missing or damaged library file is rebuilt automatically on startup, and existing installs migrate on their next boot or restart.
- The knowledge-base scan tracks each file's ingest state instead of guessing from search-index contents. Files that finished indexing, failed, or were left mid-ingest are told apart, so a sync no longer re-embeds settled files, and the chunk count recorded for a large ZIM is the true total rather than the last batch's.
- The Knowledge Base panel shows each stored file's status (Indexed, Pending, Failed, Stalled, Browse only) with its chunk count, and failed files get a Retry button. A new "Index new files" setting chooses between Always (auto-index on scan, the default and prior behavior) and Manual, where new files wait as Pending until you click Index on the ones you want embedded.
- Picking a curated content tier now shows how much extra disk the AI Assistant will need to index those files, on top of the raw downloads. If that estimate crosses 50 GB or a tenth of your free space, a confirmation step asks before committing — embedding at that scale takes hours and real storage.

### Appearance
- Night Ops: a dark mode. The toggle sits at the bottom of the sidebar (moon to switch in, sun to switch back) and turns the desert palette into a warm charcoal. The choice is remembered per browser and follows you across pages without a flash of the light theme.

### Updates
- An installed app's automatic update now checks free disk before it pulls. If there isn't room for the new image, NOMAD skips that app for the night and logs the reason, rather than starting a pull that fails partway and counts toward the app's three-failure auto-disable. Space usually frees up on its own, so the update retries on a later night.

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
