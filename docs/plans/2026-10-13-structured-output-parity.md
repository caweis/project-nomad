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

- [ ] Add `admin/app/utils/structured_output.ts` with the three upstream
      schemas, parser, result type, and pickers. Add focused Japa regressions.
- [ ] Update `admin/app/services/ollama_service.ts` so `format` reaches native
      Ollama and is omitted for oMLX. Mark responses with whether a schema
      reached the decoder. Test both backend decisions without a live model.
- [ ] Update the ancillary prompts in `admin/constants/ollama.ts`, then wire
      the schema and result handling in `admin/app/services/chat_service.ts`
      and `admin/app/controllers/ollama_controller.ts`. Preserve the Mac text
      fallback and the last-user-question fallback for a broken rewrite.
- [ ] Run the focused tests, full Adonis suite, typecheck, production build,
      and call-path review. Run an actual native model check if a suitable
      local model is available; otherwise record the limit.
- [ ] Commit and push each verified step, update the parity ledger and draft
      PR #62, and check CI.

## Review

Pending.
