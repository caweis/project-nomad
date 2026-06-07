import { Queue } from 'bullmq'
import queueConfig from '#config/queue'

// Process-wide singleton. Each BullMQ `Queue` opens two ioredis connections
// (one for commands, one blocking). Constructing a fresh QueueService per
// dispatch / status lookup never shared the `queues` cache, so every call
// opened a new pair and none were closed — under sustained job churn (a
// multi-batch ZIM ingestion enqueues a continuation every few seconds) that
// saturates Redis's maxclients within hours. getInstance() shares one cache
// for the process lifetime so each queue connects exactly once.
export class QueueService {
  private queues: Map<string, Queue> = new Map()

  private static _instance: QueueService | null = null

  private constructor() {}

  static getInstance(): QueueService {
    if (!QueueService._instance) {
      QueueService._instance = new QueueService()
    }
    return QueueService._instance
  }

  getQueue(name: string): Queue {
    if (!this.queues.has(name)) {
      const queue = new Queue(name, {
        connection: queueConfig.connection,
      })
      this.queues.set(name, queue)
    }
    return this.queues.get(name)!
  }

  async close() {
    for (const queue of this.queues.values()) {
      await queue.close()
    }
    this.queues.clear()
  }
}
