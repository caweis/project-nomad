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

## Both protocols — a narrow interface, NOT a unified abstraction

Adversarial research (verified 2026-06-15 against primary sources) killed the "one `MeshAdapter`
hides the protocol" idea. The only real-world Meshtastic↔MeshCore bridge (AkitaEngineering) uses
*separate per-protocol handlers*, and a unified abstraction leaks at four seams. So: a **deliberately
narrow common interface** with **two explicit implementations**, protocol differences surfaced as
**capability flags**, not flattened.

- Interface: `connect()`, `sendText(to, body)`, `onMessage(cb)`, `listContacts()`, plus capability
  descriptors `identityKind`, `maxTextBytes` (runtime-queried, not hardcoded), `ackSupport`.
- **Meshtastic** (`meshtastic-py`) — synchronous: daemon reader thread + PyPubSub callbacks on that
  thread. `TCPInterface(hostname, 4403)`; `sendText(text, destinationId, channelIndex)`.
- **MeshCore** (`meshcore-py`) — asyncio-native. Run it on its OWN dedicated asyncio loop thread; hand
  messages across the thread↔loop boundary via a thread-safe queue. Never call an async MeshCore
  command from a Meshtastic PyPubSub callback. `MeshCore.create_tcp(host, 4000)`.

**Four seams the interface must NOT flatten** (each verified):
1. **Concurrency** — Meshtastic sync/threads vs MeshCore asyncio. Isolate the loops; queue across.
2. **Identity** — Meshtastic stable `!hexid`; MeshCore 6-byte pubkey-prefix (collision-prone) for DMs
   and *no sender id at all* on channel messages. Model identity as `{protocol, nodeId?|pubkeyPrefix?,
   name}`; make "unknown/ambiguous sender" a first-class state.
3. **Payload size** — per-implementation, runtime-queried; MeshCore publishes no fixed number. Don't
   hardcode 133/200; enforce conservatively with an explicit truncate/fragment/reject policy.
4. **Delivery/ACK** — protocol-specific status enum, "unknown" not "delivered"; never a single bool.

**Dependency discipline (MeshCore is Beta).** `meshcore-py` is self-classified Development Status 4
(Beta), ~15 months old (created 2025-03, active), with a point release that broke message-receive
(issue #81) and a root-logger hygiene smell (#58). So: pin exact versions (`meshcore==2.3.7`,
`meshtastic==<pinned>`), track MeshCore by commit SHA, gate every bump behind an integration test that
round-trips a real/simulated message, and re-assert our logging config on import (or isolate MeshCore
in a worker). Ship Meshtastic first; add MeshCore behind the same narrow seam (P3).

## Packaging — mimic upstream's Supply Depot (and add Meshtastic Web)

Decided 2026-06-15 (after the upstream maintainer flagged the overlap): adopt upstream's **Supply
Depot** container model (`v1.33.0-rc.1`) — a curated app catalog that also supports bring-your-own
containers — as the surface for all mesh apps, mirroring their containerized-app pattern.

- **Add Meshtastic Web** — the official Meshtastic web client (the node management UI), containerized
  and cataloged as a Supply Depot app, mirroring upstream's "Meshtastic Web." This is the node's web
  console, *not* our AI bridge — additive, and an easy first win that keeps the two forks lined up.
- **Our AI bridge + MeshCore surface as Supply Depot containers**, not via the old `service_seeder`/
  `apps.tsx` path. The `nomad_mesh` service becomes a Supply Depot entry.

This aligns the fork with where upstream is going and makes the mesh work the cleanest thing to hand
upstream eventually. **Prerequisite:** forward-port / adopt the Supply Depot catalog from upstream
(ties to #24); its exact catalog format and custom-container mechanism are being mapped from the
`v1.33.0-rc.1` code so we mimic it faithfully.

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

> Build patterns (chunking, ACK pacing, reconnect, safe prompting, Docker hardening) are distilled
> with citations in `2026-06-15-nomad-mesh-research.md` — the build guide for P0–P4.

### Phase S — Supply Depot foundation + Meshtastic Web
**Approach (decided 2026-06-15): forward-port and reconcile by hand.** Port upstream's data model
(`is_custom` + `category` columns on the `services` table), the `supply-depot.tsx` page, the
curated-catalog pattern, and the per-app docs model; reconcile against our diverged `services` code
(drug reference, macOS-specific services) by hand. Map the upstream implementation first
(`admin/app/controllers/supply_depot_controller.ts`, the supply-depot + curated-collections migrations,
`admin/inertia/pages/supply-depot.tsx`, the curated catalog seed), then port.

**Apps in two waves** (mesh leads; third-party app porting must not block it):
- **Wave 1 (this phase):** Supply Depot infra + **Meshtastic Web** (one real curated app validates the
  pipeline and mirrors upstream).
- **Wave 2 (after the mesh bridge):** port upstream's curated catalog as a *vetted* batch — Stirling PDF,
  File Browser, Calibre-Web, IT Tools, and the others their services carry (Kolibri, CyberChef, Flatnotes;
  ~8–9 total). **Vet each on arm64/OrbStack before shipping** — some upstream services don't port to macOS
  Docker (cf. `disk-collector`, removed for file-sharing incompatibility). Adopt what's clean; skip what isn't.

This is the surface every mesh app rides on (the `nomad_mesh` service becomes a Supply Depot entry).

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
