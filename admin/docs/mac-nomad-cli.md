# The `nomad` command

When you install N.O.M.A.D. on your Mac, the installer puts a `nomad` command on your PATH (symlinked into Homebrew's `bin` directory). That command is the host-side companion to the Command Center — it handles everything that has to happen outside the browser: installing, upgrading, repairing, diagnosing, managing.

You don't have to use any of these commands for normal operation. Everything also works from the Command Center in your browser. But if you live in Terminal, this is the faster path.

```
nomad --help        Quick reference for every subcommand.
man nomad           Full manual page.
```

---

## Lifecycle

These commands start, stop, and restart the N.O.M.A.D. stack.

```
nomad install [opts]     Full install. Idempotent — also fixes broken state.
nomad up                 Start the stack (containers + AI Assistant).
nomad down               Stop the stack. Native Ollama keeps running.
nomad restart [SVC]      Restart a service. Default is the Command Center (admin).
nomad logs [SVC]         Tail logs for a service. Default is the Command Center.
```

`SVC` is the service name as it appears in `docker ps` (e.g., `admin`, `kiwix`, `kolibri`). You can also use the friendly short names — `nomad restart kiwix` does the right thing.

---

## Content

These commands manage what's stored on your drive.

```
nomad models                       List installed AI models with per-Mac fit verdict.
nomad models pull TIER             Pull a tier preset (tiny/small/medium/large/xl/dreamy).
nomad models pull NAME [NAME ...]  Pull specific named models.
nomad upgrade-models               Re-pull installed models at their latest tags.

nomad zim list                     List installed ZIM files (Information Library content).
nomad zim wikipedia                Wikipedia variant management (state | select).
nomad zim remote                   Browse the remote ZIM catalog (Kiwix.org).

nomad downloads list               Show your job queue (ZIM downloads, model pulls).
nomad downloads cancel ID          Cancel a queued or in-progress download.
nomad downloads remove ID          Remove a completed or failed job from history.

nomad stl list                     Workshop STL library — admin's catalog.
nomad stl scan                     Rescan storage/stl-library on disk.
nomad stl import DIR [CATEGORY]    Bulk import .stl/.3mf files into the library.
nomad stl path                     Print the library root on this host.

nomad services list                Admin-spawned content services (Kiwix, Kolibri, etc.).
nomad services install NAME        Install a service (admin spawns the container).
nomad services affect ACTION NAME  start | stop | restart a service.
```

---

## Diagnostics

When something isn't working, start here.

```
nomad check                Full diagnostic (system + stack + install) with flagged issues.
nomad check system         Just system-level checks (RAM, disk, OS version, ports).
nomad check stack          Container + LaunchAgent health.
nomad check install        Pre-flight inventory (used before install to see what's there).

nomad system info          The Command Center's view of your host (RAM, CPU, GPU).
nomad system debug         Detailed system info for support.
nomad system internet      Check connectivity status.

nomad api PATH [BODY]      Raw call to any Command Center API endpoint.

nomad benchmark            Native Metal vs container Rosetta token-per-second comparison.
nomad benchmark patch-host Backfill the leaderboard with this Mac's chip info.
```

`nomad check` runs all the section checks and writes a detailed log under `/tmp/`. Most issues surface here.

---

## Maintenance

Keeping things running over time.

```
nomad self-update           Refresh the `nomad` CLI script from the repo.

nomad upgrade               Upgrade everything (admin stack + Ollama + content services).
nomad upgrade admin         Just the Command Center container (also: mysql, redis, dozzle, updater).
nomad upgrade ollama        Just the AI Assistant runtime (Homebrew upgrade).
nomad upgrade SVC           A specific service (kiwix, kolibri, cyberchef, flatnotes, etc.).
nomad upgrade --check       Dry run — show what would change, change nothing.

nomad orbstack-tune [GB]    Adjust OrbStack's RAM allocation. Default is 80% of host.
nomad reset-ollama          Recover from a stuck AI Assistant.
nomad fix-kiwix             Manually run the kiwix partial-download recovery pass.

nomad clean                 Show what would be cleaned (logs, dangling images, partials).
nomad clean --apply         Actually clean. Safe — never touches running data.
```

`nomad self-update` resolves its install path automatically — works whether the script lives in a GitHub tarball extract, a git clone, or a custom location. `nomad install` and `nomad reinstall` run it implicitly before doing their work, so the CLI stays current as a side effect of installing.

The kiwix self-heal also runs every 60 seconds in the background via a LaunchAgent, so `nomad fix-kiwix` is just the manual trigger if you want it to happen now.

---

## Recovery

When you want a fresh start.

```
nomad uninstall             Remove containers, agents, secrets. Optionally wipes the drive.
nomad reinstall             Full wipe + reinstall in one shot. One confirmation prompt.
```

`nomad reinstall` is the nuclear option — wipes everything (containers, mysql data, ollama models, ZIM library, everything) and runs a fresh install. Use it when something is so broken that an idempotent re-install of `nomad install` can't fix it.

`nomad uninstall` is more surgical — removes the N.O.M.A.D. state but lets you decide what to do with the data drive contents separately.

Brew tools (Ollama, OrbStack, jq) and your bundle directory are never removed by either command — those are user-level installs that other things on your Mac might depend on.
