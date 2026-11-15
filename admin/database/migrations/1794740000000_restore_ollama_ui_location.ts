import { BaseSchema } from '@adonisjs/lucid/schema'
import { SERVICE_NAMES } from '../../constants/service_names.js'

export default class extends BaseSchema {
  async up() {
    // Editing the AI Assistant used to replace /chat with its API port (or null).
    // Repair only that shape; leave custom paths/URLs and container settings alone.
    this.defer(async (db) => {
      const rows = await db
        .from('services')
        .where('service_name', SERVICE_NAMES.OLLAMA)
        .select('id', 'ui_location')
      for (const row of rows) {
        if (row.ui_location === null || /^(?:https?:)?\d+$/.test(row.ui_location)) {
          await db
            .from('services')
            .where('id', row.id)
            .where('ui_location', row.ui_location)
            .update({ ui_location: '/chat' })
        }
      }
    })
  }

  async down() {
    // A data repair cannot reconstruct the lost path. Keep the working /chat link.
  }
}
