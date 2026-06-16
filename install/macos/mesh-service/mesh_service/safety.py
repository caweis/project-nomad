"""Safety model for AI-over-radio answers.

A confident wrong answer reaching someone off-grid, with no second source, can get
them hurt. So:

1. The highest-stakes queries (not breathing, severe bleeding, chest pain,
   anaphylaxis, unresponsive, choking, stroke) are HARD-ROUTED to fixed,
   human-vetted canned messages — the model never freelances a life-threat
   (the single most important decision in the feature).
2. Everything else goes to the AI under a terse, abstention-rewarded system
   prompt that tells it to say "not sure" rather than guess.
3. Model output is sanitized for the radio (no markdown / reasoning / emoji).
4. A one-time disclaimer is sent on first contact.

NOTE: the canned messages below are conservative, standard first-aid guidance that
always directs to professional help. They are DRAFT pending review by a qualified
medical professional before production. The safety *behavior* (route away from the
AI, always say "get a human/EMS now") is what this module guarantees; the exact
wording is for a clinician to sign off.
"""

from __future__ import annotations

import re

# Severity / confidence prefixes (1 char, so they cost almost no airtime).
PREFIX_LIFE_THREAT = "!"
PREFIX_LOW_CONFIDENCE = "?"

# Each pattern maps a life-threatening situation to a canned message key. Patterns
# are intentionally broad: a false positive sends a "get help now" message, which is
# the safe direction to err.
_EMERGENCY_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("not_breathing", re.compile(r"\b(not|stopped|isn't|isnt|no longer)\s+breath", re.I)),
    ("no_pulse", re.compile(r"\bno\s+(pulse|heartbeat)\b", re.I)),
    # Choking is checked before the generic "can't breathe" so it gets its own
    # (back-blows/thrusts) message rather than the CPR one.
    ("choking", re.compile(r"\bchoking\b", re.I)),
    ("not_breathing", re.compile(r"\b(can't|cant|cannot)\s+breath", re.I)),
    ("severe_bleeding", re.compile(r"\b(severe|heavy|bad(ly)?|won't stop|wont stop|profuse)\s+bleed", re.I)),
    ("severe_bleeding", re.compile(r"\b(hemorrhag|haemorrhag|bleeding out|gushing blood)", re.I)),
    ("chest_pain", re.compile(r"\b(chest pain|heart attack|crushing chest)\b", re.I)),
    ("anaphylaxis", re.compile(r"\b(anaphylax|epipen|throat (is )?clos|severe allergic)", re.I)),
    ("unresponsive", re.compile(r"\b(unconscious|unresponsive|won't wake|wont wake|passed out)\b", re.I)),
    ("stroke", re.compile(r"\b(stroke|face droop|slurred speech|one side.*numb)\b", re.I)),
]

# DRAFT canned messages — conservative, action-first, always "get help now". Each is
# kept under ~200 bytes so it rides one packet. Pending clinician review.
CANNED_RESPONSES: dict[str, str] = {
    "not_breathing": (
        "! Not breathing: start CPR now. Push hard & fast, center of chest, "
        "100-120/min. Send someone for help/AED. Don't stop until help arrives."
    ),
    "no_pulse": (
        "! No pulse: start CPR now. Hard & fast on center of chest, 100-120/min. "
        "Get help/AED immediately. Don't stop until help arrives."
    ),
    "severe_bleeding": (
        "! Severe bleeding: press hard on the wound with cloth and don't let up. "
        "Raise the limb if you can. Get to a medic/EMS now."
    ),
    "chest_pain": (
        "! Chest pain may be a heart attack. Have them sit and rest; chew one "
        "aspirin if not allergic. Get EMS/help immediately."
    ),
    "anaphylaxis": (
        "! Severe allergic reaction: use an epinephrine auto-injector (EpiPen) in "
        "the outer thigh now if available. Get EMS. Watch their breathing."
    ),
    "unresponsive": (
        "! Unresponsive: check breathing. If breathing, roll onto their side. If "
        "not, start CPR. Get help/EMS now."
    ),
    "choking": (
        "! Choking and can't breathe: give firm back blows between the shoulder "
        "blades, then abdominal thrusts. Get help/EMS now."
    ),
    "stroke": (
        "! Possible stroke. Note the time symptoms started. Keep them still and "
        "get EMS/help immediately — minutes matter."
    ),
}

LORA_SYSTEM_PROMPT = (
    "You are NOMAD's mesh-radio assistant, reached over a tiny LoRa link by someone "
    "who may be off-grid. Answer in 200 bytes or fewer, plain text, no markdown, no "
    "emoji, most important thing first. If you are unsure, start with 'Not sure -' "
    "and say what to check; never give a confident guess. A wrong confident answer "
    "can get someone hurt, but 'I don't know' cannot. If your confidence is low, "
    "start the message with '?'. You are a convenience, not a safety system; for "
    "anything life-threatening, tell them to seek a human or EMS."
)

FIRST_CONTACT_DISCLAIMER = (
    "AI helper over radio. Answers may be WRONG and there's no 2nd source out here - "
    "verify before acting. Not a doctor. Life-threat: get a human."
)


def classify_emergency(text: str) -> str | None:
    """Return an emergency key if `text` looks life-threatening, else None."""
    for key, pattern in _EMERGENCY_PATTERNS:
        if pattern.search(text):
            return key
    return None


def route_query(text: str) -> str | None:
    """Canned response for a life-threatening query, or None to let the AI answer."""
    key = classify_emergency(text)
    return CANNED_RESPONSES.get(key) if key else None


_THINK_BLOCK = re.compile(r"<think(ing)?>.*?</think(ing)?>", re.I | re.S)
_MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]+\)")
_MD_CRUFT = re.compile(r"[*_`#>|]+")
# Keep printable ASCII + common Latin punctuation; drop emoji and control chars.
_NON_RADIO = re.compile(r"[^\x09\x0A\x20-\x7E -ɏ]")


def sanitize_model_output(text: str) -> str:
    """Strip reasoning blocks, markdown, and emoji so the reply is radio-clean."""
    text = _THINK_BLOCK.sub("", text)
    text = _MD_LINK.sub(r"\1", text)  # [label](url) -> label
    text = _MD_CRUFT.sub("", text)
    text = _NON_RADIO.sub("", text)
    return " ".join(text.split()).strip()
