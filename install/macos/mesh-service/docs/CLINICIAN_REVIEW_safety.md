# Clinician review: mesh canned medical text

This is a review harness, not an approval. It lays out every piece of fixed
medical text in `mesh_service/safety.py` so a qualified clinician can sign off on
the wording. Nothing here is cleared for production. No engineer or AI may approve
or rewrite the clinical content — that is the reviewer's job, and it is human-gated
(see section F).

Source file under review: `install/macos/mesh-service/mesh_service/safety.py`
Behavioral tests: `install/macos/mesh-service/tests/test_safety.py`

How to read this: sections A–E give you the text and the questions to answer.
Section F is where you record your decision and signature.

---

## A. Scope — what the code already guarantees vs. what needs your sign-off

The safety module makes two kinds of promises. One kind is enforced by code and
covered by automated tests. The other kind — whether the medical wording is
correct — can only come from you.

### Already enforced by the module (behavior)

These are structural guarantees. The tests in `tests/test_safety.py` already cover
them, and they passed at the time this packet was assembled (7 tests, OK).

1. **Eight life-threat situations are hard-routed away from the AI.** When a query
   matches one of the emergency patterns (not breathing, no pulse, severe bleeding,
   chest pain, anaphylaxis, unresponsive, choking, stroke), the model never
   answers. A fixed canned message is returned instead. The model cannot freelance
   on a life-threat.
2. **Every canned message directs to EMS or a human.** A test asserts each message
   contains one of `ems`, `help`, `human`, or `medic`. The "go get real help"
   instruction cannot be edited out without breaking the build.
3. **Every canned message leads with the `!` severity marker.** A test asserts each
   message starts with `!`.
4. **Every canned message fits one radio packet.** A test asserts each message is
   200 UTF-8 bytes or fewer.
5. **The AI path is told to abstain.** For everything that is not a hard-routed
   life-threat, the system prompt rewards "not sure" over a confident guess and
   tells the model to send people to a human or EMS for anything life-threatening.
6. **A disclaimer is sent on first contact**, stating the answers may be wrong, that
   there is no second source, and that the assistant is not a doctor.

What this means for you: you do not need to check that the routing fires, that the
messages are short enough, or that they mention EMS. The code holds those. The
routing patterns themselves are listed in section C so you can confirm they fire on
clinically appropriate triggers.

### Needs your sign-off (wording)

The exact clinical content of every fixed string. Specifically:

- Whether each canned message gives correct lay-rescuer first-aid for its situation.
- Whether any instruction could cause harm if followed by an untrained caller who
  is off-grid, alone, and acting on a single unverifiable source.
- Whether anything important is missing (a contraindication, a caveat, a step).
- Whether the contested items flagged in section E are safe as written.

The module's own docstring already states the canned messages are draft, pending
review by a qualified medical professional. This packet is that review.

---

## B. Canned messages — one row per message

Each message is reproduced verbatim from `CANNED_RESPONSES`. The byte count is the
measured UTF-8 length (the cap is 200). The "standard to match" names the relevant
current lay-rescuer first-aid topic from the American Heart Association (AHA) and
American Red Cross (ARC) so you can check the wording against the guidance you
trust; this packet does not reproduce that guidance or assert what it says.

A non-clinician assembled this. Where a row touches something I could not judge but
suspected might matter, I cross-reference the contested item in section E. Treat
those flags as questions, not findings.

---

### B1. `not_breathing` — 137 bytes

> ! Not breathing: start CPR now. Push hard & fast, center of chest, 100-120/min. Send someone for help/AED. Don't stop until help arrives.

- **Clinical claims:** start CPR for a person who is not breathing; compressions at
  the center of the chest; rate 100–120 per minute; send a bystander for help and an
  AED; continue until help arrives.
- **Standard to match:** AHA/ARC adult basic life support — compression rate and
  hands-only CPR for lay rescuers; when to start CPR on an unresponsive,
  not-breathing person.
- **Reviewer checklist:** Is "start CPR now" correct for not-breathing without a
  separate pulse check by a lay rescuer? Is the 100–120/min rate stated correctly?
  See contested items E1 (rate and hands-only framing).
- **Decision (F):** ____________

---

### B2. `no_pulse` — 128 bytes

> ! No pulse: start CPR now. Hard & fast on center of chest, 100-120/min. Get help/AED immediately. Don't stop until help arrives.

- **Clinical claims:** start CPR when there is no pulse; same compression location
  and rate as B1; get help and an AED; continue until help arrives.
- **Standard to match:** AHA/ARC adult basic life support — CPR for cardiac arrest;
  lay-rescuer pulse-check expectations.
- **Reviewer checklist:** Is directing a lay caller to assess "no pulse" and act on
  it appropriate, or should the trigger and wording lean on responsiveness and
  breathing instead? Confirm the rate. See contested item E1.
- **Decision (F):** ____________

---

### B3. `severe_bleeding` — 122 bytes

> ! Severe bleeding: press hard on the wound with cloth and don't let up. Raise the limb if you can. Get to a medic/EMS now.

- **Clinical claims:** apply firm direct pressure to the wound with cloth; maintain
  it; elevate the limb if possible; get to a medic or EMS.
- **Standard to match:** AHA/ARC severe (life-threatening) bleeding control —
  direct pressure, and the role of tourniquets and hemostatic dressings.
- **Reviewer checklist:** Direct pressure is present. Is the omission of a
  tourniquet acceptable for an off-grid caller with severe extremity bleeding, or
  should the message mention one? Is "raise the limb" still endorsed in current
  guidance? See contested item E6.
- **Decision (F):** ____________

---

### B4. `chest_pain` — 119 bytes

> ! Chest pain may be a heart attack. Have them sit and rest; chew one aspirin if not allergic. Get EMS/help immediately.

- **Clinical claims:** chest pain may indicate a heart attack; have the person sit
  and rest; chew one aspirin if not allergic; get EMS.
- **Standard to match:** AHA acute coronary syndrome / aspirin in suspected heart
  attack — indications and contraindications for lay aspirin administration.
- **Reviewer checklist:** The only stated exclusion is allergy. Are the other
  contraindications (active bleeding, suspected aortic dissection or stroke, current
  anticoagulant use) important enough to name in a 200-byte off-grid message, or is
  "if not allergic" an acceptable simplification? This is the highest-stakes wording
  question in the packet. See contested item E2.
- **Decision (F):** ____________

---

### B5. `anaphylaxis` — 138 bytes

> ! Severe allergic reaction: use an epinephrine auto-injector (EpiPen) in the outer thigh now if available. Get EMS. Watch their breathing.

- **Clinical claims:** for a severe allergic reaction, use an epinephrine
  auto-injector in the outer thigh if available; get EMS; monitor breathing.
- **Standard to match:** AHA/ARC anaphylaxis first aid — epinephrine route and site,
  second-dose timing, and EMS activation.
- **Reviewer checklist:** Site and "if available" are present. Should the message
  address a second dose if symptoms persist and EMS is far away (a real off-grid
  scenario), and is the current EMS-then-watch ordering right? See contested item E5.
- **Decision (F):** ____________

---

### B6. `unresponsive` — 105 bytes

> ! Unresponsive: check breathing. If breathing, roll onto their side. If not, start CPR. Get help/EMS now.

- **Clinical claims:** for an unresponsive person, check breathing; if breathing,
  roll onto the side (recovery position); if not breathing, start CPR; get EMS.
- **Standard to match:** AHA/ARC unresponsive-person assessment — recovery position,
  and the caution around moving a person with possible spinal injury.
- **Reviewer checklist:** The breathing-decides-CPR-vs-recovery logic is present. Is
  there a needed caveat about not rolling a person with suspected spinal or trauma
  injury, given off-grid falls and accidents? See contested item E4.
- **Decision (F):** ____________

---

### B7. `choking` — 120 bytes

> ! Choking and can't breathe: give firm back blows between the shoulder blades, then abdominal thrusts. Get help/EMS now.

- **Clinical claims:** for choking with no air movement, give firm back blows
  between the shoulder blades, then abdominal thrusts; get EMS.
- **Standard to match:** AHA/ARC choking relief for a responsive adult or child —
  back-blows and abdominal-thrust sequence, and the separate infant technique.
- **Reviewer checklist:** Confirm the back-blows-then-thrusts sequence matches
  current guidance. Should the message carry an infant caveat (abdominal thrusts are
  not used on infants), or is that out of scope for the trigger? See contested item
  E3.
- **Decision (F):** ____________

---

### B8. `stroke` — 115 bytes

> ! Possible stroke. Note the time symptoms started. Keep them still and get EMS/help immediately — minutes matter.

- **Clinical claims:** for a possible stroke, note the time symptoms started; keep
  the person still; get EMS; time is critical.
- **Standard to match:** AHA/ARC stroke recognition and response — last-known-well
  time, and rapid EMS activation.
- **Reviewer checklist:** Time-of-onset capture and rapid EMS are present. Is "keep
  them still" the right instruction, and is anything else (do not give food, drink,
  or medication) worth the bytes? No contested item flagged; confirm or correct.
- **Decision (F):** ____________

---

## C. Routing patterns — one row per `_EMERGENCY_PATTERNS` entry

These regexes decide which queries are pulled away from the AI and answered with a
canned message. Order matters: choking is checked before the generic "can't
breathe" so a choking query gets the back-blows message rather than the CPR one.

The patterns are deliberately broad. A false positive sends a "get help now"
message to someone who may not have had a true emergency. That over-triggering is a
stated design intent: erring toward "get help" is the safe direction. Your job in
this section is narrower than in section B — confirm each trigger maps to a
clinically sensible canned message, not to second-guess the broadness.

| # | Routes to | Trigger phrases (what the regex matches) | Clinically appropriate? |
|---|-----------|------------------------------------------|--------------------------|
| 1 | `not_breathing` | "not breath…", "stopped breath…", "isn't/isnt breath…", "no longer breath…" | ____________ |
| 2 | `no_pulse` | "no pulse", "no heartbeat" | ____________ |
| 3 | `choking` | "choking" (checked before #4 on purpose) | ____________ |
| 4 | `not_breathing` | "can't/cant/cannot breath…" | ____________ |
| 5 | `severe_bleeding` | "severe/heavy/bad/badly/won't stop/wont stop/profuse … bleed…" | ____________ |
| 6 | `severe_bleeding` | "hemorrhag…", "haemorrhag…", "bleeding out", "gushing blood" | ____________ |
| 7 | `chest_pain` | "chest pain", "heart attack", "crushing chest" | ____________ |
| 8 | `anaphylaxis` | "anaphylax…", "epipen", "throat (is) clos…", "severe allergic" | ____________ |
| 9 | `unresponsive` | "unconscious", "unresponsive", "won't/wont wake", "passed out" | ____________ |
| 10 | `stroke` | "stroke", "face droop", "slurred speech", "one side … numb" | ____________ |

Question for the reviewer across the table: are there life-threats a lay caller
would describe in words that none of these patterns catch, where falling through to
the AI would be unsafe? Note any gaps here: ____________

---

## D. System prompt and disclaimer

These two strings are not canned first-aid, but they make medical claims and set the
caller's expectations, so they need your eye too.

### D1. `LORA_SYSTEM_PROMPT` — 526 bytes (not packet-bound; governs the AI path)

> You are NOMAD's mesh-radio assistant, reached over a tiny LoRa link by someone who may be off-grid. Answer in 200 bytes or fewer, plain text, no markdown, no emoji, most important thing first. If you are unsure, start with 'Not sure -' and say what to check; never give a confident guess. A wrong confident answer can get someone hurt, but 'I don't know' cannot. If your confidence is low, start the message with '?'. You are a convenience, not a safety system; for anything life-threatening, tell them to seek a human or EMS.

- **Claims and instructions:** abstain rather than guess; prefix low-confidence
  answers with `?`; state plainly that this is a convenience and not a safety
  system; defer all life-threats to a human or EMS.
- **Reviewer checklist:** Does this framing hold the model to a safe standard for
  medical-adjacent questions that are not hard-routed (for example, a wound that is
  not "severe," a fever, a possible fracture)? Is anything missing that you would
  want a medical-adjacent AI answer to always carry? ____________

### D2. `FIRST_CONTACT_DISCLAIMER` — 141 bytes

> AI helper over radio. Answers may be WRONG and there's no 2nd source out here - verify before acting. Not a doctor. Life-threat: get a human.

- **Claims:** the assistant is AI; answers may be wrong; there is no second source;
  verify before acting; not a doctor; get a human for a life-threat.
- **Reviewer checklist:** Is this disclaimer sufficient as the one-time framing a
  caller sees before trusting any answer? Anything you would add or change?
  ____________

---

## E. Flagged — contested items

A non-clinician assembled this packet. The items below are where I suspected the
wording might be incomplete or wrong, based on general lay knowledge. These are
suspicions to direct your attention, not claims that the text is incorrect. I am not
qualified to resolve any of them. Each is yours to confirm, revise, or reject in
section F.

- **E1. CPR rate and hands-only framing (B1 `not_breathing`, B2 `no_pulse`).**
  Suspicion: the messages give compressions at 100–120/min and describe hands-only
  compressions without rescue breaths. For an untrained off-grid caller, is
  hands-only the right thing to instruct, and is the rate stated correctly? Should
  either message say anything about not pausing, or about pushing to a depth?

- **E2. Aspirin contraindications (B4 `chest_pain`).**
  Suspicion: the message excludes only allergy. Lay knowledge suggests aspirin can
  be harmful with active bleeding, suspected aortic dissection, suspected stroke
  (some chest-pain presentations overlap), or current anticoagulant use. Is "if not
  allergic" a safe simplification inside 200 bytes, or does an off-grid caller need
  one of those exclusions named? This is the item I am least comfortable leaving
  unreviewed.

- **E3. Choking sequence and infant caveat (B7 `choking`).**
  Suspicion: the message gives back blows then abdominal thrusts. Two questions: is
  that sequence current, and does the absence of an infant caveat matter, since
  abdominal thrusts are not used on infants and a caller may be describing a baby?

- **E4. Recovery position and spinal injury (B6 `unresponsive`).**
  Suspicion: the message says to roll a breathing, unresponsive person onto their
  side. Off-grid emergencies often involve falls or trauma. Should there be a caveat
  about not moving a person with a suspected spinal or neck injury, or does the
  breathing-first benefit outweigh that in the field?

- **E5. Epinephrine second dose and EMS ordering (B5 `anaphylaxis`).**
  Suspicion: the message covers one injection and says to get EMS. Off-grid, EMS may
  be far or unreachable, and symptoms can return. Should the message mention a
  second dose if symptoms persist, and is the current EMS-then-watch-breathing
  ordering right?

- **E6. Tourniquet omission (B3 `severe_bleeding`).**
  Suspicion: the message covers direct pressure and elevation but not a tourniquet.
  For severe extremity bleeding with no medic nearby, is omitting any mention of a
  tourniquet acceptable, or should the message name it as a next step when pressure
  fails? Also: is limb elevation still endorsed in current guidance, or has it been
  dropped?

---

## F. Sign-off — human-gated

This section can only be completed by a qualified clinician. No engineer and no AI
may fill in the decisions below or approve the wording. Sign-off is human-gated.

**Reviewer**

- Name: ____________
- Credential / license: ____________
- Date: ____________

**Per-item decision.** For each item, mark one: APPROVE (as written), REVISE (give
the exact proposed wording), or REJECT (with the reason). Any rewrite must still
satisfy the machine constraints below.

| Item | APPROVE / REVISE / REJECT | Proposed wording (if REVISE) or reason (if REJECT) |
|------|---------------------------|----------------------------------------------------|
| B1 `not_breathing` | __________ | |
| B2 `no_pulse` | __________ | |
| B3 `severe_bleeding` | __________ | |
| B4 `chest_pain` | __________ | |
| B5 `anaphylaxis` | __________ | |
| B6 `unresponsive` | __________ | |
| B7 `choking` | __________ | |
| B8 `stroke` | __________ | |
| C routing patterns | __________ | |
| D1 `LORA_SYSTEM_PROMPT` | __________ | |
| D2 `FIRST_CONTACT_DISCLAIMER` | __________ | |

**Machine constraints any rewrite must still satisfy.** These are enforced by the
test suite. A revised message that breaks either one will fail the build and cannot
ship.

1. **One radio packet.** Each canned message must be 200 UTF-8 bytes or fewer.
   Enforced by `test_canned_messages_fit_one_radio_packet`. For reference, the
   current messages range from 105 bytes (`unresponsive`) to 138 bytes
   (`anaphylaxis`), so there is some headroom for a longer rewrite — but not much.
2. **Severity marker plus a help keyword.** Each canned message must start with `!`
   and contain at least one of `ems`, `help`, `human`, or `medic`. Enforced by
   `test_canned_messages_lead_with_severity_marker_and_seek_help`. A rewrite that
   drops the `!` or the EMS/help direction will fail.

After sign-off, the engineering team applies the approved or revised wording to
`CANNED_RESPONSES` in `mesh_service/safety.py`, reruns the test suite to confirm
both constraints still hold, and records this review.
