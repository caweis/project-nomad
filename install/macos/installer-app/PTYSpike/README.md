# PTYSpike — installer feasibility probe

This is the de-risking spike for the NOMAD Installer.app (see
`docs/superpowers/specs/2026-06-10-gui-installer-design.md`). It proves the one
genuinely novel piece of the installer before any of the SwiftUI wizard gets
built: **driving the `nomad install` CLI — which prompts for sudo on its
controlling terminal — from a GUI process.**

## Why a PTY is required

`nomad`'s `sudo_bootstrap()` runs `sudo -v`. sudo reads the password straight
from `/dev/tty`, not from stdin, so a GUI app can't just pipe a password into the
process. The standard fix (what `script`, `expect`, and Terminal itself rely on)
is to run the command inside a **pseudo-terminal**: the child gets the PTY slave
as its controlling terminal, and whatever the parent writes to the PTY master is
what sudo reads.

`Sources/CPTY` wraps `forkpty(3)` so the fork/exec happens entirely in C (no
Swift-runtime fork hazards). `Sources/PTYSpike` is the Swift driver that reads the
stream and answers the prompt. The CPTY target is the seed of the app's eventual
`PTYRunner`.

## What it proves

Running `sudo -k; sudo -v` inside the PTY, the probe:

1. allocates a PTY and spawns the command in it,
2. detects the `Password:` prompt in the master stream,
3. writes a **deliberately wrong** password back into the PTY,
4. confirms sudo answered `Sorry, try again.` — proof the write reached sudo's
   `/dev/tty` read.

`PASS` means the app can intercept and answer the installer's sudo prompt.

## Safety / footprint

- The password sent is a throwaway wrong string. **Nothing is installed and no
  real credential is handled** — the auth is designed to fail. (`sudo -v` runs no
  command regardless; it only refreshes the timestamp.)
- The probe burns **one** failed sudo attempt, then closes the PTY to abort.
- `sudo -k` clears the caller's cached sudo timestamp (self-correcting: the next
  real `sudo` just asks for a password again).

## Run

```sh
cd install/macos/installer-app/PTYSpike
swift run PTYSpike
```

It will trigger one real macOS password prompt in the terminal stream; the spike
answers it (wrong, on purpose) so you don't type anything.
