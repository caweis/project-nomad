# NOMAD Mesh — off-grid AI over LoRa (design + phased plan)

> **Status:** design for review (not yet approved). No implementation until Chris signs off.
> **Decided inputs (2026-06-15):** no radio hardware yet → design for it; support all three flows
> (AI responder, admin console, outbound alerts); both protocols (Meshtastic + MeshCore).

## Goal

Let people reach NOMAD's onboard AI — and NOMAD reach them — over an off-grid LoRa mesh,
so a user with no internet can text a question and get an answer back on the radio.

## Architecture

```
 LoRa radio (USB)                     ┌─ onboard AI (host LaunchAgents) ─┐
   │ serial                           │  host.docker.internal:           │
   ▼                                  │    11436 (oMLX) / 11434 (Ollama) │
 host-side serial→TCP bridge          └──────────────▲───────────────────┘
 (launchd LaunchAgent, like oMLX/Ollama)             │ OpenAI/Ollama-compatible API
   │ TCP :PORT  (bound 0.0.0.0)                       │
   ▼                                                  │
 nomad_mesh container ───── MeshAdapter ──────────────┘
   Meshtastic-py (TCP) / MeshCore-py (TCP)
   responder loop · admin console API · outbound alerts
```

**Why this shape.** An OrbStack container on macOS cannot see a host USB serial device — the
repo already encodes this boundary (oMLX, Ollama, and the host-command bridge all run as host
LaunchAgents precisely because they need host hardware). So the radio is driven by a host-side
process and exposed over TCP, and the container connects to a *configurable TCP endpoint*. With
no radio yet, that endpoint is a mock during development and a real bridge later — the container
never changes.

**Isolation (explicit requirement).** All logic lives inside the isolated `nomad_mesh` Docker
image — both mesh adapters, the AI client, the responder loop, the console API, and the entire
safety model. The host-side serial→TCP bridge is a *dumb pipe with zero business logic*; it exists
only because OrbStack can't pass a USB device into a container. So the feature is fully containerized
except for that unavoidable hardware shim, and the shim is trivially replaceable (a networked radio
needs no host process at all). The container runs least-privilege: no host mounts, no Docker socket,
talking only to the host serial-TCP endpoint and the local AI API.

**How it reaches the AI.** The container joins the `project-nomad_default` network, sets
`extra_hosts: ['host.docker.internal:host-gateway']`, and calls the OpenAI/Ollama-compatible API
at `${NOMAD_OLLAMA_URL}` (`http://host.docker.internal:11436` in oMLX mode, `:11434` in Ollama
mode) — the identical path `chat_service`/`rag_service` use. The AI is not LAN-exposed by default
(confirmed: `:11436`/`:11434` are unreachable from another LAN host); the mesh service reaches it
internally, which is the intended model.

## The three flows

1. **AI-over-radio responder.** A user DMs `@ai <question>` to the gateway node → the onboard AI
   answers → a terse, chunked reply goes back over LoRa to the sender (DM) or the originating channel.
2. **Admin mesh console.** Send/receive/monitor messages and nodes from the NOMAD admin (a page
   modeled on `/chat`), backed by the mesh service's HTTP API.
3. **Outbound alerts.** NOMAD pushes weather/status/scheduled messages to a mesh channel.

## Both protocols, one boundary

A single `MeshAdapter` interface (connect, send_text(dest, channel, text), subscribe(on_message),
list_nodes) with two implementations:

- **Meshtastic** — `meshtastic-py` (mature, de-facto official). `TCPInterface(hostname, 4403)`;
  receive via PyPubSub `meshtastic.receive.text`; send via `sendText(text, destinationId, channelIndex)`.
- **MeshCore** — `meshcore-py` (younger but viable; `meshcore-ha` + `meshcore-proxy` prove the path).
  `MeshCore.create_tcp(host, 4000)`; async-first.

Both converge on the same USB-radio → host-TCP-bridge → container-over-TCP topology, so the adapter
boundary makes the second protocol low-risk. Build Meshtastic first, MeshCore right after.

## Hard constraints (designed around, not wished away)

- **Payload.** Meshtastic ~200 bytes usable (233 hard cap); MeshCore 133 chars / 163-byte datagrams.
  → terse system prompt ("answer in ≤200 chars, 1–2 sentences, no preamble"), hard cap, and at most
  2–3 numbered chunks `(1/3)` for anything longer.
- **Airtime.** LoRa is slow, half-duplex, shared; EU duty-cycle can halt TX; send-queue backpressure
  exists. → an async outbound queue drained by a single worker with retry/backoff, per-node and global
  rate limits, and **DM-preferred** so we never congest the primary channel.

## Safety model (non-negotiable — preparedness/medical answers travel as authoritative)

- **Command-gated.** Never auto-reply to all traffic; fire only on an explicit `@ai` trigger. Ignore
  our own node ID and tag our own outbound messages, so two bots (or a bot + auto-responder) can't loop.
- **DM-first.** Default to NOT answering on the primary broadcast channel; richer Q&A goes to DMs.
- **Rate limits.** Per-node and global, to bound shared airtime.
- **AI posture.** A strict no-fabrication system prompt ("say you don't know rather than guess"), and a
  standing disclaimer on first contact / session start: *AI-generated, may be wrong, NOT for emergencies
  — keep backup comms.* The bot is a convenience, never a safety system. Genuine emergencies route to
  real channels, not the chatbot. (Every surveyed bridge ships exactly this posture; NOMAD's stakes are higher.)

## Phased plan — each phase ships something testable

### Phase 0 — Service skeleton + wiring (no radio needed)
A Python service (`install/macos/mesh-service/`, modeled on `omlx-proxy`) that exposes a small HTTP
API and an AI client, with a **mock mesh adapter** so the whole loop is testable without hardware.
- Service scaffold (FastAPI/uvicorn like the oMLX proxy), config via env.
- `AIClient` → `${NOMAD_OLLAMA_URL}` (OpenAI/Ollama-compatible), with the terse system prompt + chunker.
- `MeshAdapter` interface + a `MockAdapter` (in-memory send/receive) for tests.
- The responder loop wired to the mock: message in → trigger gate → AI → chunk → send out.
- Health endpoint + unit tests (chunker fidelity, trigger gating, rate limiter, mock round-trip).
- `nomad_mesh` block in `compose.yaml` (and the bundled installer payload copy), `:edge` image,
  `nomad_` name prefix, `extra_hosts`, `OLLAMA_HOST` env, a free host port.
- Apps tile via `service_seeder.ts` + `service_names.ts`.
- CI: extend the multi-arch image workflow to build the mesh image; tests in CI.

### Phase 1 — Meshtastic adapter + responder
- `MeshtasticAdapter` over `TCPInterface`, PyPubSub receive, reconnect handling.
- The full safety model (gating, DM-first, per-node/global rate limits, loop prevention, disclaimer).
- The async outbound queue + airtime pacing.
- Integration test against a Meshtastic TCP endpoint (a stub server or `meshtasticd` virtual node).

### Phase 2 — Host-side serial→TCP bridge (real USB radio)
- A launchd LaunchAgent in the `nomad` CLI (new LABEL/PLIST/SCRIPT, mirroring oMLX/Ollama/host-command-bridge)
  that opens the USB serial radio and serves it on a reserved host TCP port (added to `NOMAD_PORTS`).
- `run_cmd()` cases + `host_commands.ts` allowlist entry (kept in sync by the CI allowlist test) so the
  admin can start/stop/reset the bridge.
- Install/upgrade/uninstall lifecycle for the bridge in the CLI.

### Phase 3 — MeshCore adapter
- `MeshCoreAdapter` (`meshcore-py`, async) behind the same `MeshAdapter` interface, over TCP.
- Protocol-specific limits (133-char cap, backpressure handling).
- A `--protocol meshtastic|meshcore` (or per-radio) config; both can run side by side.

### Phase 4 — Admin console + outbound alerts
- A mesh console page under `admin/inertia/pages/mesh/` + controller + routes (modeled on `chat.tsx` +
  `ChatsController` + `/chat`): send/receive, node list, channel view.
- Outbound: an API + a scheduler for alerts/broadcasts (weather/status), with the same airtime pacing.

## Footprint (files)

- **New:** `install/macos/mesh-service/` (Python service + Dockerfile), `admin/inertia/pages/mesh/*` (P4).
- **Modified:** `install/macos/compose.yaml` (+ the bundled `installer-app/.../payload/compose.yaml` mirror),
  `install/macos/nomad` (bridge LaunchAgent, `NOMAD_PORTS`, `run_cmd`), `admin/constants/service_names.ts`,
  `admin/database/seeders/service_seeder.ts`, `admin/constants/host_commands.ts` +
  `install/macos/scripts/test-host-command-allowlist.sh`, `.github/workflows/build-nomad-macos-image.yml`
  (build the mesh image), and a controller + `admin/start/routes.ts` for P4.

## Scope: full build (decided 2026-06-15)

Chris: "go big or go home, let's do it all." All five phases, both protocols, all three flows.
The adapter boundary and the mock-first P0 still let us build and verify incrementally — full
scope, phased delivery, each phase shippable and tested in order P0 → P1 → P2 → P3 → P4.

## Risks

- **No hardware to validate against** until a radio arrives — mitigated by the mock adapter (P0) and a
  TCP stub / `meshtasticd` virtual node for integration tests.
- **MeshCore maturity** — `meshcore-py` is younger; the adapter boundary contains the risk, and P3 can
  slip without blocking P0–P2.
- **macOS USB boundary** — solved by the host-side bridge LaunchAgent (P2), the established NOMAD pattern.
- **Safety** — the AI-over-radio posture (gating, disclaimers, no-fabrication prompt) is built in from P1,
  not bolted on.
