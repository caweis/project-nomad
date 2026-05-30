# Your data drive

{% callout type="info" title="This page is for external-drive installs" %}
If you chose an external drive (SSD or HDD) as your data root during install, everything below applies. If you installed N.O.M.A.D. onto your Mac's internal disk, the unplug / replug / move-the-drive-to-another-Mac behavior on this page isn't relevant — your data goes wherever the Mac goes. The "What's NOT on the drive" table and the backup guidance at the bottom still apply (those describe internal-disk paths that exist regardless).
{% /callout %}

On the Mac edition, N.O.M.A.D. is designed so you can unplug the data drive and take it with you — across town, across the country, between Macs. The drive carries the content and models; the Mac itself only carries the database and your secrets.

If a laptop dies, you can plug the drive into another Mac and bring up N.O.M.A.D. with the same content and models. The install code is also on the drive, so the bootstrap doesn't need internet for the install itself (Homebrew, Ollama, and OrbStack still pull their own installers the first time).

---

## What's on the drive

When you installed N.O.M.A.D., the installer put everything onto `<your-data-drive>/project-nomad/`. That directory contains:

| Path | What it is |
|---|---|
| `storage/` | The Information Library (ZIM files), Maps, Workshop's STL library at `storage/stl-library/`, RAG document uploads at `storage/kb_uploads/`, FlatNotes data at `storage/flatnotes/`, and more. The big stuff. |
| `ollama-models/` | Your downloaded AI models. Anywhere from a few GB to over 200 GB depending on your tier. |
| `quick-chat.html` | A standalone browser page that lets you chat with your models on any Mac the drive plugs into, without installing N.O.M.A.D. proper. |
| `quick-chat.sh` | A small script that starts a minimal Ollama daemon pointing at the drive's models and opens `quick-chat.html`. |
| `install-nomad.command` | A double-clickable script that installs the full N.O.M.A.D. stack on a new Mac, using the bundled installer on the drive. |
| `install-bundle/` | A mirror of the N.O.M.A.D. installer itself. Lets `install-nomad.command` run without an internet connection for the install code. |

## What's NOT on the drive

The database and your secrets stay on the Mac's internal disk:

| Path | What it is |
|---|---|
| `~/.config/project-nomad/state/mysql/` | MySQL data directory (bind-mounted into the `nomad_mysql` container) |
| `~/.config/project-nomad/state/redis/` | Redis data directory (bind-mounted into the `nomad_redis` container) |
| `~/.config/project-nomad/.env` | Secrets — `APP_KEY`, `DB_PASSWORD`, `MYSQL_ROOT_PASSWORD`, and the resolved data-root path. `chmod 600`, off iCloud. |

MySQL and Redis run as containers inside OrbStack (Docker on Mac), and OrbStack itself lives on internal disk. Their data is bind-mounted from the paths above, so when the data drive is unplugged the database keeps working — it never touches the drive.

---

## Unplugging the drive

The Command Center keeps running when the drive is unplugged, because MySQL and Redis are on internal disk. The AI Assistant keeps any already-loaded model in RAM for `OLLAMA_KEEP_ALIVE=30m`, so chat continues working for up to 30 minutes after the drive disappears.

What stops working when the drive is out:

- **Information Library** pages — Kiwix can't reach the ZIM files.
- **Maps** — the offline tiles aren't reachable.
- **Workshop** — the STL files can't be opened.
- **AI Assistant after the 30-minute keep-alive expires** — Ollama would need to load a model from disk, but the model files are on the unplugged drive. The chat shows an error.

When you re-plug the drive, a periodic kiwix-self-heal LaunchAgent (running every 60 seconds) notices that new or changed ZIM files have appeared and reloads Kiwix. Maps and Workshop pick up on their next request. There's no global drive-watcher — each service recovers on its own pass.

If you want to be deliberate about it:

```
nomad up
```

re-runs the bring-up pass after a re-plug and confirms everything is back.

---

## Moving the drive to another Mac

Two paths, depending on whether the destination Mac already has N.O.M.A.D. installed.

### Destination Mac already has N.O.M.A.D.

Plug the drive in. The other Mac's N.O.M.A.D. picks it up — Kiwix sees the new ZIM files (after the next self-heal pass), Ollama sees the new models, Workshop sees the new STLs. If the data-root path is different between Macs (e.g., one drive mounted as `/Volumes/DriveA` and another as `/Volumes/DriveA 1`), the drive-resolution code in `ollama-launcher.sh` and the `nomad` CLI handles it by scanning `/Volumes/` for any drive containing the `project-nomad/` directory.

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
3. Runs the installer from the bundled copy on the drive (`install-bundle/nomad install`). No internet needed for the install code itself — though Homebrew, Ollama, and OrbStack will still download themselves on first-time install.
4. When the installer asks where to store data, point it at this drive.

Within roughly 10–30 minutes — mostly waiting for Homebrew, OrbStack, and Ollama to install on the new Mac — the new Mac has a working N.O.M.A.D. using the same content and models as the source Mac.

---

## Chat-only on any Mac

If you don't want a full N.O.M.A.D. install on a second Mac and just want to use the AI Assistant with your existing models, double-click **quick-chat.sh** instead. It:

1. Installs Ollama via Homebrew if it's not already there. If Homebrew itself isn't installed, the script asks if it should install Homebrew first — one prompt for consent, then one sudo password during the Homebrew install, then it continues into the Ollama install automatically.
2. Sets `OLLAMA_MODELS` to point at the drive's model cache.
3. Starts a background Ollama daemon.
4. Opens `quick-chat.html` in your default browser.

That's a chat surface with no Command Center, no Workshop, no Wikipedia, no admin — it's only chat against your local models. Useful for a quick session on someone else's Mac or your travel laptop without committing to a full install.

The quick-chat.sh on your drive is regenerated each time you run `nomad install` on the source Mac, so a re-install picks up any bootstrap improvements from newer N.O.M.A.D. versions.

---

## Backups

The drive is your backup, but the drive can fail. If you care about the data, here's the realistic split:

- **AI models** — re-downloadable from `ollama.com/library`. Skip from your backup.
- **Wikipedia / Kolibri / reference ZIMs** — re-downloadable via Easy Setup. Skip.
- **Maps** — re-downloadable via the Maps Manager. Skip.
- **Your notes, your Workshop STL library, your RAG documents** — these are yours. Back them up.

The notes live on the drive at `storage/flatnotes/`. Your STL library is at `storage/stl-library/`. RAG uploads are at `storage/kb_uploads/`. Time Machine handles these correctly. So does `rsync` to a second drive, or a `tar` or `zip` archive — they're just files.

The MySQL database on internal disk holds the system configuration (which apps are installed, where ZIMs live in the catalog, RAG embedding indices) but not user-authored content. If you wipe and reinstall, the system rebuilds the catalog from what's on the drive. The data drive itself is the durable record.
