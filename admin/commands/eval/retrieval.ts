import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import { readFile, writeFile } from 'node:fs/promises'
import { RagService } from '#services/rag_service'
import { GoldenSetError, parseGoldens } from '../../app/utils/eval/golden_set.js'
import {
  DEFAULT_K_VALUES,
  aggregate,
  aggregateByTag,
  scoreCase,
  type RetrievalAggregate,
  type RetrievalCase,
  type RetrievalCaseResult,
} from '../../app/utils/eval/retrieval_metrics.js'
import {
  describeStamp,
  stampsMatch,
  toScoredChunks,
  type RunStamp,
} from '../../app/utils/eval/retrieval_run.js'

/**
 * `node ace eval:retrieval` — measure whether a retrieval change made things
 * better or worse, instead of guessing from a handful of manual queries.
 *
 * Runs a golden set of questions through the same RagService.searchSimilarDocuments
 * call the chat endpoint uses, scores the ranked results against the documents
 * that genuinely answer each question, and prints recall/precision/MRR/nDCG at
 * several cut-offs. With --out it writes a JSON report; with --baseline it
 * compares against an earlier one and shows the deltas.
 *
 * Ported from upstream #1233, scoped down deliberately. Upstream ships a whole
 * harness: a frozen markdown corpus it ingests itself, generation scoring
 * against an LLM judge, and compare/matrix tooling. That rests on an ingest
 * pipeline and a RagPipelineService this fork does not have. What survives here
 * is the part that answers the question actually worth asking — "did retrieval
 * get worse?" — against a knowledge base collection the operator already
 * indexed.
 *
 * Because NOMAD did not ingest the corpus, it cannot hash it the way upstream
 * does to prove two reports are comparable. Each report is stamped with the
 * parameters that do move retrieval here, and --baseline refuses to diff across
 * a changed stamp rather than reporting a meaningless delta.
 *
 *   node ace eval:retrieval --goldens=tests/eval/goldens/retrieval.jsonl
 *   node ace eval:retrieval --goldens=… --collection=Medicine --top-k=10
 *   node ace eval:retrieval --goldens=… --out=report.json
 *   node ace eval:retrieval --goldens=… --baseline=report.json
 */
export default class EvalRetrieval extends BaseCommand {
  static commandName = 'eval:retrieval'
  static description =
    'Score knowledge base retrieval against a golden set of questions (recall, precision, MRR, nDCG).'

  static options: CommandOptions = {
    startApp: true, // needs Qdrant + the embedding model
  }

  @flags.string({ description: 'Path to the golden set, JSONL', required: true })
  declare goldens: string

  @flags.string({ description: 'Knowledge base collection to search. Omit to search everything.' })
  declare collection: string

  @flags.number({ description: 'Chunks to retrieve per query (default 10)' })
  declare topK: number

  @flags.number({ description: 'Minimum similarity score (default 0.3, matching chat)' })
  declare threshold: number

  @flags.string({ description: 'Write the JSON report to this path' })
  declare out: string

  @flags.string({ description: 'Compare against a previous report at this path' })
  declare baseline: string

  async run() {
    const topK = this.topK ?? 10
    // 0.3 is what OllamaController.chat passes. Diverging here would measure
    // something the users never experience.
    const threshold = this.threshold ?? 0.3

    let goldens
    try {
      goldens = parseGoldens(await readFile(this.goldens, 'utf-8'), this.goldens)
    } catch (error) {
      if (error instanceof GoldenSetError) {
        this.logger.error(`Golden set is not usable: ${error.message}`)
        this.exitCode = 1
        return
      }
      this.logger.error(
        `Could not read ${this.goldens}: ${error instanceof Error ? error.message : error}`
      )
      this.exitCode = 1
      return
    }

    if (goldens.length === 0) {
      this.logger.error('The golden set is empty, so there is nothing to measure.')
      this.exitCode = 1
      return
    }

    const stamp: RunStamp = {
      collection: this.collection ?? '(all)',
      embeddingModel: RagService.EMBEDDING_MODEL,
      topK,
      scoreThreshold: threshold,
    }

    this.logger.info(`Scoring ${goldens.length} question(s) — ${describeStamp(stamp)}`)

    const ragService = await this.app.container.make(RagService)
    const cases: RetrievalCase[] = []
    let unresolvedTotal = 0
    let retrievalFailures = 0

    for (const golden of goldens) {
      let retrieved: Awaited<ReturnType<RagService['searchSimilarDocuments']>> = []
      try {
        retrieved = await ragService.searchSimilarDocuments(
          golden.query,
          topK,
          threshold,
          this.collection || undefined
        )
      } catch (error) {
        // One bad question must not void the whole run, but it must not be
        // scored as a legitimate zero either — that would read as a retrieval
        // regression when it is an outage.
        retrievalFailures++
        this.logger.warning(
          `  ${golden.id}: retrieval failed, excluded from the totals — ${error instanceof Error ? error.message : error}`
        )
        continue
      }

      const { chunks, unresolved } = toScoredChunks(retrieved)
      unresolvedTotal += unresolved

      cases.push({
        id: golden.id,
        tags: golden.tags,
        retrieved: chunks,
        relevantDocIds: golden.relevantDocIds,
        expectRefusal: golden.expectRefusal,
      })
    }

    if (cases.length === 0) {
      this.logger.error('Every question failed to retrieve. Not writing a report.')
      this.exitCode = 1
      return
    }

    const results: RetrievalCaseResult[] = cases.map((c) => scoreCase(c, DEFAULT_K_VALUES))
    const totals = aggregate(cases, results, DEFAULT_K_VALUES)
    const byTag = aggregateByTag(cases, results, DEFAULT_K_VALUES)

    this._printAggregate(totals)

    if (Object.keys(byTag).length > 0) {
      this.logger.info('')
      this.logger.info('By tag:')
      for (const [tag, agg] of Object.entries(byTag)) {
        this.logger.info(`  ${tag} (${agg.cases} case(s))`)
        this._printAggregate(agg, '    ')
      }
    }

    if (unresolvedTotal > 0) {
      // Chunks whose source could not be mapped to a document still occupy a
      // rank, so they drag precision down without being creditable to anything.
      this.logger.warning(
        `${unresolvedTotal} retrieved chunk(s) had no resolvable source and could not be credited to a document.`
      )
    }
    if (retrievalFailures > 0) {
      this.logger.warning(`${retrievalFailures} question(s) were excluded because retrieval failed.`)
    }

    const report = {
      stamp,
      goldenSet: this.goldens,
      cases: results,
      totals,
      byTag,
      unresolvedChunks: unresolvedTotal,
      excludedQuestions: retrievalFailures,
    }

    if (this.out) {
      await writeFile(this.out, JSON.stringify(report, null, 2))
      this.logger.success(`Report written to ${this.out}`)
    }

    if (this.baseline) {
      await this._compare(report)
    }
  }

  private _printAggregate(agg: RetrievalAggregate, indent = '  ') {
    const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(3))
    for (const k of DEFAULT_K_VALUES) {
      this.logger.info(
        `${indent}@${k}  recall ${fmt(agg.recall?.[k])}  precision ${fmt(agg.precision?.[k])}  ` +
          `hit ${fmt(agg.hitRate?.[k])}  ndcg ${fmt(agg.ndcg?.[k])}`
      )
    }
    this.logger.info(`${indent}MRR ${fmt(agg.mrr)}`)
    // The two halves of the score-threshold trade-off, and the most actionable
    // numbers here: answerable questions that retrieved nothing means the
    // threshold is filtering out real answers, while out-of-corpus questions
    // that retrieved something anyway is what feeds a confident wrong reply.
    this.logger.info(
      `${indent}empty on answerable ${fmt(agg.emptyRateOnAnswerable)}  ` +
        `retrieved on refusal ${fmt(agg.nonEmptyRateOnRefusal)}`
    )
  }

  private async _compare(report: { stamp: RunStamp; totals: RetrievalAggregate }) {
    let baseline: { stamp: RunStamp; totals: RetrievalAggregate }
    try {
      baseline = JSON.parse(await readFile(this.baseline, 'utf-8'))
    } catch (error) {
      this.logger.error(
        `Could not read the baseline ${this.baseline}: ${error instanceof Error ? error.message : error}`
      )
      this.exitCode = 1
      return
    }

    if (!baseline.stamp || !stampsMatch(baseline.stamp, report.stamp)) {
      // Refusing is the point. A delta across different parameters cannot tell
      // "the change I made" apart from "I searched differently".
      this.logger.error('These reports are not comparable, so no delta is shown.')
      this.logger.error(`  baseline: ${baseline.stamp ? describeStamp(baseline.stamp) : 'no stamp'}`)
      this.logger.error(`  this run: ${describeStamp(report.stamp)}`)
      this.exitCode = 1
      return
    }

    this.logger.info('')
    this.logger.info(`Against ${this.baseline}:`)
    const delta = (now: number | null, was: number | null) => {
      if (now === null || was === null) return '—'
      const d = now - was
      return `${d >= 0 ? '+' : ''}${d.toFixed(3)}`
    }
    for (const k of DEFAULT_K_VALUES) {
      this.logger.info(
        `  @${k}  recall ${delta(report.totals.recall?.[k], baseline.totals.recall?.[k])}  ` +
          `precision ${delta(report.totals.precision?.[k], baseline.totals.precision?.[k])}  ` +
          `ndcg ${delta(report.totals.ndcg?.[k], baseline.totals.ndcg?.[k])}`
      )
    }
    this.logger.info(`  MRR ${delta(report.totals.mrr, baseline.totals.mrr)}`)
  }
}
