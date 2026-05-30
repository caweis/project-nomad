# Wedged-drive recovery — on-device checklist (Mac mini M4 / external APFS drive)

A real APFS wedge can't be faked in CI. Verify on hardware:

- [ ] **Healthy baseline:** drive mounted + healthy → `nomad reset-ollama` →
      no marker file, daemon serves drive models. Confirm:
      `ls ~/.config/project-nomad/.force-internal-models` → not found;
      `curl -fsS localhost:11434/api/tags | jq '.models|length'` > 0.
- [ ] **Wedge fallback:** induce/observe the wedge (deep read of
      `$DRIVE/ollama-models/manifests/...` hangs) → `nomad reset-ollama` →
      returns in seconds (not 30s+), marker file created, API responds.
      If internal store was empty, auto-pull ran and downshifted if the boot
      drive was tight (watch the "RAM tier … → pulling …" log line).
- [ ] **Restore refused while wedged:** `nomad reset-ollama --drive` while still
      wedged → refused with the "physically unplug/replug" message; marker
      unchanged; daemon stays on internal.
- [ ] **Auto-restore after replug:** physically unplug → wait 10s → replug →
      confirm deep read returns instantly → `nomad reset-ollama` → marker
      cleared, daemon back on drive models, "restored to drive-backed models".
- [ ] **Explicit internal:** `nomad reset-ollama --internal` on a healthy drive
      → marker set, daemon on internal (forces internal regardless of probe).
- [ ] **KeepAlive durability:** with the marker set, `pkill -9 -f 'ollama serve'`
      → launchd respawns via the launcher → still internal (launcher honored the
      marker, no manual reset needed).
- [ ] **Field Desk coexistence:** with Field Desk running (once restored in ②),
      run a recovery → Field Desk AI Chat still reaches :11434 afterward.
