# Updating your N.O.M.A.D.

When a new version of the Command Center, Ollama, or one of the content services (Kiwix, Kolibri, FlatNotes, CyberChef) is published, you update it from Terminal using the `nomad upgrade` command.

The Mac edition handles updates differently from the in-Command-Center "Start Update" button you may see on upstream installs. That button is designed for the upstream Docker-based Linux install and doesn't fit the Mac edition's mix of native and containerized software. On the Mac, you run `nomad upgrade` and it does the right thing for each piece.

---

## Updating everything

Most of the time, this is what you want:

```
nomad upgrade
```

That walks the full stack:

1. Pulls the latest container images for the Command Center, database, cache, and update sidecar.
2. Runs `brew upgrade ollama` to update the native AI Assistant runtime.
3. Restarts everything cleanly.

Total time is usually 1–5 minutes depending on how big the new images are. While it's running, the Command Center will be briefly unavailable.

---

## Just the Command Center

If you only want to update the admin interface and its database/cache (not Ollama, not content services):

```
nomad upgrade compose
```

This is the most common upgrade. The Command Center is the most actively developed piece, so it gets new features and bug fixes more often than the content services.

---

## Just the AI Assistant

If you only want to update Ollama (and your downloaded models stay):

```
nomad upgrade ollama
```

That runs `brew update` and `brew upgrade ollama`, then reloads the background service. Your models are preserved across the upgrade — Ollama maintains backward compatibility within a major version.

After the upgrade, `nomad upgrade ollama` waits up to 30 seconds for the AI Assistant API on `:11434` to come back up before declaring success. If it doesn't come back, you'll see the actual error from the daemon log so you can diagnose.

---

## A specific content service

To upgrade Kiwix, Kolibri, FlatNotes, CyberChef, or another admin-spawned service:

```
nomad upgrade kiwix
nomad upgrade kolibri
nomad upgrade flatnotes
nomad upgrade cyberchef
```

This pulls the latest image for that service, removes the existing container, and lets the Command Center re-spawn it with the new image. Your content (ZIM files for Kiwix, channels for Kolibri, notes for FlatNotes) is preserved.

Before pulling, the command checks whether the service is mid-job (an active ZIM download for Kiwix, for instance). If it is, the upgrade pauses with a clear message — you can either wait for the job to finish or pass `--force` to upgrade anyway. Letting an active download finish is usually safer.

---

## Dry run

If you just want to see what would change without actually changing anything:

```
nomad upgrade --check
```

Same for any specific target:

```
nomad upgrade ollama --check
nomad upgrade kiwix --check
```

The `--check` flag shows current versions, what's available, and what the upgrade command would do — without pulling anything or restarting anything.

---

## When the Settings → Updates page in the Command Center says "Update Failed"

On the Mac edition, the in-Command-Center update mechanism is disabled in favor of the `nomad upgrade` path described above. The Settings → Updates page shows a card with the host-CLI commands you should use, and the "Start Update" button is hidden.

If you somehow see the old "Update Failed" message anyway, it's the upstream self-updater complaining about not being able to rewrite a Docker image tag that doesn't match its expected pattern. That's expected on the Mac edition — ignore the message and use `nomad upgrade compose` instead.

---

## What happens during an update

Most updates take about a minute, with a brief moment where the Command Center is unavailable while the new container starts. Your data is never touched — only the application binaries change.

If anything goes wrong during an update, the `nomad upgrade` command logs everything to `/tmp/nomad-upgrade-<timestamp>.log` so you can see what happened. Most issues resolve by running the same upgrade command again — it's idempotent.

If a major upgrade actually breaks something (rare, but possible), see [the `nomad` command reference](/docs/mac-nomad-cli) for the recovery commands (`reset-ollama`, `fix-kiwix`, and the nuclear `reinstall`).
