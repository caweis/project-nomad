# Retrieval evaluation

Answers one question: **did a change make knowledge base retrieval worse?**

Manual spot-checking cannot answer it. A retrieval change moves results for
questions nobody thought to retype, and the ones that break are rarely the ones
tried by hand.

## Running it

This is a maintainer tool. Nothing in normal NOMAD use needs it.

**On a running appliance**, it runs inside the admin container:

```bash
docker exec -it nomad_admin node ace eval:retrieval --goldens=/app/storage/goldens.jsonl
```

Note the path. **The golden set in this directory does not ship in the image** —
`node ace build` only emits compiled TypeScript, and a `.jsonl` is not in
`metaFiles`, so `tests/eval/goldens/` exists in the source tree and nowhere
else. The host's `${NOMAD_DATA_ROOT}/storage` is mounted at `/app/storage`, so
put your golden set there and point `--goldens` at it. Anywhere else in the
container is not reachable from the host.

**From a source checkout** the relative path works as written:

```bash
node ace eval:retrieval --goldens=tests/eval/goldens/example.jsonl
```

Either way:

```bash
# Scope to one collection, and look deeper down the ranking
… eval:retrieval --goldens=… --collection=Medicine --top-k=10

# Record a baseline, change something, compare
… eval:retrieval --goldens=… --out=/app/storage/before.json
… eval:retrieval --goldens=… --baseline=/app/storage/before.json
```

## Writing a golden set

One JSON object per line. `//` comments and blank lines are skipped.
`tests/eval/goldens/example.jsonl` is a **template** — its document ids refer to
documents that probably do not exist on your box, and a golden set pointed at
nothing scores zero everywhere and reads as a total failure.

| Field | Meaning |
|---|---|
| `id` | Stable key. Required. Reports join on it. |
| `query` | The question, as a user would actually type it. Required. |
| `relevantDocIds` | Documents that genuinely answer it: the source filename without its extension, so `/storage/kb/water-treatment.md` is `water-treatment`. |
| `expectRefusal` | `true` when the knowledge base genuinely cannot answer. Must not be combined with `relevantDocIds`. |
| `tags` | Free-form buckets for per-slice reporting (`single-hop`, `acronym`, `water`). |
| `turns` | Prior conversation, for coreference cases. |
| `mustInclude` / `mustNotInclude` | Case-insensitive regexes. Parsed and validated, but only scored by the generation eval, which this fork has not ported. |

Include out-of-corpus questions. They are the only thing that catches a score
threshold set too low, and a too-low threshold is what hands the model context
for a question it cannot answer — which is how a confident wrong reply reaches
someone with no way to check it.

## Reading the numbers

- **recall@k** — of the documents that should have come back, how many did.
- **precision@k** — of what came back, how much was wanted.
- **hit@k** — did *any* right document appear. All-or-nothing per question.
- **nDCG@k** — like recall, but rewards ranking the right document higher.
- **MRR** — how high the first right document sat, averaged.
- **empty on answerable** — answerable questions that retrieved nothing. Above
  zero means the threshold is filtering out real answers.
- **retrieved on refusal** — out-of-corpus questions that retrieved something
  anyway. The other half of the same trade-off.

A question with no relevant documents scores `null`, not zero, and is left out
of the mean. Scoring it zero would drag every average down and read as a
regression that never happened.

## Comparability

Each report is stamped with the collection, embedding model, top-k and score
threshold. `--baseline` refuses to show a delta when the stamps differ, because
"I changed the reranker" and "I searched a different collection" are
indistinguishable in the numbers otherwise.

Upstream (#1233) goes further and hashes the corpus itself, so re-chunking also
invalidates a comparison. That needs the corpus-ingest half of their harness,
which this fork has not ported: retrieval here runs against a collection the
operator indexed, so NOMAD never held those documents. **Re-indexing your
knowledge base therefore invalidates a baseline without the stamp changing.**
Re-record after a re-index.

## What is not here

Upstream's harness also scores *generation* — whether the answer was right, via
an LLM judge — plus corpus ingest and matrix/compare tooling. Those rest on an
ingest pipeline and a `RagPipelineService` this fork does not have. Retrieval is
the half that can be measured honestly here, and it is the half that moves first
when retrieval changes.
