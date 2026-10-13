import { Queue } from 'bullmq'
import queueConfig from '#config/queue'

// Process-wide singleton. Reuse Queue objects for each name and share their
// command connection through queueConfig. A fresh QueueService per dispatch
// would discard this cache and leave clients behind during long ingests.
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
