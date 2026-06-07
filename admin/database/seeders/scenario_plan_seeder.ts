import { BaseSeeder } from '@adonisjs/lucid/seeders'
import ScenarioPlan from '#models/scenario_plan'
import ScenarioPlanStep from '#models/scenario_plan_step'
import type { Scenario } from '../../types/scenarios.js'

/**
 * Self-Reliance Suite — Scenario Plans starter templates (Phase 3).
 *
 * Seeds a few editable starter plans so the feature isn't empty on first open.
 * Runs automatically on every deploy: both install/entrypoint.sh and
 * install/macos/nomad invoke `node ace db:seed` (with no seeder name, which runs
 * EVERY seeder in database/seeders/), so this file is picked up alongside
 * service_seeder.ts with no wiring change needed.
 *
 * IDEMPOTENT (the service_seeder convention): a starter plan is identified by
 * (scenario, title); if a plan with that pair already exists it is skipped
 * entirely — neither the plan nor its steps are touched — so re-running on
 * upgrade never duplicates and never stomps a user's edits to a seeded plan.
 *
 * Step copy is a non-authoritative starting point (suite design spec §5.0): the
 * user edits these to their situation. ZIM cross-links use the Kiwix-reader base
 * (port 8090 via getServiceLink) only where a relevant offline article is
 * commonly installed; if Kiwix isn't installed the step text still renders and
 * the link simply won't resolve.
 */
export default class ScenarioPlanSeeder extends BaseSeeder {
  /** Kiwix reader base (the service's ui_location is port 8090). */
  private static KIWIX_BASE = 'http://localhost:8090'

  private static STARTERS: StarterPlan[] = [
    {
      scenario: 'blackout',
      title: 'Power outage',
      description: 'First moves when the grid goes down.',
      steps: [
        { text: 'Check fuel on hand for the generator and stove.' },
        { text: 'Locate flashlights, headlamps, and spare batteries.' },
        { text: 'Keep the fridge and freezer closed to hold the cold.' },
        {
          text: 'Read up on power-outage and carbon-monoxide safety.',
          zim_ref: `${ScenarioPlanSeeder.KIWIX_BASE}/`,
        },
      ],
    },
    {
      scenario: 'evacuation',
      title: 'Grab-and-go evacuation',
      description: 'A 3-day go-bag and the order you leave in.',
      steps: [
        { text: 'Grab the go-bag: 3 days of water, food, meds, and copies of key documents.' },
        { text: 'Fuel the vehicle and confirm two routes out.' },
        { text: 'Account for everyone, including pets and their food/water.' },
        { text: 'Shut off utilities if advised, then leave early — do not wait.' },
      ],
    },
    {
      scenario: 'water-contamination',
      title: 'Water contamination',
      description: 'When the tap water is unsafe.',
      steps: [
        { text: 'Stop drinking from the tap; switch to stored or bottled water.' },
        { text: 'Locate your stored drinking water and ration to ~1 gallon per person per day.' },
        {
          text: 'Follow the boil-water procedure: rolling boil for 1 minute before use.',
          zim_ref: `${ScenarioPlanSeeder.KIWIX_BASE}/`,
        },
        { text: 'Disinfect or filter if you cannot boil; let cloudy water settle first.' },
      ],
    },
  ]

  async run() {
    for (const starter of ScenarioPlanSeeder.STARTERS) {
      // Idempotency gate: skip if a plan with this (scenario, title) already
      // exists. Don't touch existing rows — a user may have edited a seeded plan.
      const existing = await ScenarioPlan.query()
        .where('scenario', starter.scenario)
        .where('title', starter.title)
        .first()
      if (existing) continue

      const plan = new ScenarioPlan()
      plan.scenario = starter.scenario
      plan.title = starter.title
      plan.description = starter.description ?? null
      await plan.save()

      let position = 0
      for (const step of starter.steps) {
        const row = new ScenarioPlanStep()
        row.plan_id = plan.id
        row.position = position++
        row.text = step.text
        row.checked = false
        row.inventory_item_id = step.inventory_item_id ?? null
        row.stl_file_id = step.stl_file_id ?? null
        row.zim_ref = step.zim_ref ?? null
        await row.save()
      }
    }
  }
}

interface StarterStep {
  text: string
  inventory_item_id?: number | null
  stl_file_id?: number | null
  zim_ref?: string | null
}

interface StarterPlan {
  scenario: Scenario
  title: string
  description?: string | null
  steps: StarterStep[]
}
