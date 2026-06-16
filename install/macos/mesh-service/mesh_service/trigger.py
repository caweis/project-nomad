"""Trigger gating + bot-loop guard.

Command-gated: the bridge never auto-replies to all traffic. In a group/broadcast
channel a message must explicitly mention the trigger (default '@ai'); a direct
message to the gateway node is itself an explicit address, so it needs no mention
(DM-first). Our own node's messages are ignored so two bots — or a bot plus an
auto-responder — cannot loop.
"""

from __future__ import annotations

import re

from .adapter import IncomingMessage

DEFAULT_TRIGGER = "@ai"


def should_respond(
    message: IncomingMessage,
    *,
    our_node_id: str | None,
    trigger: str = DEFAULT_TRIGGER,
    require_mention_in_channel: bool = True,
) -> tuple[bool, str]:
    """Return (respond?, cleaned_query). When respond? is False, query is ""."""
    # Bot-loop guard: ignore our own outbound echoed back to us.
    if our_node_id is not None and message.sender.node_id == our_node_id:
        return (False, "")

    text = message.text or ""
    has_trigger = trigger.lower() in text.lower()
    query = _strip_trigger(text, trigger) if has_trigger else " ".join(text.split())

    if message.is_direct:
        # A DM is an explicit address; respond with or without the trigger.
        return (bool(query), query if query else "")

    # Channel / broadcast: require the explicit mention unless configured otherwise.
    if require_mention_in_channel and not has_trigger:
        return (False, "")
    return (bool(query), query if query else "")


def _strip_trigger(text: str, trigger: str) -> str:
    stripped = re.sub(re.escape(trigger), " ", text, flags=re.IGNORECASE)
    return " ".join(stripped.split())
