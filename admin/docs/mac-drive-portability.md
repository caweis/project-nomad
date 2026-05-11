# Your data drive

On the Mac edition, N.O.M.A.D. is designed around the idea that you can unplug your data drive and take it with you — across town, across the country, between Macs. The drive carries everything that isn't tied to a specific machine.

This is the part that makes a Mac with N.O.M.A.D. genuinely portable. Your laptop dies; plug the drive into another Mac and bring up your N.O.M.A.D. exactly as it was, with no internet connection required for the install.

---

## What's on the drive

When you installed N.O.M.A.D., the installer put everything onto `<your-data-drive>/project-nomad/`. That directory now contains:

| Path | What it is |
|---|---|
| `storage/` | The Information Library (ZIM files), Maps, Workshop's STL library, RAG document uploads, and more. The big stuff. |
| `ollama-models/` | Your downloaded AI models. Anywhere from a few GB to over 200 GB depending on your tier. |
| `quick-chat.html` | A standalone browser page that lets you chat with your models on any Mac the drive plugs into, without installing N.O.M.A.D. proper. |
| `quick-chat.sh` | A small script that starts a minimal Ollama daemon pointing at the drive's models and opens `quick-chat.html`. |
| `install-nomad.command` | A double-clickable script that installs the full N.O.M.A.D. stack on a new Mac, using the bundled installer on the drive. |
| `install-bundle/` | A mirror of the N.O.M.A.D. installer itself. Lets `install-nomad.command` run without an internet connection for the install code. |

The container database (MySQL + Redis) and your secrets are NOT on the drive — they live on your Mac's internal disk at `~/.config/project-nomad/`. This is intentional, so that you can safely unplug the drive without breaking the Command Center.

---

## Unplugging the drive

The Command Center keeps running when the drive is unplugged. MySQL and Redis are on your Mac's internal disk, so they don't notice. The AI Assistant keeps any already-loaded model in RAM for up to 30 minutes, so chat continues working for a while.

What stops working:

- **Information Library** pages — Kiwix can't reach the ZIM files.
- **Maps** — the offline tiles aren't reachable.
- **Workshop** — the STL files can't be opened.
- **AI Assistant after the 30-minute keep-alive expires** — Ollama would need to load a model again, but the model files are on the unplugged drive. The chat shows a clear error.

When you re-plug the drive, everything comes back automatically. There's a background service that watches for the drive returning and reloads Kiwix's library; the other services pick up on their next request.

If you want to be deliberate about it:

```
nomad up
```

re-runs the bring-up pass after a re-plug and confirms everything is back.

---

## Moving the drive to another Mac

This is where the Mac edition pays off. You have two paths depending on whether the destination Mac already has N.O.M.A.D. installed.

### Destination Mac already has N.O.M.A.D.

Plug the drive in. The other Mac's N.O.M.A.D. picks it up — Kiwix sees the new ZIM files, Ollama sees the new models, Workshop sees the new STLs. There's a small wrinkle if the data root path is different between Macs (e.g., one drive mounted as `/Volumes/DriveA` and another as `/Volumes/DriveA 1`); the drive-resolution scripts handle that automatically by scanning `/Volumes/` for any drive containing the `project-nomad/` directory.

If you want the second Mac to actually USE this drive going forward (rather than its own), point its `.env` at the new path:

```
nomad install --data-root /Volumes/<drive-name>/project-nomad
```

That rewires N.O.M.A.D. on the second Mac to use this drive as its primary data root.

### Destination Mac doesn't have N.O.M.A.D. yet

Plug the drive into the new Mac. Open Finder, navigate to the `project-nomad/` folder on the drive, and double-click **install-nomad.command**.

The script opens Terminal and:

1. Detects that no N.O.M.A.D. is installed on this Mac.
2. Confirms with you before doing anything.
3. Runs the installer from the bundled copy on the drive (no internet needed for the install code itself — though Homebrew, Ollama, and OrbStack will still download themselves on first-time install).
4. When the installer asks where to store data, point it at this drive.

Within 10–30 minutes (mostly waiting for Homebrew/OrbStack/Ollama to install), the new Mac has a working N.O.M.A.D. using the same content and models as the source Mac.

---

## Chat-only on any Mac

If you don't want a full N.O.M.A.D. install on a second Mac and just want to use the AI Assistant with your existing models, double-click **quick-chat.sh** instead. It:

1. Auto-installs Ollama via Homebrew if it's not already there.
2. Sets `OLLAMA_MODELS` to point at the drive's model cache.
3. Starts a background Ollama daemon.
4. Opens `quick-chat.html` in your default browser.

That's a self-contained AI chat surface with no Command Center, no Workshop, no Wikipedia, no admin overhead. Just a clean chat against your local models. Useful for a quick session on someone else's Mac or your travel laptop without committing to a full install.

---

## Backups

The drive is your backup, but the drive can fail. If you care about the data, here's the realistic split:

- **AI models** — re-downloadable from `ollama.com/library`. Skip from your backup.
- **Wikipedia / Kolibri / reference ZIMs** — re-downloadable via Easy Setup. Skip.
- **Maps** — re-downloadable via the Maps Manager. Skip.
- **Your notes, your Workshop STL library, your RAG documents** — these are yours. Back them up.

The notes live on the drive at `storage/flatnotes/`. Your STL library is at `storage/stl-library/`. RAG uploads are at `storage/kb_uploads/`. Time Machine handles these correctly. So does a `rsync` to a second drive, or a `tar`/`zip` archive — they're just files.
