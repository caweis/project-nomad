import ScenarioPlan from '#models/scenario_plan'
import ScenarioPlanStep from '#models/scenario_plan_step'
import type { Scenario, ScenarioPlanSlim } from '../../types/scenarios.js'

/**
 * Self-Reliance Suite — Scenario Plans data access + business logic (Phase 3).
 *
 * CRUD on plans and their steps. Mirrors InventoryService's shape: a class with
 * the data-access/business logic returning plain models or result objects; the
 * controller maps to the Inertia DTOs. No filesystem — plans and steps are pure
 * DB rows.
 *
 * Step ordering: `position` is 0-based within a plan. addStep appends at the
 * current max position + 1 so new steps land at the end without the caller
 * tracking the count.
 */

export interface CreatePlanData {
  scenario: Scenario
  title: string
  description?: string | null
}

export type UpdatePlanData = Partial<CreatePlanData>

export interface CreateStepData {
  text: string
  position?: number
  inventory_item_id?: number | null
  stl_file_id?: number | null
  zim_ref?: string | null
}

export type UpdateStepData = Partial<
  CreateStepData & {
    checked: boolean
  }
>

export class ScenarioPlanService {
  // ─── Plans ──────────────────────────────────────────────────────────────

  async createPlan(data: CreatePlanData): Promise<ScenarioPlan> {
    const plan = new ScenarioPlan()
    plan.scenario = data.scenario
    plan.title = data.title
    plan.description = data.description ?? null
    await plan.save()
    return plan
  }

  /** Patch only the fields present on `data` (the Inventory update pattern). */
  async updatePlan(id: number, data: UpdatePlanData): Promise<ScenarioPlan | null> {
    const plan = await ScenarioPlan.find(id)
    if (!plan) return null

    if (data.scenario !== undefined) plan.scenario = data.scenario
    if (data.title !== undefined) plan.title = data.title
    if (data.description !== undefined) plan.description = data.description ?? null

    await plan.save()
    return plan
  }

  /** Delete a plan. Its steps CASCADE-delete via the FK. */
  async destroyPlan(id: number): Promise<boolean> {
    const plan = await ScenarioPlan.find(id)
    if (!plan) return false
    await plan.delete()
    return true
  }

  /**
   * All plans with their done/total step tallies, newest first. The tally is a
   * grouped aggregate so a large plan list doesn't ship every step row.
   */
  async listPlans(): Promise<ScenarioPlanSlim[]> {
    const plans = await ScenarioPlan.query().orderBy('added_at', 'desc')
    if (plans.length === 0) return []

    const tallies = await ScenarioPlanStep.query()
      .select('plan_id')
      .count('* as total')
      .sum({ checked: 'checked' })
      .groupBy('plan_id')

    const byPlan = new Map<number, { total: number; checked: number }>()
    for (const row of tallies) {
      const planId = Number((row.$extras as { plan_id: unknown }).plan_id)
      byPlan.set(planId, {
        total: Number((row.$extras as { total: unknown }).total ?? 0),
        checked: Number((row.$extras as { checked: unknown }).checked ?? 0),
      })
    }

    return plans.map((plan) => {
      const tally = byPlan.get(plan.id) ?? { total: 0, checked: 0 }
      return {
        id: plan.id,
        scenario: plan.scenario,
        title: plan.title,
        description: plan.description,
        total_steps: tally.total,
        checked_steps: tally.checked,
      }
    })
  }

  /**
   * A plan with its steps in position order, each step preloading its linked
   * inventory item / STL file (for the cross-link label). A SET NULL'd FK loads
   * a null relation, so the detail page can show "linked item removed."
   */
  async findPlanWithSteps(id: number): Promise<ScenarioPlan | null> {
    return ScenarioPlan.query()
      .where('id', id)
      .preload('steps', (stepsQuery) => {
        stepsQuery
          .orderBy('position', 'asc')
          .orderBy('id', 'asc')
          .preload('inventoryItem')
          .preload('stlFile')
      })
      .first()
  }

  // ─── Steps ──────────────────────────────────────────────────────────────

  /**
   * Append a step to a plan. When the caller doesn't pin a position the step
   * lands at max(position) + 1 so it goes to the end. Returns null if the plan
   * doesn't exist (so the controller can 404 rather than orphan a step).
   */
  async addStep(planId: number, data: CreateStepData): Promise<ScenarioPlanStep | null> {
    const plan = await ScenarioPlan.find(planId)
    if (!plan) return null

    let position = data.position
    if (position === undefined) {
      const maxRow = await ScenarioPlanStep.query()
        .where('plan_id', planId)
        .max('position as max_position')
        .first()
      const max = maxRow ? Number((maxRow.$extras as { max_position: unknown }).max_position ?? -1) : -1
      position = Number.isFinite(max) ? max + 1 : 0
    }

    const step = new ScenarioPlanStep()
    step.plan_id = planId
    step.text = data.text
    step.position = position
    step.checked = false
    step.inventory_item_id = data.inventory_item_id ?? null
    step.stl_file_id = data.stl_file_id ?? null
    step.zim_ref = normalizeZimRef(data.zim_ref)
    await step.save()
    return step
  }

  /** Patch present fields of a step. Used for text/position/link edits + toggle. */
  async updateStep(
    planId: number,
    stepId: number,
    data: UpdateStepData
  ): Promise<ScenarioPlanStep | null> {
    const step = await ScenarioPlanStep.query()
      .where('id', stepId)
      .where('plan_id', planId)
      .first()
    if (!step) return null

    if (data.text !== undefined) step.text = data.text
    if (data.position !== undefined) step.position = data.position
    if (data.checked !== undefined) step.checked = data.checked
    if (data.inventory_item_id !== undefined) step.inventory_item_id = data.inventory_item_id ?? null
    if (data.stl_file_id !== undefined) step.stl_file_id = data.stl_file_id ?? null
    if (data.zim_ref !== undefined) step.zim_ref = normalizeZimRef(data.zim_ref)

    await step.save()
    return step
  }

  /**
   * Single-row checked toggle/set — the table-not-JSON decision pays off here: a
   * checkbox flip is one row PATCH, never a blob rewrite, so rapid toggling
   * can't lose updates.
   */
  async toggleStep(
    planId: number,
    stepId: number,
    checked: boolean
  ): Promise<ScenarioPlanStep | null> {
    return this.updateStep(planId, stepId, { checked })
  }

  /** Delete one step (scoped to its plan so a stray id can't delete elsewhere). */
  async destroyStep(planId: number, stepId: number): Promise<boolean> {
    const step = await ScenarioPlanStep.query()
      .where('id', stepId)
      .where('plan_id', planId)
      .first()
    if (!step) return false
    await step.delete()
    return true
  }
}

/** Normalize a zim_ref: trim, and treat blank/whitespace as cleared (null). */
function normalizeZimRef(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
