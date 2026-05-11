# Installing N.O.M.A.D. on your Mac

This guide walks you through installing N.O.M.A.D. on a Mac with Apple Silicon. The whole install is one command, takes 10-30 minutes (most of which is downloading AI models), and is safe to re-run if anything goes wrong.

---

## Before you begin

You'll want:

- **An Apple Silicon Mac** (M1, M2, M3, M4, or later). macOS 14 (Sonoma) or newer.
- **At least 16 GB of RAM.** N.O.M.A.D. works on 8 GB but you'll be limited to the smallest AI models. 32 GB or more lets you run the larger, more capable models.
- **A few hundred GB of free disk space.** AI models alone can run 10–200 GB depending on which ones you pick. Wikipedia is another 50 MB to 96 GB depending on the size you choose.
- **An external drive (recommended).** N.O.M.A.D. is designed to put content on a fast external SSD so you can unplug it for travel or move it between Macs. A 1 TB drive is comfortable; 2 TB is generous. APFS-formatted.
- **An internet connection for the install.** Once everything's downloaded, N.O.M.A.D. works offline.

You don't need to install Docker, Homebrew, Ollama, or anything else first. The installer handles all of it.

---

## Install

Open Terminal and paste this:

```bash
mkdir -p ~/Developer && cd ~/Developer && \
  curl -fsSL https://github.com/caweis/project-nomad-macos-arm64/archive/refs/heads/feat/macos-distribution-layer.tar.gz | tar xz && \
  bash project-nomad-feat-macos-distribution-layer/install/macos/nomad install
```

The installer is interactive — it'll ask you a few questions:

- **Where to store data.** Pick your external drive if you have one. The installer detects mounted drives and lists them with their available space.
- **Whether to set your Mac's local hostname to `nomad`.** This makes the Command Center reachable at `http://nomad.local/` from any device on your network. You can decline if your Mac already has a name you want to keep.
- **Which AI models to pull.** The installer detects your Mac's RAM and recommends a tier (tiny / small / medium / large / xl / dreamy). You can accept the default, pick a different tier, or skip models entirely and pull them later.

Everything else is automatic.

---

## What happens during install

The installer goes through these steps:

1. **Dependencies.** Installs Homebrew (if missing), Xcode Command Line Tools (if missing), Rosetta 2 (for some compatibility), and `jq`.
2. **Data root.** Sets up the directory structure on your chosen drive — `storage/`, `ollama-models/`, and a few small files for portability.
3. **OrbStack.** Installs OrbStack (a fast Docker replacement for Mac) and tunes its memory allocation to about 80% of your host RAM.
4. **Native Ollama.** Installs Ollama via Homebrew and sets it up as a background service on port 11434. This is what gives the AI Assistant direct access to your Mac's Metal GPU.
5. **Local hostname.** Sets your Mac's Bonjour name to `nomad` (with your permission) so devices on your network can reach the Command Center at `http://nomad.local/`.
6. **Secrets.** Generates a secrets file at `~/.config/project-nomad/.env` with database passwords and other configuration.
7. **Container stack.** Pulls and starts the Command Center, database, cache, and update sidecar.
8. **Database setup.** Runs migrations and seeds the services catalog so the Apps page and Easy Setup wizard work.
9. **Service versions.** Checks for newer versions of each service (Kiwix, Kolibri, etc.) and bumps to the latest within the same major version.
10. **Background services.** Installs LaunchAgents for partial-download recovery, benchmark host-info patching, and Bonjour service discovery.
11. **AI models.** Downloads the model tier you picked. This is the longest step — depending on your tier and bandwidth, anywhere from 5 minutes to a couple hours.

When it's done, the Command Center is at `http://localhost/` on the Mac you installed on, or `http://nomad.local/` from any device on your network.

---

## After install

Open the Command Center in your browser. You'll see tiles for:

- AI Assistant
- Information Library
- Education Platform
- Maps
- Workshop
- Notes
- Data Tools

The first thing most people do is click **Easy Setup** and walk through the wizard to download content — Wikipedia, reference libraries, map regions, and so on. See [Getting Started](/docs/getting-started) for the wizard walkthrough.

If you want to fine-tune anything from the command line instead, see [The `nomad` command](/docs/mac-nomad-cli).

---

## Troubleshooting

**The install asked for my password.** Yes — installing Homebrew and Rosetta needs administrator privileges. The installer asks once at the start.

**The install said something failed and stopped.** Re-run the same install command. The installer is idempotent — re-running fixes anything that's broken without losing progress.

**My external drive isn't showing up.** Make sure it's mounted in Finder (visible in the sidebar). The installer scans `/Volumes/` for APFS-formatted drives.

**`nomad.local` isn't reachable from my phone or laptop.** Both devices need to be on the same Wi-Fi network. Some networks block mDNS — try `http://<ip-address-of-mac>:8080/` as a fallback (`System Settings → Network → Wi-Fi → Details` shows the IP).

**Something else.** Run `nomad check` from Terminal for a full diagnostic. See [The `nomad` command](/docs/mac-nomad-cli) for the full reference.
