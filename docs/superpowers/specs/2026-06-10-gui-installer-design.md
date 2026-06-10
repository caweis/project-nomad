---
feature: NOMAD Installer.app — self-contained GUI installer (notarized DMG)
decided_by: Chris (2026-06-10; chose native SwiftUI app over .pkg / script-wrapper)
status: approved design — build in a fresh session
target: GitHub Releases asset; README "Install" gains a no-Terminal path
tags: [installer, gui, swiftui, dmg, notarization, distribution]
---

# NOMAD Installer.app — GUI install with no Terminal

## Goal
A downloadable DMG a non-technical Mac user can open, drag nothing, double-click,
answer three questions, and end up with a running NOMAD — without ever seeing a
Terminal. "If we think it's stable": yes, BECAUSE the GUI is a thin skin over the
proven CLI pipeline, never a reimplementation.

## The load-bearing decision
`nomad install` already runs fully unattended:
`nomad install --data-root PATH --tier auto|tiny|...|dreamy --backend ollama|omlx --yes`
(plus `--models`/`--no-models`). The app collects exactly those choices in a
wizard and executes the real CLI, streaming its output into a progress view.
Stability is inherited from the idempotent, self-repairing installer that is
already validated end-to-end on the M4 mini. The app contains NO install logic.

## Architecture
- **App**: SwiftUI, macOS 14+, Apple Silicon. One window, wizard flow:
  1. Welcome — what NOMAD is, what will be installed (Homebrew, OrbStack,
     Ollama/oMLX, containers), disk/network expectations (~tens of GB content).
  2. Data drive — list candidate volumes (`/Volumes/*`, writable, size shown);
     internal-disk fallback with a size warning. Maps to `--data-root`.
  3. Model tier — auto-detected from RAM (mirror the CLI's tier table; show
     sizes); maps to `--tier` (default `auto`).
  4. AI backend — Ollama (default) vs oMLX (Apple MLX, macOS 15+ gate); maps to
     `--backend`.
  5. Progress — live log stream with a friendly phase header (the CLI's `section`
     lines parse cleanly as milestones), elapsed time, and a Details disclosure
     showing raw output. On success: "Open NOMAD" button → http://localhost:8080.
- **Execution**: the app bundles the install bundle (the repo's `install/` tree,
  or downloads the pinned release tarball on first run — DECISION: bundle it, so
  the DMG is self-contained and works behind captive portals; `nomad self-update`
  handles staying current afterward). It runs `bash nomad install ... --yes`
  inside a **PTY** (posix_openpt / Process with pseudo-tty) so the CLI behaves
  exactly as in Terminal.
- **Privilege handling (the real gotcha)**: the CLI prompts for sudo (Homebrew,
  Rosetta) on the TTY, and dies if launched AS root (`EUID==0` guard). So the app
  must NOT elevate itself. Instead: watch the PTY stream for the sudo password
  prompt, present a native SecureField sheet ("NOMAD needs your password to
  install Homebrew — this is macOS's standard admin prompt"), and write the
  password to the PTY. Never store it; zero the buffer after write. sudo may
  re-prompt (timestamp expiry on long installs) — the sheet re-presents on each
  detection. Pattern to detect: `^Password:` / `\[sudo\]` lines.
- **Failure UX**: any CLI non-zero exit → the progress view flips to "Install
  hit a problem", shows the last ~40 log lines, offers "Try again" (the installer
  is idempotent — re-running repairs) and "Copy full log". Log mirrored to
  `~/Library/Logs/nomad-gui-installer.log`.

## Distribution + signing
- **Signing**: Developer ID Application certificate (Chris's Apple Developer
  account — same as RigSense). Hardened runtime, no entitlements beyond default.
- **Notarization**: `xcrun notarytool submit` + staple, via an App Store Connect
  API key. CI secrets needed: `MACOS_CERT_P12` (+ password), `NOTARY_KEY_ID`,
  `NOTARY_ISSUER_ID`, `NOTARY_KEY_P8`. Chris provisions these once.
- **DMG**: `create-dmg` (or hdiutil) with the app + an Applications symlink +
  background art (desert theme). DMG itself signed + notarized.
- **CI**: a new workflow `build-gui-installer.yml`, manual dispatch + on tag,
  runs on `macos-14` runners: xcodebuild archive → sign → notarize → staple →
  DMG → attach to the GitHub Release. (No GHCR involvement.)
- **README**: Install section gains "Or download the installer app" pointing at
  the latest release DMG; curl one-liner stays for Terminal folk.

## Stability gate before advertising
Build → Chris validates the DMG on a CLEAN macOS user account (ideally a wiped
Mac or new user): Gatekeeper accepts without warnings, wizard → working NOMAD,
re-run repairs. Only then does the README/community post mention it.

## Phases (each its own session/patch)
1. **P1 — app skeleton**: Xcode project under `install/macos/installer-app/`
   (SwiftUI, wizard, drive/tier/backend pickers, PTY runner, sudo interception,
   progress view). Runs unsigned locally for dev.
2. **P2 — packaging pipeline**: signing + notarization + DMG in CI; secrets
   provisioning checklist for Chris.
3. **P3 — release + docs**: attach to release, README + community-post mention
   after the clean-Mac validation passes.

## Out of scope (YAGNI)
- Uninstaller GUI (the CLI has `nomad uninstall`; the app's Welcome links docs).
- Auto-update of the app itself (Sparkle etc.) — the app is a one-shot installer;
  `nomad self-update` owns ongoing updates.
- Intel Macs (fork targets Apple Silicon, as today).
- Windows/Linux anything.

## Risks
- **PTY/sudo interception** is the only genuinely novel code. Mitigation: build
  P1 around it first (spike), test against the real CLI early on a scratch user.
- **Notarization friction** (first-time secrets, Apple service hiccups) — P2 is
  isolated so it can't block P1 development.
- **Bundle drift**: the app pins the bundle it ships; first thing `nomad install`
  does post-install is land the self-update path, so drift self-heals.
