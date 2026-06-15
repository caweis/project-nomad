# NOMAD Mesh — deep-research findings (build guide)

> Cited research (2026-06-15) backing the design in `2026-06-15-nomad-mesh.md`. Adversarially
> verified where it mattered. This is the "what to actually build" distillation.

## 0. The one design verdict (adversarially verified, primary sources)

Do **not** build one unified `MeshAdapter` that hides the protocol. The only real Meshtastic↔MeshCore
bridge (AkitaEngineering) uses separate per-protocol handlers; a unified abstraction leaks at four
seams: sync/threads (Meshtastic) vs asyncio (MeshCore); incompatible identity (`!hexid` vs collision-
prone pubkey-prefix, no sender id on MeshCore channel msgs); non-constant payload limits; divergent
ACK semantics. **Narrow interface + two explicit implementations + capability flags.** `meshcore-py`
is Beta (Dev Status 4, a point release broke message-receive, #81) → pin exact versions, gate bumps
behind an integration test, re-assert logging on import (#58), ship Meshtastic first.

## 1. Bridge implementation — ADOPT (from production bridges)

- **Never call the LLM in the receive callback.** Push to a `queue.Queue` drained by a **single** LLM
  worker thread (one local model, no GPU thrash). (HDI Meshtastic-LLM `ollama-worker`; mesh-ai daemon-thread)
- **Chunk, don't truncate.** Word-boundary split by **UTF-8 byte length** at ~200B; reject the break if
  it lands before ~40–50% (else hard-cut); suffix `[i/N]`; cap total parts (`MAX_CHUNKS=5`) to protect
  the mesh. (mesh-ai, HDI, MeshClaw, Timendus)
- **ACK-aware pacing with a timeout fallback.** Send `wantAck=True`, block on the delivery ACK/NAK
  (`errorReason=='NONE'`) or timeout, then send the next part; fixed 1.5–10s inter-chunk delay only as
  the fallback. Never gate progress on ACKs with no timeout (Timendus broke on firmware 2.5+). (Timendus)
- **Durable, per-message retry queue** with exponential backoff (`min(300, base*2**(n-1))`), persisted
  so it survives crashes — right model for an intermittent radio. (HDI)
- **Robust reconnect:** a `reset_event` flag + 1s watchdog; capped backoff (5→×2→60s); wrap the blocking
  connect in a timeout thread (so an unreachable TCP node can't hang); a global `threading.excepthook`
  that trips reconnect on any worker crash; subscribe to `connection.LOST` (not just `.established`);
  transport fallback order. (mesh-ai, Timendus)
- **LoRa-aware system prompt** (answer <200B, plain text, no markdown/emoji, most-important-first) +
  **output sanitization** (strip `<think>`/reasoning/markdown/tables, normalize to printable ASCII).
  Mandatory with reasoning models. (MeshClaw `LORA_SYSTEM_HINT`, mesh-ai `sanitize_model_output`)
- **Per-node memory** keyed by node id, bounded window (~5) + a per-thread **reply cooldown** (~120s)
  + a lock on shared context. (recalde, HDI, fiquett)
- **Access control:** don't auto-answer LongFast/ch0 by default; require an `@mention` in group channels;
  DM/group allowlists; a **bot-loop guard** (tag our own msgs, track node ids). (mesh-ai, MeshClaw)

### AVOID
Truncating instead of chunking · raw fixed-width slicing with no pacing (radio-llm floods airtime) ·
pubsub-only with no reconnect/watchdog · ACK-dependence with no timeout · sending markdown/emoji/long
reasoning verbatim over LoRa.

## 2. Docker isolation

Three containers on a custom network: **(a)** serial→TCP bridge owning `/dev/ttyUSB0`, **(b)** the
local LLM API, **(c)** the Python mesh service — TCP/HTTP only, **no `--device`, no host mounts, no
docker socket.** Service image: multi-stage, `gcr.io/distroless/python3` (glibc, non-root, no shell;
`python:slim` fallback if a dep needs apt libs; avoid Alpine for compiled deps). Hardening: `USER`
non-root, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--read-only` + tmpfs, keep
seccomp/AppArmor on, `--pids-limit`, ulimits, resource limits (`--memory`, `--cpus`), HEALTHCHECK,
`--restart=on-failure`. **For the bridge, use `Yeraze/meshtastic-serial-bridge` (socat-backed, auto-
reconnect) or `meshtasticd` — do NOT hand-roll an asyncio serial shim** (re-introduces the device-stall
bugs socat already solved). On NOMAD/macOS the bridge is the host LaunchAgent (OrbStack can't see USB).

## 3. MeshCore (`meshcore-py`) usage notes

`create_tcp(host, port)` — **port is required** (5000 common on wifi-companion firmware; docs show 4000;
confirm per node). Commands return **Events, not exceptions** — branch on `result.is_error()`. **Must
call `await mc.start_auto_message_fetching()`** to receive inbound (subscription alone doesn't poll).
ACK: capture `expected_ack` from `send_msg`, `await wait_for_event(EventType.ACK, ...)`. `auto_reconnect=
True`, gate sends on `is_connected`. Structure as `asyncio.run(main())` + keep-alive; cache contacts
(`ensure_contacts()`), resolve locally (`get_contact_by_key_prefix`).

## 4. Safe answers over radio (preparedness/medical) — the critical part

- **Two-layer brevity:** graduated-brevity system prompt + a hard budget (`<=40 words / <=180 chars,
  one message, no preamble`); `max_tokens` only as a non-truncating backstop.
- **Rewarded abstention + hedge path** (NOT "only state facts you're certain of" — research shows that
  phrasing *increases* hallucination): *"If unsure, reply 'Not sure — ' + what to check, never a confident
  guess. A wrong confident answer can get someone hurt; 'I don't know' cannot. Low confidence → prefix '?'.
  Life-threat → prefix '!' and say to seek a human/EMS."*
- **Disclaimer once on first contact**, in one packet, not appended to every reply: *"AI helper. Answers
  may be WRONG and there's no 2nd source out here — verify before acting. Not a doctor. Life-threat: get a
  human."* Per-answer overhead capped at a 1-char confidence/severity prefix.
- **Hard-route the highest-stakes queries** (severe bleeding, not breathing, chest pain, anaphylaxis,
  unconsciousness) to **fixed, human-vetted canned messages** — remove the model's freedom where a confident
  hallucination is most lethal. *(This is the single most important safety decision in the whole feature.)*
- **Lead-with-action structure** (directive in the first ~10 words, survives truncation/relay loss).
- **Off LongFast by default**; honest about model tier (small models hedge/abstain more aggressively).

## Sources
mr-tbot/mesh-ai · High-Desert-Institute/Meshtastic-LLM · Timendus/meshbot · Seeed-Solution/MeshClaw ·
recalde/meshtastic-ollama-chatbot · fiquett/llm-meshtastic-bridge · pham-tuan-binh/radio-llm ·
meshcore-dev/meshcore_py (+ deepwiki, PyPI, GitHub API, issues #58/#59/#81/#83/#89) · meshtastic/python ·
meshtastic.org/docs · Yeraze/meshtastic-serial-bridge · AkitaEngineering/Akita-Meshtastic-Meshcore-Bridge.
(Gap: a dedicated no-hardware-testing pass failed twice on a transient API error — meshtasticd virtual
node + TCP stub + mocked LLM is the known approach; to be confirmed in the build session.)
