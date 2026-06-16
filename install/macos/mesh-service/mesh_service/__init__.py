"""NOMAD mesh bridge — connects a LoRa mesh radio to the onboard AI.

P0 ships the hardware-free core: the LoRa chunker, the trigger gate, the rate
limiter, the safety router, a mock mesh adapter, and the responder loop that ties
them together. Real radios (Meshtastic, MeshCore) arrive in later phases behind
the same narrow MeshAdapter interface.
"""
