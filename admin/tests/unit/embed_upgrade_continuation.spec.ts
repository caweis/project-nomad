import { test } from '@japa/runner'
import { EmbedFileJob } from '#jobs/embed_file_job'
import { RagService } from '#services/rag_service'
import { DockerService } from '#services/docker_service'
import { OllamaService } from '#services/ollama_service'
import KbIngestState from '#models/kb_ingest_state'

test.group('embedding across an upgrade', () => {
  for (const offset of [undefined, 0, 50]) {
    test(`preserves completed batches at offset ${offset ?? 'initial'}`, async ({ assert }) => {
      const original = {
        models: OllamaService.prototype.getModels,
        url: DockerService.prototype.getServiceURL,
        purge: RagService.prototype.purgeLegacyPointIds,
        process: RagService.prototype.processAndEmbedFile,
        find: KbIngestState.findBy,
        indexed: KbIngestState.markIndexed,
      }
      let legacyPoints = 2
      let newPoints = 0
      let indexedCount: number | undefined
      let processedOffset: number | undefined
      OllamaService.prototype.getModels = async () => []
      DockerService.prototype.getServiceURL = async () => 'http://qdrant.test:6333'
      RagService.prototype.purgeLegacyPointIds = async () => {
        legacyPoints = 0
      }
      RagService.prototype.processAndEmbedFile = async (_path, _delete, batchOffset) => {
        processedOffset = batchOffset
        newPoints += 1
        return { success: true, chunks: 1, message: 'Embedded', hasMoreBatches: false }
      }
      KbIngestState.findBy = async () => null
      KbIngestState.markIndexed = async (_path, chunks) => {
        indexedCount = chunks
      }
      const job: any = {
        id: 'pre-upgrade-job',
        data: {
          filePath: '/library/guide.zim',
          fileName: 'guide.zim',
          batchOffset: offset,
          chunksSoFar: offset === 50 ? 2 : 0,
        },
        updateProgress: async () => {},
        async updateData(data: any) {
          this.data = data
        },
      }
      try {
        await new EmbedFileJob().handle(job)
        assert.equal(processedOffset, offset)
        assert.equal(legacyPoints, offset === 50 ? 2 : 0)
        assert.equal(indexedCount, legacyPoints + newPoints)
        assert.equal(job.data.status, 'completed')
      } finally {
        OllamaService.prototype.getModels = original.models
        DockerService.prototype.getServiceURL = original.url
        RagService.prototype.purgeLegacyPointIds = original.purge
        RagService.prototype.processAndEmbedFile = original.process
        KbIngestState.findBy = original.find
        KbIngestState.markIndexed = original.indexed
      }
    })
  }
})
