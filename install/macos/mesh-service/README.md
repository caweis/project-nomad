# NOMAD Mesh Bridge

Connects a LoRa mesh radio (Meshtastic or MeshCore) to NOMAD's onboard AI, so
someone off-grid can text a question and get an answer back over the radio.

## Status

P0 is built: the hardware-free core (chunker, safety router, trigger gate, rate
limiter, responder loop) plus a mock adapter, all unit-tested. The FastAPI service
runs end to end against the mock with no radio attached.

Planned next (P1 onward): the Meshtastic adapter, a host serial-to-TCP bridge, the
MeshCore adapter, and the admin console with outbound alerts. The full plan is in
`docs/superpowers/plans/2026-06-15-nomad-mesh.md`.

## Tests (no dependencies needed)

```
cd install/macos/mesh-service
python3 -m unittest discover -s tests -t .
```

## Running the service (needs the dependencies)

```
pip install -r requirements.txt
uvicorn mesh_service.app:app --port 8600
```

`GET /health` reports status. `POST /debug/inject {text, sender, is_direct}` pushes
a synthetic message through the loop, and `GET /sent` shows what the bridge replied
on the mock adapter.

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
