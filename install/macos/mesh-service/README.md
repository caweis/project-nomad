# NOMAD Mesh Bridge

Connects a LoRa mesh radio (Meshtastic or MeshCore) to NOMAD's onboard AI, so
someone off-grid can text a question and get an answer back over the radio.

## Status

P0 is built: the hardware-free core (chunker, safety router, trigger gate, rate
limiter, responder loop) plus a mock adapter, all unit-tested. The FastAPI service
runs end to end against the mock with no radio attached.

P1 is built: the Meshtastic adapter over `TCPInterface`, the receive path on
PyPubSub, airtime pacing that waits for each part's delivery ACK (or times out
without hanging), and an integration test that runs the real adapter against a
high-fidelity fake TCP interface wired to the real responder. The adapter is
selected by config (`MESH_ADAPTER`); the default stays the mock, so nothing here
needs a radio. P3 ships a MeshCore scaffold (opt-in guarded, not production) and P4
adds the `/status` and `/messages` console endpoints.

Deferred from P1 (tracked as GitHub issues): a durable per-message retry queue and a
reconnect watchdog with backoff. Both are hardware-gated. They need a real radio to
validate, so they wait for the host serial-to-TCP bridge (P2).

Planned next: the host serial-to-TCP bridge (P2), the full MeshCore adapter (P3), and
the admin console UI with outbound alerts (P4). The full plan is in
`docs/superpowers/plans/2026-06-15-nomad-mesh.md`.

## Tests

The hardware-free suites run on a plain interpreter with no dependencies:

```
cd install/macos/mesh-service
python3 -m unittest discover -s tests -t .
```

The Meshtastic adapter, the fake-TCP-interface, and the FastAPI endpoint tests need
the runtime dependencies (meshtastic, fastapi, pubsub). Run them in a venv:

```
cd install/macos/mesh-service
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -t .
```

`meshtastic==2.7.9` installs from PyPI wheels on Python 3.14 (arm64). If a future
Python lacks a wheel, fall back to `python3.12 -m venv .venv`.

## Running the service (needs the dependencies)

```
pip install -r requirements.txt
uvicorn mesh_service.app:app --port 8600
```

Default config runs the mock adapter. To drive a real Meshtastic radio over TCP, set
`MESH_ADAPTER=meshtastic`, `MESH_RADIO_HOST`, and `MESH_RADIO_PORT` (default 4403).

`GET /health` and `GET /status` report state (the latter adds connection status and a
recent-message ring buffer). `GET /messages` returns recent inbound and outbound
traffic. `POST /debug/inject {text, sender, is_direct}` pushes a synthetic message
through the loop. `POST /send {to, body}` is the one outbound path, and `GET /sent`
shows what the bridge replied on the mock adapter.

## How it reaches the AI

The container calls `${NOMAD_OLLAMA_URL}`, the OpenAI/Ollama-compatible API on the
host (`host.docker.internal:11434` for Ollama, `:11436` for oMLX), over the internal
Docker network. It needs no LAN access and no API key.

## Safety

The highest-stakes queries (not breathing, severe bleeding, chest pain,
anaphylaxis, unresponsive, choking, stroke) are routed to fixed canned messages, so
the AI never freelances a life-threat. That canned text is a draft and needs review
by a qualified medical professional before production. Every other answer runs under
a terse, abstention-rewarded prompt, and a one-time disclaimer goes out on first
contact.
