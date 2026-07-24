import { QdrantClient } from '@qdrant/js-client-rest'
import { DockerService } from './docker_service.js'
import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import { TokenChunker } from '@chonkiejs/core'
import sharp from 'sharp'
import { deleteFileIfExists, determineFileType, getFile, getFileStatsIfExists, listDirectoryContentsRecursive, ZIM_STORAGE_PATH } from '../utils/fs.js'
import { computeHeadingBoost } from '../utils/rag_context.js'
import { decideScanAction, type IngestPolicy } from '../utils/kb_ingest_decision.js'
import KbIngestState from '#models/kb_ingest_state'
import { PDFParse } from 'pdf-parse'
import { createWorker } from 'tesseract.js'
import { fromBuffer } from 'pdf2pic'
import mammoth from 'mammoth'
import { OllamaService } from './ollama_service.js'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import { removeStopwords } from 'stopword'
import { randomUUID } from 'node:crypto'
import { join, resolve, sep } from 'node:path'
import KVStore from '#models/kv_store'
import { ZIMExtractionService } from './zim_extraction_service.js'
import { ZIM_BATCH_SIZE } from '../../constants/zim_extraction.js'
import { ProcessAndEmbedFileResponse, ProcessZIMFileResponse, RAGResult, RerankedRAGResult, StoredFileInfo } from '../../types/rag.js'
import type { KbIngestStateValue } from '../../types/kb_ingest_state.js'

@inject()
export class RagService {
  private qdrant: QdrantClient | null = null
  private qdrantInitPromise: Promise<void> | null = null
  private embeddingModelVerified = false
  // Collections already verified by this instance (created + payload indexes in
  // place). Skips the getCollections/createPayloadIndex round-trips that otherwise
  // run on every embed call — ~45% of per-document Qdrant time on large ingestions
  // per upstream #1129. Instances are per-request/per-job in this fork (EmbedFileJob
  // news one up per job), so staleness is bounded by the instance lifetime: if
  // Qdrant restarts mid-job the next upsert fails and the retried job re-verifies
  // with a fresh instance. (Ports upstream #1135.)
  private ensuredCollections = new Set<string>()
  public static UPLOADS_STORAGE_PATH = 'storage/kb_uploads'
  public static CONTENT_COLLECTION_NAME = 'nomad_knowledge_base'
  // Upper bound on distinct sources returned by Qdrant's facet API. Real
  // NOMADs cap out at a few hundred ZIM files + uploaded PDFs; 10k leaves
  // generous headroom without paying the cost of an unbounded request.
  // (Forward-port of upstream 97c65cc.)
  public static FACET_SOURCE_LIMIT = 10_000
  public static EMBEDDING_MODEL = 'nomic-embed-text:v1.5'
  public static EMBEDDING_DIMENSION = 768 // Nomic Embed Text v1.5 dimension is 768
  public static MODEL_CONTEXT_LENGTH = 2048 // nomic-embed-text has 2K token context
  // Tighter than the model's nominal 2048 context to leave room for tokenizer
  // variance. Empirically, char-based estimates undercount on dense content
  // (HTML, German, code-heavy text) where chars/token can drop below 3 — we
  // hit "the input length exceeds the context length" 400 errors from Ollama
  // when MAX_SAFE_TOKENS was 1800 + CHAR_TO_TOKEN_RATIO was 3. Pulling both
  // tighter (1400 cap, 2.5 ratio) trades ~20% chunk content for reliable
  // embedding success across non-English and structured-data ZIMs.
  public static MAX_SAFE_TOKENS = 1400 // Leave generous buffer for prefix + tokenization variance
  public static TARGET_TOKENS_PER_CHUNK = 1700 // Target 1700 tokens per chunk for embedding
  public static PREFIX_TOKEN_BUDGET = 10 // Reserve ~10 tokens for prefixes
  public static CHAR_TO_TOKEN_RATIO = 2.5 // Conservative chars/token — undercounting causes context overruns
  // Nomic Embed Text v1.5 uses task-specific prefixes for optimal performance
  public static SEARCH_DOCUMENT_PREFIX = 'search_document: '
  public static SEARCH_QUERY_PREFIX = 'search_query: '
  public static EMBEDDING_BATCH_SIZE = 8 // Conservative batch size for low-end hardware

  constructor(
    private dockerService: DockerService,
    private ollamaService: OllamaService
  ) { }

  private async _initializeQdrantClient() {
    if (!this.qdrantInitPromise) {
      this.qdrantInitPromise = (async () => {
        const qdrantUrl = await this.dockerService.getServiceURL(SERVICE_NAMES.QDRANT)
        if (!qdrantUrl) {
          throw new Error('Qdrant service is not installed or running.')
        }
        this.qdrant = new QdrantClient({ url: qdrantUrl })
      })()
    }
    return this.qdrantInitPromise
  }

  private async _ensureDependencies() {
    if (!this.qdrant) {
      await this._initializeQdrantClient()
    }
  }

  private async _ensureCollection(
    collectionName: string,
    dimensions: number = RagService.EMBEDDING_DIMENSION
  ) {
    try {
      await this._ensureDependencies()

      if (this.ensuredCollections.has(collectionName)) {
        return
      }

      const collections = await this.qdrant!.getCollections()
      const collectionExists = collections.collections.some((col) => col.name === collectionName)

      if (!collectionExists) {
        await this.qdrant!.createCollection(collectionName, {
          vectors: {
            size: dimensions,
            distance: 'Cosine',
          },
        })
      }

      // Create payload indexes for faster filtering (idempotent — Qdrant ignores duplicates)
      await this.qdrant!.createPayloadIndex(collectionName, {
        field_name: 'source',
        field_schema: 'keyword',
      })
      await this.qdrant!.createPayloadIndex(collectionName, {
        field_name: 'content_type',
        field_schema: 'keyword',
      })
      // KB subject tag (upstream #1063) — a payload FIELD named 'collection',
      // not to be confused with the Qdrant collection itself.
      await this.qdrant!.createPayloadIndex(collectionName, {
        field_name: 'collection',
        field_schema: 'keyword',
      })

      // Only memoize after every step succeeded, so a partial failure is retried
      this.ensuredCollections.add(collectionName)
    } catch (error) {
      logger.error('Error ensuring Qdrant collection:', error)
      throw error
    }
  }

  /**
   * Sanitizes text to ensure it's safe for JSON encoding and Qdrant storage.
   * Removes problematic characters that can cause "unexpected end of hex escape" errors:
   * - Null bytes (\x00)
   * - Invalid Unicode sequences
   * - Control characters (except newlines, tabs, and carriage returns)
   */
  private sanitizeText(text: string): string {
    return text
      // Null bytes
      .replace(/\x00/g, '')
      // Problematic control characters (keep \n, \r, \t)
      .replace(/[\x01-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
      // Invalid Unicode surrogates
      .replace(/[\uD800-\uDFFF]/g, '')
      // Trim extra whitespace
      .trim()
  }

  /**
   * Estimates token count for text. This is a conservative approximation:
   * - English text: ~1 token per 3 characters
   * - Adds buffer for special characters and tokenization variance
   *
   * Note: This is approximate and realistic english
   * tokenization is ~4 chars/token, but we use 3 here to be safe.
   * Actual tokenization may differ, but being
   * conservative prevents context length errors.
   */
  private estimateTokenCount(text: string): number {
    // This accounts for special characters, numbers, and punctuation
    return Math.ceil(text.length / RagService.CHAR_TO_TOKEN_RATIO)
  }

  /**
   * Truncates text to fit within token limit, preserving word boundaries.
   * Ensures the text + prefix won't exceed the model's context window.
   */
  private truncateToTokenLimit(text: string, maxTokens: number): string {
    const estimatedTokens = this.estimateTokenCount(text)

    if (estimatedTokens <= maxTokens) {
      return text
    }

    // Calculate how many characters we can keep using our ratio
    const maxChars = Math.floor(maxTokens * RagService.CHAR_TO_TOKEN_RATIO)

    // Truncate at word boundary
    let truncated = text.substring(0, maxChars)
    const lastSpace = truncated.lastIndexOf(' ')

    if (lastSpace > maxChars * 0.8) {
      // If we found a space in the last 20%, use it
      truncated = truncated.substring(0, lastSpace)
    }

    logger.warn(
      `[RAG] Truncated text from ${text.length} to ${truncated.length} chars (est. ${estimatedTokens} → ${this.estimateTokenCount(truncated)} tokens)`
    )

    return truncated
  }

  /**
   * Preprocesses a query to improve retrieval by expanding it with context.
   * This helps match documents even when using different terminology.
   * TODO: We could probably move this to a separate QueryPreprocessor class if it grows more complex, but for now it's manageable here.
   */
  private static QUERY_EXPANSION_DICTIONARY: Record<string, string> = {
    'bob': 'bug out bag',
    'bov': 'bug out vehicle',
    'bol': 'bug out location',
    'edc': 'every day carry',
    'mre': 'meal ready to eat',
    'shtf': 'shit hits the fan',
    'teotwawki': 'the end of the world as we know it',
    'opsec': 'operational security',
    'ifak': 'individual first aid kit',
    'ghb': 'get home bag',
    'ghi': 'get home in',
    'wrol': 'without rule of law',
    'emp': 'electromagnetic pulse',
    'ham': 'ham amateur radio',
    'nbr': 'nuclear biological radiological',
    'cbrn': 'chemical biological radiological nuclear',
    'sar': 'search and rescue',
    'comms': 'communications radio',
    'fifo': 'first in first out',
    'mylar': 'mylar bag food storage',
    'paracord': 'paracord 550 cord',
    'ferro': 'ferro rod fire starter',
    'bivvy': 'bivvy bivy emergency shelter',
    'bdu': 'battle dress uniform',
    'gmrs': 'general mobile radio service',
    'frs': 'family radio service',
    'nbc': 'nuclear biological chemical',
  }

  private preprocessQuery(query: string): string {
    let expanded = query.trim()

    // Expand known domain abbreviations/acronyms
    const words = expanded.toLowerCase().split(/\s+/)
    const expansions: string[] = []

    for (const word of words) {
      const cleaned = word.replace(/[^\w]/g, '')
      if (RagService.QUERY_EXPANSION_DICTIONARY[cleaned]) {
        expansions.push(RagService.QUERY_EXPANSION_DICTIONARY[cleaned])
      }
    }

    if (expansions.length > 0) {
      expanded = `${expanded} ${expansions.join(' ')}`
      logger.debug(`[RAG] Query expanded with domain terms: "${expanded}"`)
    }

    logger.debug(`[RAG] Original query: "${query}"`)
    logger.debug(`[RAG] Preprocessed query: "${expanded}"`)
    return expanded
  }

  /**
   * Extract keywords from query for hybrid search
   */
  private extractKeywords(query: string): string[] {
    const split = query.split(' ')
    const noStopWords = removeStopwords(split)

    // Future: This is basic normalization, could be improved with stemming/lemmatization later
    const keywords = noStopWords
      .map((word) => word.replace(/[^\w]/g, '').toLowerCase())
      .filter((word) => word.length > 2)

    return [...new Set(keywords)]
  }

  public async embedAndStoreText(
    text: string,
    metadata: Record<string, any> = {},
    onProgress?: (percent: number) => Promise<void>
  ): Promise<{ chunks: number } | null> {
    try {
      await this._ensureCollection(
        RagService.CONTENT_COLLECTION_NAME,
        RagService.EMBEDDING_DIMENSION
      )

      if (!this.embeddingModelVerified) {
        const allModels = await this.ollamaService.getModels(true)
        const embeddingModel = allModels.find((model) => model.name === RagService.EMBEDDING_MODEL)

        if (!embeddingModel) {
          try {
            const downloadResult = await this.ollamaService.downloadModel(RagService.EMBEDDING_MODEL)
            if (!downloadResult.success) {
              throw new Error(downloadResult.message || 'Unknown error during model download')
            }
          } catch (modelError) {
            logger.error(
              `[RAG] Embedding model ${RagService.EMBEDDING_MODEL} not found locally and failed to download:`,
              modelError
            )
            this.embeddingModelVerified = false
            return null
          }
        }
        this.embeddingModelVerified = true
      }

      // TokenChunker uses character-based tokenization (1 char = 1 token)
      // We need to convert our embedding model's token counts to character counts
      // since nomic-embed-text tokenizer uses ~3 chars per token
      const targetCharsPerChunk = Math.floor(RagService.TARGET_TOKENS_PER_CHUNK * RagService.CHAR_TO_TOKEN_RATIO)
      const overlapChars = Math.floor(150 * RagService.CHAR_TO_TOKEN_RATIO)

      const chunker = await TokenChunker.create({
        chunkSize: targetCharsPerChunk,
        chunkOverlap: overlapChars,
      })

      const chunkResults = await chunker.chunk(text)

      if (!chunkResults || chunkResults.length === 0) {
        throw new Error('No text chunks generated for embedding.')
      }

      // Extract text from chunk results
      const chunks = chunkResults.map((chunk) => chunk.text)

      const ollamaClient = await this.ollamaService.getClient()

      // Prepare all chunk texts with prefix and truncation
      const prefixedChunks: string[] = []
      for (let i = 0; i < chunks.length; i++) {
        let chunkText = chunks[i]

        // Final safety check: ensure chunk + prefix fits
        const prefixText = RagService.SEARCH_DOCUMENT_PREFIX
        const withPrefix = prefixText + chunkText
        const estimatedTokens = this.estimateTokenCount(withPrefix)

        if (estimatedTokens > RagService.MAX_SAFE_TOKENS) {
          const prefixTokens = this.estimateTokenCount(prefixText)
          const maxTokensForText = RagService.MAX_SAFE_TOKENS - prefixTokens
          logger.warn(
            `[RAG] Chunk ${i} estimated at ${estimatedTokens} tokens (${chunkText.length} chars), truncating to ${maxTokensForText} tokens`
          )
          chunkText = this.truncateToTokenLimit(chunkText, maxTokensForText)
        }

        prefixedChunks.push(RagService.SEARCH_DOCUMENT_PREFIX + chunkText)
      }

      // Batch embed chunks for performance. Track per-chunk success so we
      // can skip failed batches without taking down the whole job — earlier
      // behavior was that one over-context batch threw, BullMQ retried the
      // entire job 30x with 60s fixed backoff, starved the worker for 30
      // minutes per file, and ultimately failed. Now we log + skip and ship
      // whatever embeddings succeeded; missing chunks reduce RAG recall on
      // that document but don't break ingest for the other 99 documents in
      // the batch.
      const embeddings: number[][] = []
      const successfulChunkIndices: number[] = []
      const batchSize = RagService.EMBEDDING_BATCH_SIZE
      const totalBatches = Math.ceil(prefixedChunks.length / batchSize)
      let failedBatches = 0

      for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
        const batchStart = batchIdx * batchSize
        const batch = prefixedChunks.slice(batchStart, batchStart + batchSize)

        logger.debug(`[RAG] Embedding batch ${batchIdx + 1}/${totalBatches} (${batch.length} chunks)`)

        try {
          const response = await ollamaClient.embed({
            model: RagService.EMBEDDING_MODEL,
            input: batch,
          })

          embeddings.push(...response.embeddings)
          for (let j = 0; j < batch.length; j++) {
            successfulChunkIndices.push(batchStart + j)
          }
        } catch (embedError: any) {
          // Specific 400 "input length exceeds context length" is the common
          // case here; also handle network errors, model-not-loaded, etc.
          // gracefully so a single problematic batch doesn't blow up ingest.
          failedBatches++
          const errMsg = embedError?.error || embedError?.message || String(embedError)
          const sampleChunk = batch[0]?.slice(0, 120) ?? ''
          logger.warn(
            `[RAG] Embedding batch ${batchIdx + 1}/${totalBatches} FAILED (${errMsg}). ` +
              `Skipping ${batch.length} chunks starting with: "${sampleChunk}..."`
          )
        }

        if (onProgress) {
          const progress = ((batchStart + batch.length) / prefixedChunks.length) * 100
          await onProgress(progress)
        }
      }

      if (failedBatches > 0) {
        logger.warn(
          `[RAG] ${failedBatches}/${totalBatches} batches failed; embedded ${successfulChunkIndices.length}/${prefixedChunks.length} chunks. Continuing with partial ingest.`
        )
      }

      // If every batch failed, surface the failure to the caller rather
      // than silently shipping zero embeddings.
      if (embeddings.length === 0 && prefixedChunks.length > 0) {
        throw new Error(
          `All ${totalBatches} embedding batches failed — see prior warnings. Job aborted.`
        )
      }

      const timestamp = Date.now()
      // Iterate over successfully-embedded chunks only. successfulChunkIndices
      // is parallel to embeddings[] (both built in lockstep during the batch
      // loop), so embeddings[position] is the vector for chunks[origIndex].
      // This is the change from the older chunks.map((_, index) => ...) which
      // mis-indexed embeddings[] whenever a batch was skipped.
      const points = successfulChunkIndices.map((origIndex, position) => {
        const chunkText = chunks[origIndex]
        // Sanitize text to prevent JSON encoding errors
        const sanitizedText = this.sanitizeText(chunkText)

        // Extract keywords from content
        const contentKeywords = this.extractKeywords(sanitizedText)

        // For ZIM content, also extract keywords from structural metadata
        let structuralKeywords: string[] = []
        if (metadata.full_title) {
          structuralKeywords = this.extractKeywords(metadata.full_title as string)
        } else if (metadata.article_title) {
          structuralKeywords = this.extractKeywords(metadata.article_title as string)
        }

        // Combine and dedup keywords
        const allKeywords = [...new Set([...structuralKeywords, ...contentKeywords])]

        logger.debug(`[RAG] Extracted keywords for chunk ${origIndex}: [${allKeywords.join(', ')}]`)
        if (structuralKeywords.length > 0) {
          logger.debug(`[RAG]   - Structural: [${structuralKeywords.join(', ')}], Content: [${contentKeywords.join(', ')}]`)
        }

        // Sanitize source metadata as well
        const sanitizedSource = typeof metadata.source === 'string'
          ? this.sanitizeText(metadata.source)
          : 'unknown'

        return {
          id: randomUUID(), // qdrant requires either uuid or unsigned int
          vector: embeddings[position],
          payload: {
            ...metadata,
            text: sanitizedText,
            chunk_index: origIndex,
            total_chunks: chunks.length,
            keywords: allKeywords.join(' '), // store as space-separated string for text search
            char_count: sanitizedText.length,
            created_at: timestamp,
            source: sanitizedSource
          },
        }
      })

      await this.qdrant!.upsert(RagService.CONTENT_COLLECTION_NAME, { points })

      logger.debug(`[RAG] Successfully embedded and stored ${points.length}/${chunks.length} chunks`)
      if (points.length > 0) {
        logger.debug(`[RAG] First successful chunk preview: "${chunks[successfulChunkIndices[0]].substring(0, 100)}..."`)
      }

      return { chunks: points.length }
    } catch (error) {
      console.error(error)
      logger.error('[RAG] Error embedding text:', error)
      return null
    }
  }

  private async preprocessImage(filebuffer: Buffer): Promise<Buffer> {
    return await sharp(filebuffer)
      .grayscale()
      .normalize()
      .sharpen()
      .resize({ width: 2000, fit: 'inside' })
      .toBuffer()
  }

  private async convertPDFtoImages(filebuffer: Buffer): Promise<Buffer[]> {
    const converted = await fromBuffer(filebuffer, {
      quality: 50,
      density: 200,
      format: 'png',
    }).bulk(-1, {
      responseType: 'buffer',
    })
    return converted.filter((res) => res.buffer).map((res) => res.buffer!)
  }

  private async extractPDFText(filebuffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: filebuffer })
    const data = await parser.getText()
    await parser.destroy()
    return data.text
  }

  private async extractTXTText(filebuffer: Buffer): Promise<string> {
    return filebuffer.toString('utf-8')
  }

  /**
   * Extract text from a DOCX file using mammoth. DOCX is a ZIP-based XML format,
   * so raw-text extraction (extractTXTText) would return garbage — mammoth parses
   * the document XML and returns clean plain text. Ported from upstream #1100.
   */
  private async processDocxFile(fileBuffer: Buffer): Promise<string> {
    const { value: text } = await mammoth.extractRawText({ buffer: fileBuffer })
    return text
  }

  private async extractImageText(filebuffer: Buffer): Promise<string> {
    const worker = await createWorker('eng')
    const result = await worker.recognize(filebuffer)
    await worker.terminate()
    return result.data.text
  }

  private async processImageFile(fileBuffer: Buffer): Promise<string> {
    const preprocessedBuffer = await this.preprocessImage(fileBuffer)
    return await this.extractImageText(preprocessedBuffer)
  }

  /**
   * Will process the PDF and attempt to extract text.
   * If the extracted text is minimal, it will fallback to OCR on each page.
   */
  private async processPDFFile(fileBuffer: Buffer): Promise<string> {
    let extractedText = await this.extractPDFText(fileBuffer)

    // Check if there was no extracted text or it was very minimal
    if (!extractedText || extractedText.trim().length < 100) {
      logger.debug('[RAG] PDF text extraction minimal, attempting OCR on pages')
      // Convert PDF pages to images for OCR if text extraction was poor
      const imageBuffers = await this.convertPDFtoImages(fileBuffer)
      extractedText = ''

      for (const imgBuffer of imageBuffers) {
        const preprocessedImg = await this.preprocessImage(imgBuffer)
        const pageText = await this.extractImageText(preprocessedImg)
        extractedText += pageText + '\n'
      }
    }

    return extractedText
  }

  /**
   * Process a ZIM file: extract content with metadata and embed each chunk.
   * Returns early with complete result since ZIM processing is self-contained.
   * Supports batch processing to prevent lock timeouts on large ZIM files.
   */
  private async processZIMFile(
    filepath: string,
    deleteAfterEmbedding: boolean,
    batchOffset?: number,
    onProgress?: (percent: number) => Promise<void>
  ): Promise<ProcessZIMFileResponse> {
    const zimExtractionService = new ZIMExtractionService()

    // Process in batches to avoid lock timeout
    const startOffset = batchOffset || 0

    logger.info(
      `[RAG] Extracting ZIM content (batch: offset=${startOffset}, size=${ZIM_BATCH_SIZE})`
    )

    const zimChunks = await zimExtractionService.extractZIMContent(filepath, {
      startOffset,
      batchSize: ZIM_BATCH_SIZE,
    })

    logger.info(
      `[RAG] Extracted ${zimChunks.length} chunks from ZIM file with enhanced metadata`
    )

    // Process each chunk individually with its metadata
    let totalChunks = 0
    for (let i = 0; i < zimChunks.length; i++) {
      const zimChunk = zimChunks[i]
      const result = await this.embedAndStoreText(zimChunk.text, {
        source: filepath,
        content_type: 'zim_article',

        // Article-level context
        article_title: zimChunk.articleTitle,
        article_path: zimChunk.articlePath,

        // Section-level context
        section_title: zimChunk.sectionTitle,
        full_title: zimChunk.fullTitle,
        hierarchy: zimChunk.hierarchy,
        section_level: zimChunk.sectionLevel,

        // Use the same document ID for all chunks from the same article for grouping in search results
        document_id: zimChunk.documentId,

        // Archive metadata
        archive_title: zimChunk.archiveMetadata.title,
        archive_creator: zimChunk.archiveMetadata.creator,
        archive_publisher: zimChunk.archiveMetadata.publisher,
        archive_date: zimChunk.archiveMetadata.date,
        archive_language: zimChunk.archiveMetadata.language,
        archive_description: zimChunk.archiveMetadata.description,

        // Extraction metadata - not overly relevant for search, but could be useful for debugging and future features...
        extraction_strategy: zimChunk.strategy,
      })

      if (result) {
        totalChunks += result.chunks
      }

      if (onProgress) {
        await onProgress(((i + 1) / zimChunks.length) * 100)
      }
    }

    // Count unique articles processed in this batch. hasMoreBatches gates on the
    // article count: zimChunks.length counts section-level chunks (multiple per
    // article under the 'structured' strategy), so comparing it to ZIM_BATCH_SIZE
    // (an article limit) caps processing at the first batch for any real archive.
    const articlesInBatch = new Set(zimChunks.map((c) => c.documentId)).size
    const hasMoreBatches = articlesInBatch >= ZIM_BATCH_SIZE

    logger.info(
      `[RAG] Successfully embedded ${totalChunks} total chunks from ${articlesInBatch} articles (hasMore: ${hasMoreBatches})`
    )

    // Only delete the file when:
    // 1. deleteAfterEmbedding is true (caller wants deletion)
    // 2. No more batches remain (this is the final batch)
    // This prevents race conditions where early batches complete after later ones
    const shouldDelete = deleteAfterEmbedding && !hasMoreBatches
    if (shouldDelete) {
      logger.info(`[RAG] Final batch complete, deleting ZIM file: ${filepath}`)
      await deleteFileIfExists(filepath)
    } else if (!hasMoreBatches) {
      logger.info(`[RAG] Final batch complete, but file deletion was not requested`)
    }

    return {
      success: true,
      message: hasMoreBatches
        ? 'ZIM batch processed successfully. More batches remain.'
        : 'ZIM file processed and embedded successfully with enhanced metadata.',
      chunks: totalChunks,
      hasMoreBatches,
      articlesProcessed: articlesInBatch,
    }
  }

  private async processTextFile(fileBuffer: Buffer): Promise<string> {
    return await this.extractTXTText(fileBuffer)
  }

  private async embedTextAndCleanup(
    extractedText: string,
    filepath: string,
    deleteAfterEmbedding: boolean = false,
    onProgress?: (percent: number) => Promise<void>,
    collection?: string
  ): Promise<{ success: boolean; message: string; chunks?: number }> {
    if (!extractedText || extractedText.trim().length === 0) {
      return { success: false, message: 'Process completed succesfully, but no text was found to embed.' }
    }

    const embedResult = await this.embedAndStoreText(extractedText, {
      source: filepath,
      ...(collection ? { collection } : {})
    }, onProgress)

    if (!embedResult) {
      return { success: false, message: 'Failed to embed and store the extracted text.' }
    }

    if (deleteAfterEmbedding) {
      logger.info(`[RAG] Embedding complete, deleting uploaded file: ${filepath}`)
      await deleteFileIfExists(filepath)
    }

    return {
      success: true,
      message: 'File processed and embedded successfully.',
      chunks: embedResult.chunks,
    }
  }

  /**
   * Main pipeline to process and embed an uploaded file into the RAG knowledge base.
   * This includes text extraction, chunking, embedding, and storing in Qdrant.
   * 
   * Orchestrates file type detection and delegates to specialized processors.
   * For ZIM files, supports batch processing via batchOffset parameter.
   */
  public async processAndEmbedFile(
    filepath: string,
    deleteAfterEmbedding: boolean = false,
    batchOffset?: number,
    onProgress?: (percent: number) => Promise<void>,
    collection?: string
  ): Promise<ProcessAndEmbedFileResponse> {
    try {
      // Partial downloads stage as `<name>.zim.tmp` until the atomic rename to
      // `.zim` on completion (utils/downloads.ts). If one is ever scanned or
      // enqueued mid-download, skip it as a benign no-op — failing it as
      // "Unsupported file type" leaves a scary failure record that retries on every
      // sync. Return before any processing or deletion so the in-progress download
      // is left untouched; the completed `.zim` is picked up on the next pass.
      if (filepath.endsWith('.tmp')) {
        logger.debug(`[RAG] Skipping partial download (not yet complete): ${filepath}`)
        return { success: true, message: 'Skipped partial download (still in progress).' }
      }

      const fileType = determineFileType(filepath)
      logger.debug(`[RAG] Processing file: ${filepath} (detected type: ${fileType})`)

      if (fileType === 'unknown') {
        return { success: false, message: 'Unsupported file type.' }
      }

      // Read file buffer (not needed for ZIM as it reads directly)
      const fileBuffer = fileType !== 'zim' ? await getFile(filepath, 'buffer') : null
      if (fileType !== 'zim' && !fileBuffer) {
        return { success: false, message: 'Failed to read the uploaded file.' }
      }

      // Process based on file type
      // ZIM files are handled specially since they have their own embedding workflow
      if (fileType === 'zim') {
        return await this.processZIMFile(filepath, deleteAfterEmbedding, batchOffset, onProgress)
      }

      // Extract text based on file type
      // Report ~10% when extraction begins; actual embedding progress follows via callback
      if (onProgress) await onProgress(10)
      let extractedText: string
      switch (fileType) {
        case 'image':
          extractedText = await this.processImageFile(fileBuffer!)
          break
        case 'pdf':
          extractedText = await this.processPDFFile(fileBuffer!)
          break
        case 'docx':
          extractedText = await this.processDocxFile(fileBuffer!)
          break
        case 'text':
        default:
          extractedText = await this.processTextFile(fileBuffer!)
          break
      }

      // Extraction done — scale remaining embedding progress from 15% to 100%
      if (onProgress) await onProgress(15)
      const scaledProgress = onProgress
        ? (p: number) => onProgress(15 + p * 0.85)
        : undefined

      // Embed extracted text and cleanup
      return await this.embedTextAndCleanup(extractedText, filepath, deleteAfterEmbedding, scaledProgress, collection)
    } catch (error) {
      logger.error('[RAG] Error processing and embedding file:', error)
      return { success: false, message: 'Error processing and embedding file.' }
    }
  }

  /**
   * Search for documents similar to the query text in the Qdrant knowledge base.
   * Uses a hybrid approach combining semantic similarity and keyword matching.
   * Implements adaptive thresholds and result reranking for optimal retrieval.
   * @param query - The search query text
   * @param limit - Maximum number of results to return (default: 5)
   * @param scoreThreshold - Minimum similarity score threshold (default: 0.3, much lower than before)
   * @returns Array of relevant text chunks with their scores
   */
  public async searchSimilarDocuments(
    query: string,
    limit: number = 5,
    scoreThreshold: number = 0.3, // Lower default threshold - was 0.7, now 0.3
    collection?: string
  ): Promise<Array<{ text: string; score: number; metadata?: Record<string, any> }>> {
    try {
      logger.debug(`[RAG] Starting similarity search for query: "${query}"`)

      await this._ensureCollection(
        RagService.CONTENT_COLLECTION_NAME,
        RagService.EMBEDDING_DIMENSION
      )

      // Check if collection has any points
      const collectionInfo = await this.qdrant!.getCollection(RagService.CONTENT_COLLECTION_NAME)
      const pointCount = collectionInfo.points_count || 0
      logger.debug(`[RAG] Knowledge base contains ${pointCount} document chunks`)

      if (pointCount === 0) {
        logger.debug('[RAG] Knowledge base is empty. Could not perform search.')
        return []
      }

      if (!this.embeddingModelVerified) {
        const allModels = await this.ollamaService.getModels(true)
        const embeddingModel = allModels.find((model) => model.name === RagService.EMBEDDING_MODEL)

        if (!embeddingModel) {
          logger.warn(
            `[RAG] ${RagService.EMBEDDING_MODEL} not found. Cannot perform similarity search.`
          )
          this.embeddingModelVerified = false
          return []
        }
        this.embeddingModelVerified = true
      }

      // Preprocess query for better matching
      const processedQuery = this.preprocessQuery(query)
      const keywords = this.extractKeywords(processedQuery)
      logger.debug(`[RAG] Extracted keywords: [${keywords.join(', ')}]`)

      // Generate embedding for the query with search_query prefix
      const ollamaClient = await this.ollamaService.getClient()

      // Ensure query doesn't exceed token limit
      const prefixTokens = this.estimateTokenCount(RagService.SEARCH_QUERY_PREFIX)
      const maxQueryTokens = RagService.MAX_SAFE_TOKENS - prefixTokens
      const truncatedQuery = this.truncateToTokenLimit(processedQuery, maxQueryTokens)

      const prefixedQuery = RagService.SEARCH_QUERY_PREFIX + truncatedQuery
      logger.debug(`[RAG] Generating embedding with prefix: "${RagService.SEARCH_QUERY_PREFIX}"`)

      // Validate final token count
      const queryTokenCount = this.estimateTokenCount(prefixedQuery)
      if (queryTokenCount > RagService.MAX_SAFE_TOKENS) {
        logger.error(
          `[RAG] Query too long even after truncation: ${queryTokenCount} tokens (max: ${RagService.MAX_SAFE_TOKENS})`
        )
        return []
      }

      const response = await ollamaClient.embed({
        model: RagService.EMBEDDING_MODEL,
        input: [prefixedQuery],
      })

      // Perform semantic search with a higher limit to enable reranking
      const searchLimit = limit * 3 // Get more results for reranking
      logger.debug(
        `[RAG] Searching for top ${searchLimit} semantic matches (threshold: ${scoreThreshold})`
      )

      const searchResults = await this.qdrant!.search(RagService.CONTENT_COLLECTION_NAME, {
        vector: response.embeddings[0],
        limit: searchLimit,
        score_threshold: scoreThreshold,
        with_payload: true,
        ...(collection ? { filter: { must: [{ key: 'collection', match: { value: collection } }] } } : {}),
      })

      logger.debug(`[RAG] Found ${searchResults.length} results above threshold ${scoreThreshold}`)

      // Map results with metadata for reranking
      const resultsWithMetadata: RAGResult[] = searchResults.map((result) => ({
        text: (result.payload?.text as string) || '',
        score: result.score,
        keywords: (result.payload?.keywords as string) || '',
        chunk_index: (result.payload?.chunk_index as number) || 0,
        created_at: (result.payload?.created_at as number) || 0,
        // Enhanced ZIM metadata (likely be undefined for non-ZIM content)
        article_title: result.payload?.article_title as string | undefined,
        section_title: result.payload?.section_title as string | undefined,
        full_title: result.payload?.full_title as string | undefined,
        hierarchy: result.payload?.hierarchy as string | undefined,
        document_id: result.payload?.document_id as string | undefined,
        content_type: result.payload?.content_type as string | undefined,
        source: result.payload?.source as string | undefined,
      }))

      const rerankedResults = this.rerankResults(resultsWithMetadata, keywords, query)

      logger.debug(`[RAG] Top 3 results after reranking:`)
      rerankedResults.slice(0, 3).forEach((result, idx) => {
        logger.debug(
          `[RAG]   ${idx + 1}. Score: ${result.finalScore.toFixed(4)} (semantic: ${result.score.toFixed(4)}) - "${result.text.substring(0, 100)}..."`
        )
      })

      // Apply source diversity penalty to avoid all results from the same document
      const diverseResults = this.applySourceDiversity(rerankedResults)

      // Return top N results with enhanced metadata
      return diverseResults.slice(0, limit).map((result) => ({
        text: result.text,
        score: result.finalScore,
        metadata: {
          chunk_index: result.chunk_index,
          created_at: result.created_at,
          semantic_score: result.score,
          // Enhanced ZIM metadata (likely be undefined for non-ZIM content)
          article_title: result.article_title,
          section_title: result.section_title,
          full_title: result.full_title,
          hierarchy: result.hierarchy,
          document_id: result.document_id,
          content_type: result.content_type,
        },
      }))
    } catch (error) {
      logger.error('[RAG] Error searching similar documents:', error)
      return []
    }
  }

  /**
   * Rerank search results using hybrid scoring that combines:
   * 1. Semantic similarity score (primary signal)
   * 2. Keyword overlap bonus (conservative, quality-gated)
   * 3. Direct term matches (conservative)
   *
   * Tries to boost only already-relevant results, not promote
   * low-quality results just because they have keyword matches.
   *
   * Future: this is a decent feature-based approach, but we could
   * switch to a python-based reranker in the future if the benefits
   * outweigh the overhead.
   */
  private rerankResults(
    results: Array<RAGResult>,
    queryKeywords: string[],
    originalQuery: string
  ): Array<RerankedRAGResult> {
    return results
      .map((result) => {
        let finalScore = result.score

        // Quality gate: Only apply boosts if semantic score is reasonable
        // Try to prevent promoting irrelevant results that just happen to have keyword matches
        const MIN_SEMANTIC_THRESHOLD = 0.35

        if (result.score < MIN_SEMANTIC_THRESHOLD) {
          // For low-scoring results, use semantic score as-is
          // This prevents false positives from keyword gaming
          logger.debug(
            `[RAG] Skipping boost for low semantic score: ${result.score.toFixed(3)} (threshold: ${MIN_SEMANTIC_THRESHOLD})`
          )
          return {
            ...result,
            finalScore,
          }
        }

        // Boost score based on keyword overlap (diminishing returns - overlap goes down, so does boost)
        const docKeywords = result.keywords
          .toLowerCase()
          .split(' ')
          .filter((k) => k.length > 0)
        const matchingKeywords = queryKeywords.filter(
          (kw) =>
            docKeywords.includes(kw.toLowerCase()) ||
            result.text.toLowerCase().includes(kw.toLowerCase())
        )
        const keywordOverlap = matchingKeywords.length / Math.max(queryKeywords.length, 1)

        // Use square root for diminishing returns: 100% overlap = sqrt(1.0) = 1.0, 25% = 0.5
        // Then scale conservatively (max 10% boost instead of 20%)
        const keywordBoost = Math.sqrt(keywordOverlap) * 0.1 * result.score

        if (keywordOverlap > 0) {
          logger.debug(
            `[RAG] Keyword overlap: ${matchingKeywords.length}/${queryKeywords.length} - Boost: ${keywordBoost.toFixed(3)}`
          )
        }

        // Boost if original query terms appear in text (case-insensitive)
        // Scale boost proportionally to base score to avoid over-promoting weak matches
        const queryTerms = originalQuery
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 3)
        const directMatches = queryTerms.filter((term) =>
          result.text.toLowerCase().includes(term)
        ).length

        if (queryTerms.length > 0) {
          const directMatchRatio = directMatches / queryTerms.length
          // Conservative boost: max 7.5% of the base score
          const directMatchBoost = Math.sqrt(directMatchRatio) * 0.075 * result.score

          if (directMatches > 0) {
            logger.debug(
              `[RAG] Direct term matches: ${directMatches}/${queryTerms.length} - Boost: ${directMatchBoost.toFixed(3)}`
            )
            finalScore += directMatchBoost
          }
        }

        // Boost when query keywords appear in the chunk's section/article heading.
        // ZIM content carries this structural metadata (already fetched), and a
        // query term in a heading is a strong relevance signal that body-text
        // matching alone misses. Conservative and score-scaled like the boosts
        // above, so it only re-orders already-retrieved chunks.
        const headingText = [result.full_title, result.section_title, result.article_title]
          .filter(Boolean)
          .join(' ')
        const headingBoost = computeHeadingBoost(headingText, queryKeywords, result.score)
        if (headingBoost > 0) {
          logger.debug(`[RAG] Heading match boost: ${headingBoost.toFixed(3)}`)
          finalScore += headingBoost
        }

        finalScore = Math.min(1.0, finalScore + keywordBoost)

        return {
          ...result,
          finalScore,
        }
      })
      .sort((a, b) => b.finalScore - a.finalScore)
  }

  /**
   * Applies a diversity penalty so results from the same source are down-weighted.
   * Uses greedy selection: for each result, apply 0.85^n penalty where n is the
   * number of results already selected from the same source.
   */
  private applySourceDiversity(
    results: Array<RerankedRAGResult>
  ) {
    const sourceCounts = new Map<string, number>()
    const DIVERSITY_PENALTY = 0.85

    return results
      .map((result) => {
        const sourceKey = result.document_id || result.source || 'unknown'
        const count = sourceCounts.get(sourceKey) || 0
        const penalty = Math.pow(DIVERSITY_PENALTY, count)
        const diverseScore = result.finalScore * penalty

        sourceCounts.set(sourceKey, count + 1)

        if (count > 0) {
          logger.debug(
            `[RAG] Source diversity penalty for "${sourceKey}": ${result.finalScore.toFixed(4)} → ${diverseScore.toFixed(4)} (seen ${count}x)`
          )
        }

        return { ...result, finalScore: diverseScore }
      })
      .sort((a, b) => b.finalScore - a.finalScore)
  }

  /**
   * Whether the knowledge base contains any embedded documents. Used to skip the
   * RAG query-rewrite pipeline entirely when there is nothing to search.
   * @returns true if the content collection has at least one point
   */
  public async hasDocuments(): Promise<boolean> {
    try {
      await this._ensureCollection(RagService.CONTENT_COLLECTION_NAME, RagService.EMBEDDING_DIMENSION)
      const collectionInfo = await this.qdrant!.getCollection(RagService.CONTENT_COLLECTION_NAME)
      return (collectionInfo.points_count ?? 0) > 0
    } catch {
      return false
    }
  }

  /**
   * Retrieve all unique source files that have been stored in the knowledge base.
   * @returns Array of unique full source paths
   */
  public async getStoredFiles(): Promise<StoredFileInfo[]> {
    try {
      await this._ensureCollection(
        RagService.CONTENT_COLLECTION_NAME,
        RagService.EMBEDDING_DIMENSION
      )

      const sources = await this.facetDistinctSources()

      // Union the Qdrant-derived list with the disk-backed file paths the
      // state machine has tracked (RFC #883). Without this, files known to the
      // scanner but with zero embedded chunks (video-only ZIMs, failed-before-
      // first-chunk ingestions, browse_only opt-outs) never get a row in Stored
      // Files. The state machine is the authoritative "what's on disk?" view;
      // Qdrant is "what made it into the vector store?".
      const stateByPath = new Map<string, { state: KbIngestStateValue; chunks_embedded: number; collection: string | null }>()
      try {
        const stateRows = await KbIngestState.query().select('file_path', 'state', 'chunks_embedded', 'collection')
        for (const row of stateRows) {
          sources.add(row.file_path)
          stateByPath.set(row.file_path, {
            state: row.state,
            chunks_embedded: row.chunks_embedded,
            collection: row.collection,
          })
        }
      } catch (error) {
        // Non-fatal: if the state machine query fails we'd rather return the
        // Qdrant-derived list than 500 the whole panel.
        logger.warn(
          { err: error },
          '[RagService.getStoredFiles] state-machine union skipped; returning Qdrant-only list'
        )
      }

      const uploadsAbsPath = resolve(join(process.cwd(), RagService.UPLOADS_STORAGE_PATH))
      return await Promise.all(
        Array.from(sources).map(async (source) => {
          const row = stateByPath.get(source)
          const fileName = source.split(/[/\\]/).at(-1) ?? source
          const isUserUpload = resolve(source).startsWith(uploadsAbsPath + sep)
          const stats = await getFileStatsIfExists(source)
          return {
            source,
            state: row?.state ?? null,
            chunksEmbedded: row?.chunks_embedded ?? 0,
            fileName,
            size: stats?.size ?? null,
            uploadedAt: stats?.modifiedTime.toISOString() ?? null,
            isUserUpload,
            collection: row?.collection ?? null,
          }
        })
      )
    } catch (error) {
      logger.error('Error retrieving stored files:', error)
      return []
    }
  }

  /**
   * Enumerate distinct `collection` values currently in the knowledge base,
   * for populating a subject-picker in the upload/chat UI. Mirrors the
   * `source` facet pattern used by facetDistinctSources.
   */
  public async getKnowledgeCollections(): Promise<string[]> {
    await this._ensureCollection(RagService.CONTENT_COLLECTION_NAME, RagService.EMBEDDING_DIMENSION)
    const facetResult = await this.qdrant!.facet(RagService.CONTENT_COLLECTION_NAME, {
      key: 'collection',
      limit: RagService.FACET_SOURCE_LIMIT,
      exact: true,
    })
    const collections = new Set<string>()
    for (const hit of facetResult.hits) {
      if (typeof hit.value === 'string') collections.add(hit.value)
    }
    return Array.from(collections).sort()
  }

  /**
   * Reassign a stored file's collection after the fact. Updates the `collection`
   * payload field on every existing Qdrant point for this source in place (no
   * re-chunking or re-embedding needed), then mirrors the change onto the
   * KbIngestState row so getStoredFiles() reflects it immediately.
   */
  public async updateFileCollection(
    source: string,
    collection: string | null
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this._ensureCollection(RagService.CONTENT_COLLECTION_NAME, RagService.EMBEDDING_DIMENSION)

      await this.qdrant!.setPayload(RagService.CONTENT_COLLECTION_NAME, {
        payload: { collection },
        filter: { must: [{ key: 'source', match: { value: source } }] },
      })

      const row = await KbIngestState.query().where('file_path', source).first()
      if (row) {
        row.collection = collection
        await row.save()
      }

      return { success: true, message: collection ? `Moved to "${collection}".` : 'Moved to Uncategorized.' }
    } catch (error) {
      logger.error('[RAG] Error updating file collection:', error)
      return { success: false, message: 'Error updating file collection.' }
    }
  }

  /**
   * Rename a knowledge-base collection everywhere it's referenced: updates every
   * Qdrant point tagged with the old name in place, and mirrors the change onto
   * any matching KbIngestState rows so getStoredFiles() reflects it immediately.
   */
  public async renameKnowledgeCollection(
    oldName: string,
    newName: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (!oldName || !newName || oldName === newName) {
        return { success: false, message: 'Invalid collection names.' }
      }
      await this._ensureCollection(RagService.CONTENT_COLLECTION_NAME, RagService.EMBEDDING_DIMENSION)

      await this.qdrant!.setPayload(RagService.CONTENT_COLLECTION_NAME, {
        payload: { collection: newName },
        filter: { must: [{ key: 'collection', match: { value: oldName } }] },
      })

      await KbIngestState.query().where('collection', oldName).update({ collection: newName })

      return { success: true, message: `Renamed "${oldName}" to "${newName}".` }
    } catch (error) {
      logger.error('[RAG] Error renaming knowledge collection:', error)
      return { success: false, message: 'Error renaming collection.' }
    }
  }

  /**
   * Remove a collection by reassigning every file tagged with it back to
   * Uncategorized (collection: null). Non-destructive — no files or embeddings
   * are deleted, only the grouping label is cleared so items can be
   * recategorized later.
   */
  public async deleteKnowledgeCollection(
    name: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      if (!name) {
        return { success: false, message: 'Invalid collection name.' }
      }
      await this._ensureCollection(RagService.CONTENT_COLLECTION_NAME, RagService.EMBEDDING_DIMENSION)

      await this.qdrant!.setPayload(RagService.CONTENT_COLLECTION_NAME, {
        payload: { collection: null },
        filter: { must: [{ key: 'collection', match: { value: name } }] },
      })

      await KbIngestState.query().where('collection', name).update({ collection: null })

      return { success: true, message: `"${name}" removed. Files moved to Uncategorized.` }
    } catch (error) {
      logger.error('[RAG] Error deleting knowledge collection:', error)
      return { success: false, message: 'Error deleting collection.' }
    }
  }

  /**
   * Queue a single file for embedding — the per-card "Index" action for files
   * sitting in `pending_decision` (Manual mode) or retrying after `failed`
   * (RFC #883 §5). `force` clears the file's existing points first (re-embed).
   *
   * Adapted from upstream's embedSingleFile to our fork's plumbing: our
   * EmbedFileJob.dispatch already dedupes in-flight jobs (created:false), and
   * the known-file check is a storage-root containment guard — a source with
   * no state row must live under kb_uploads or the ZIM dir and be embeddable,
   * so the endpoint can't be used to ingest arbitrary host paths.
   */
  public async embedSingleFile(
    source: string,
    force: boolean = false
  ): Promise<{ success: boolean; code?: 'not_found' | 'inflight' | 'delete_failed' | 'dispatch_failed'; message: string }> {
    const stateRow = await KbIngestState.query().where('file_path', source).first()
    if (!stateRow) {
      const uploadsAbsPath = resolve(join(process.cwd(), RagService.UPLOADS_STORAGE_PATH))
      const zimAbsPath = resolve(join(process.cwd(), ZIM_STORAGE_PATH))
      const resolved = resolve(source)
      const inStorage =
        resolved.startsWith(uploadsAbsPath + sep) || resolved.startsWith(zimAbsPath + sep)
      const stats = inStorage ? await getFileStatsIfExists(resolved) : null
      if (!inStorage || !stats || determineFileType(source) === 'unknown') {
        return {
          success: false,
          code: 'not_found',
          message: 'File is not a tracked knowledge-base source.',
        }
      }
    }

    if (force) {
      try {
        await this._ensureCollection(
          RagService.CONTENT_COLLECTION_NAME,
          RagService.EMBEDDING_DIMENSION
        )
        await this.qdrant!.delete(RagService.CONTENT_COLLECTION_NAME, {
          filter: { must: [{ key: 'source', match: { value: source } }] },
        })
      } catch (err) {
        logger.error(`[RAG] Failed to delete prior points for ${source}; aborting re-embed:`, err)
        return {
          success: false,
          code: 'delete_failed',
          message: 'Failed to clear prior embeddings before re-embed.',
        }
      }
    }

    try {
      const { EmbedFileJob } = await import('#jobs/embed_file_job')
      const fileName = source.split(/[/\\]/).pop() || source
      const stats = await getFileStatsIfExists(source)
      const result = await EmbedFileJob.dispatch({
        filePath: source,
        fileName,
        fileSize: stats?.size,
      })
      if (!result.created) {
        return {
          success: false,
          code: 'inflight',
          message: 'A job for this file is already in progress. Wait for it to finish before re-queuing.',
        }
      }
      return {
        success: true,
        message: force ? 'Re-embed queued for this file.' : 'Indexing queued for this file.',
      }
    } catch (err) {
      logger.error(`[RAG] Failed to dispatch embed job for ${source}:`, err)
      return {
        success: false,
        code: 'dispatch_failed',
        message: 'Failed to dispatch embed job for this file.',
      }
    }
  }

  /**
   * Enumerate the distinct `source` payload values in the content collection
   * via Qdrant's facet API (one call). The previous implementation scrolled
   * EVERY point in the collection, 100 per page, just to learn the unique
   * sources — on a fully-ingested NOMAD (millions of points) that took 50+
   * seconds per endpoint. `exact: true` so counts match an exhaustive walk.
   * Forward-port of upstream 97c65cc (perf(KB), #928).
   */
  private async facetDistinctSources(): Promise<Set<string>> {
    const sources = new Set<string>()
    const facetResult = await this.qdrant!.facet(RagService.CONTENT_COLLECTION_NAME, {
      key: 'source',
      limit: RagService.FACET_SOURCE_LIMIT,
      exact: true,
    })
    for (const hit of facetResult.hits) {
      if (typeof hit.value === 'string') sources.add(hit.value)
    }
    return sources
  }

  /**
   * Delete all Qdrant points associated with a given source path and remove
   * the corresponding file from disk if it lives under the uploads directory.
   * @param source - Full source path as stored in Qdrant payloads
   */
  public async deleteFileBySource(source: string): Promise<{ success: boolean; message: string }> {
    try {
      await this._ensureCollection(
        RagService.CONTENT_COLLECTION_NAME,
        RagService.EMBEDDING_DIMENSION
      )

      await this.qdrant!.delete(RagService.CONTENT_COLLECTION_NAME, {
        filter: {
          must: [{ key: 'source', match: { value: source } }],
        },
      })

      logger.info(`[RAG] Deleted all points for source: ${source}`)

      /** Delete the physical file only if it lives inside the uploads directory.
      * resolve() normalises path traversal sequences (e.g. "/../..") before the
      * check to prevent path traversal vulns
      * The trailing sep is to ensure a prefix like "kb_uploads_{something_incorrect}" can't slip through.
      */
      const uploadsAbsPath = join(process.cwd(), RagService.UPLOADS_STORAGE_PATH)
      const resolvedSource = resolve(source)
      if (resolvedSource.startsWith(uploadsAbsPath + sep)) {
        await deleteFileIfExists(resolvedSource)
        logger.info(`[RAG] Deleted uploaded file from disk: ${resolvedSource}`)
      } else {
        logger.warn(`[RAG] File was removed from knowledge base but doesn't live in Nomad's uploads directory, so it can't be safely removed. Skipping deletion of physical file...`)
      }

      // Drop the ingest state row last so the file disappears entirely. Without
      // this, the next scanAndSyncStorage would see `indexed + no chunks` for a
      // path that no longer exists in storage and try to re-embed nothing.
      await KbIngestState.remove(source)

      return { success: true, message: 'File removed from knowledge base.' }
    } catch (error) {
      logger.error('[RAG] Error deleting file from knowledge base:', error)
      return { success: false, message: 'Error deleting file from knowledge base.' }
    }
  }

  public async discoverNomadDocs(force?: boolean): Promise<{ success: boolean; message: string }> {
    try {
      const README_PATH = join(process.cwd(), 'README.md')
      const DOCS_DIR = join(process.cwd(), 'docs')

      const alreadyEmbeddedRaw = await KVStore.getValue('rag.docsEmbedded')
      if (alreadyEmbeddedRaw && !force) {
        logger.info('[RAG] Nomad docs have already been discovered and queued. Skipping.')
        return { success: true, message: 'Nomad docs have already been discovered and queued. Skipping.' }
      }

      const filesToEmbed: Array<{ path: string; source: string }> = []

      const readmeExists = await getFileStatsIfExists(README_PATH)
      if (readmeExists) {
        filesToEmbed.push({ path: README_PATH, source: 'README.md' })
      }

      const dirContents = await listDirectoryContentsRecursive(DOCS_DIR)
      for (const entry of dirContents) {
        if (entry.type === 'file') {
          filesToEmbed.push({ path: entry.key, source: join('docs', entry.name) })
        }
      }

      logger.info(`[RAG] Discovered ${filesToEmbed.length} Nomad doc files to embed`)

      // Import EmbedFileJob dynamically to avoid circular dependencies
      const { EmbedFileJob } = await import('#jobs/embed_file_job')

      // Dispatch an EmbedFileJob for each discovered file
      for (const fileInfo of filesToEmbed) {
        try {
          logger.info(`[RAG] Dispatching embed job for: ${fileInfo.source}`)
          await EmbedFileJob.dispatch({
            filePath: fileInfo.path,
            fileName: fileInfo.source,
          })
          logger.info(`[RAG] Successfully dispatched job for ${fileInfo.source}`)
        } catch (fileError) {
          logger.error(
            `[RAG] Error dispatching job for file ${fileInfo.source}:`,
            fileError
          )
        }
      }

      // Update KV store to mark docs as discovered so we don't redo this unnecessarily
      await KVStore.setValue('rag.docsEmbedded', true)

      return { success: true, message: `Nomad docs discovery completed. Dispatched ${filesToEmbed.length} embedding jobs.` }
    } catch (error) {
      logger.error('Error discovering Nomad docs:', error)
      return { success: false, message: 'Error discovering Nomad docs.' }
    }
  }

  /**
   * Scans the knowledge base storage directories and syncs with Qdrant.
   * Identifies files that exist in storage but haven't been embedded yet,
   * and dispatches EmbedFileJob for each missing file.
   *
   * @returns Object containing success status, message, and counts of scanned/queued files
   */
  public async scanAndSyncStorage(): Promise<{
    success: boolean
    message: string
    filesScanned?: number
    filesQueued?: number
  }> {
    try {
      logger.info('[RAG] Starting knowledge base sync scan')

      const KB_UPLOADS_PATH = join(process.cwd(), RagService.UPLOADS_STORAGE_PATH)
      const ZIM_PATH = join(process.cwd(), ZIM_STORAGE_PATH)

      const filesInStorage: string[] = []

      // Force resync of Nomad docs
      await this.discoverNomadDocs(true).catch((error) => {
        logger.error('[RAG] Error during Nomad docs discovery in sync process:', error)
      })

      // Scan kb_uploads directory
      try {
        const kbContents = await listDirectoryContentsRecursive(KB_UPLOADS_PATH)
        kbContents.forEach((entry) => {
          if (entry.type === 'file') {
            filesInStorage.push(entry.key)
          }
        })
        logger.debug(`[RAG] Found ${kbContents.length} files in ${RagService.UPLOADS_STORAGE_PATH}`)
      } catch (error) {
        if (error.code === 'ENOENT') {
          logger.debug(`[RAG] ${RagService.UPLOADS_STORAGE_PATH} directory does not exist, skipping`)
        } else {
          throw error
        }
      }

      // Scan zim directory
      try {
        const zimContents = await listDirectoryContentsRecursive(ZIM_PATH)
        zimContents.forEach((entry) => {
          if (entry.type === 'file') {
            filesInStorage.push(entry.key)
          }
        })
        logger.debug(`[RAG] Found ${zimContents.length} files in ${ZIM_STORAGE_PATH}`)
      } catch (error) {
        if (error.code === 'ENOENT') {
          logger.debug(`[RAG] ${ZIM_STORAGE_PATH} directory does not exist, skipping`)
        } else {
          throw error
        }
      }

      logger.info(`[RAG] Found ${filesInStorage.length} total files in storage directories`)

      // Get all stored sources from Qdrant
      await this._ensureCollection(
        RagService.CONTENT_COLLECTION_NAME,
        RagService.EMBEDDING_DIMENSION
      )

      // One facet call instead of scrolling every point (see facetDistinctSources).
      const sourcesInQdrant = await this.facetDistinctSources()

      logger.info(`[RAG] Found ${sourcesInQdrant.size} unique sources in Qdrant`)

      // Per-file ingest state machine (RFC #883). The state row is the
      // authoritative answer; Qdrant chunk presence corroborates. Replaces the
      // old binary `!sourcesInQdrant.has(filePath)` check, which couldn't tell
      // a fully-indexed file from a stalled mid-batch ingestion and couldn't
      // honor a "browse only" choice.
      const stateRows = await KbIngestState.query().select('file_path', 'state')
      const stateByPath = new Map(stateRows.map((row) => [row.file_path, row]))

      // Non-embeddable files (e.g. Kiwix's generated kiwix-library.xml under
      // /storage/zim) would otherwise be dispatched to EmbedFileJob, fail with
      // "Unsupported file type", and retry on every sync, flooding the logs.
      const embeddableFiles = filesInStorage.filter(
        (filePath) => determineFileType(filePath) !== 'unknown'
      )

      // Global ingest policy. Unset is treated as 'Always' so existing installs
      // keep their behavior until the user opts into Manual from the KB panel.
      const policyRaw = await KVStore.getValue('rag.defaultIngestPolicy')
      const policy: IngestPolicy = policyRaw === 'Manual' ? 'Manual' : 'Always'

      const filesToEmbed: string[] = []
      let backfilled = 0
      let createdRows = 0
      let createdPending = 0
      let skipped = 0

      for (const filePath of embeddableFiles) {
        const stateRow = stateByPath.get(filePath) ?? null
        const action = decideScanAction(stateRow, sourcesInQdrant.has(filePath), policy)

        switch (action.kind) {
          case 'skip':
            skipped++
            break
          case 'backfill_indexed':
            // Pre-RFC install (or a fresh admin pointed at an existing Qdrant
            // volume): chunks already exist with no state row, so trust Qdrant
            // and record `indexed` without re-embedding. chunks_embedded stays 0
            // because we don't count points-per-source here.
            await KbIngestState.create({
              file_path: filePath,
              state: 'indexed',
              chunks_embedded: 0,
            })
            backfilled++
            break
          case 'create_pending':
            // Manual mode: record that we've seen the file but don't dispatch.
            // The KB panel surfaces a per-card "Index" affordance for these.
            await KbIngestState.create({
              file_path: filePath,
              state: 'pending_decision',
              chunks_embedded: 0,
            })
            createdPending++
            break
          case 'dispatch':
            if (action.createStateRow) {
              await KbIngestState.create({
                file_path: filePath,
                state: 'pending_decision',
                chunks_embedded: 0,
              })
              createdRows++
            }
            filesToEmbed.push(filePath)
            break
        }
      }

      logger.info(
        `[RAG] Scan results (policy=${policy}): ${filesToEmbed.length} to embed, ${backfilled} backfilled, ${createdRows} new pending, ${createdPending} waiting on user, ${skipped} skipped`
      )

      if (filesToEmbed.length === 0) {
        return {
          success: true,
          message: 'Knowledge base is already in sync',
          filesScanned: filesInStorage.length,
          filesQueued: 0,
        }
      }

      // Import EmbedFileJob dynamically to avoid circular dependencies
      const { EmbedFileJob } = await import('#jobs/embed_file_job')

      // Dispatch jobs for files that need embedding
      let queuedCount = 0
      for (const filePath of filesToEmbed) {
        try {
          const fileName = filePath.split(/[/\\]/).pop() || filePath
          const stats = await getFileStatsIfExists(filePath)

          logger.info(`[RAG] Dispatching embed job for: ${fileName}`)
          const result = await EmbedFileJob.dispatch({
            filePath: filePath,
            fileName: fileName,
            fileSize: stats?.size,
          })
          // Only count jobs that actually entered the queue — skipped
          // in-flight dispatches (created:false) must not inflate the toast.
          if (result.created) {
            queuedCount++
            logger.debug(`[RAG] Successfully dispatched job for ${fileName}`)
          } else {
            logger.debug(`[RAG] Embed job already in-flight for ${fileName}, not counted`)
          }
        } catch (fileError) {
          logger.error(`[RAG] Error dispatching job for file ${filePath}:`, fileError)
        }
      }

      return {
        success: true,
        message: `Scanned ${filesInStorage.length} files, queued ${queuedCount} for embedding`,
        filesScanned: filesInStorage.length,
        filesQueued: queuedCount,
      }
    } catch (error) {
      logger.error('[RAG] Error scanning and syncing knowledge base:', error)
      return {
        success: false,
        message: 'Error scanning and syncing knowledge base',
      }
    }
  }
}
