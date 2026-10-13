# Structured task output parity plan

**Goal:** Carry upstream's constrained title, suggestion, and query-rewrite
responses into the fork without breaking the Apple Silicon AI path.

**Architecture:** Native Ollama receives JSON Schemas through `/api/chat`.
The Mac oMLX proxy receives the prompt without a schema because its Ollama
request model accepts only `format: "json"` and its translator does not pass
that field through. All three callers first try the same tolerant JSON parser.
If no schema reached the model, they retain their existing text fallback. If a
schema reached the model but the response is incomplete, they use a safe
fallback instead of displaying or searching a JSON fragment.

**Stack:** AdonisJS, TypeScript, the Ollama client, Japa tests.

## Tasks

- [x] Add `admin/app/utils/structured_output.ts` with the three upstream
      schemas, parser, result type, and pickers. Add focused Japa regressions.
- [x] Update `admin/app/services/ollama_service.ts` so `format` reaches native
      Ollama and is omitted for oMLX. Mark responses with whether a schema
      reached the decoder. Test both backend decisions without a live model.
- [x] Update the ancillary prompts in `admin/constants/ollama.ts`, then wire
      the schema and result handling in `admin/app/services/chat_service.ts`
      and `admin/app/controllers/ollama_controller.ts`. Preserve the Mac text
      fallback and the last-user-question fallback for a broken rewrite.
- [x] Run the focused tests, full Adonis suite, typecheck, production build,
      and call-path review. Run an actual native model check if a suitable
      local model is available; otherwise record the limit.
- [x] Commit and push each verified step, update the parity ledger and draft
      PR #62, and check CI.

## Review

Native Ollama receives the three schemas. The Mac oMLX path omits the schema
its proxy cannot accept and parses JSON when the model returns it. Plain-text
replies keep the earlier fallback. Incomplete JSON now falls back to the user
question for titles and retrieval, or to no suggestion chips. The caller
tests exercise those outcomes and the transport tests inspect both requests.

Typecheck and the admin production build pass. The full Adonis suite passes
324 tests across 29 spec files. Focused lint passes on the new helper and
tests. Existing formatting findings remain in the larger touched files, and
Vite reports its existing large-chunk warning. The production call paths
reach all three helpers. No local Ollama server answered on port 11434, so a
live model response remains unverified. The merged Mac UI and installer still
need a device pass.
