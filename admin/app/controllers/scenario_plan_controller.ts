import type { HttpContext } from '@adonisjs/core/http'
import { ScenarioPlanService } from '#services/scenario_plan_service'
import {
  atMostOneLink,
  createPlanValidator,
  createStepValidator,
  toggleStepValidator,
  updatePlanValidator,
  updateStepValidator,
} from '#validators/scenarios'
import {
  SCENARIO_LABELS,
  SCENARIOS,
  type ScenarioPlanDetail,
  type ScenarioPlanStepDto,
} from '../../types/scenarios.js'

/**
 * Self-Reliance Suite — Scenario Plans HTTP boundary (Phase 3).
 *
 * Renders the create + detail Inertia pages and a JSON API for plan and step
 * mutations. The plans LIST now lives as the "Scenario Plans" tab of the
 * Preparedness (ReadinessController supplies the list), so this controller
 * no longer renders a list page. Mirrors the InventoryController shape: new/show
 * render Inertia; mutations are JSON; integer-id guards on every id param; never
 * leak exceptions to the UI. Plans/steps are pure DB rows, so there is no "drive
 * unavailable" branch.
 */
export default class ScenarioPlanController {
  /** GET /plans/new — create form. The show page doubles as create (plan: null). */
  async new({ inertia }: HttpContext) {
    return inertia.render('plans/show', {
      plan: null,
      enums: this.enumsForUi(),
    })
  }

  /** GET /plans/:id — detail / edit page with the plan's steps + resolved links. */
  async show({ inertia, params, response }: HttpContext) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.notFound({ error: 'invalid id' })
    }

    const service = new ScenarioPlanService()
    const plan = await service.findPlanWithSteps(id)
    if (!plan) {
      return response.notFound({ error: 'Scenario plan not found' })
    }

    const steps: ScenarioPlanStepDto[] = plan.steps.map((step) => ({
      id: step.id,
      plan_id: step.plan_id,
      position: step.position,
      text: step.text,
      checked: step.checked,
      inventory_item_id: step.inventory_item_id,
      stl_file_id: step.stl_file_id,
      zim_ref: step.zim_ref,
      // The preloaded relation is null when the FK is null or was SET NULL'd
      // (target deleted); the UI shows "linked item removed" in that case.
      linked_name: step.inventoryItem?.name ?? step.stlFile?.name ?? null,
      linked_name_snapshot: step.linked_name_snapshot,
    }))

    const detail: ScenarioPlanDetail = {
      id: plan.id,
      scenario: plan.scenario,
      title: plan.title,
      description: plan.description,
      steps,
    }

    return inertia.render('plans/show', {
      plan: detail,
      enums: this.enumsForUi(),
    })
  }

  // ─── Plan mutations ───────────────────────────────────────────────────────

  /** POST /api/plans — create a plan. */
  async store({ request }: HttpContext) {
    const payload = await request.validateUsing(createPlanValidator)
    const service = new ScenarioPlanService()
    const plan = await service.createPlan(payload)
    return { success: true, id: plan.id }
  }

  /** PATCH /api/plans/:id — patch present fields. */
  async update({ params, request, response }: HttpContext) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.badRequest({ error: 'invalid id' })
    }
    const payload = await request.validateUsing(updatePlanValidator)
    const service = new ScenarioPlanService()
    const plan = await service.updatePlan(id, payload)
    if (!plan) return response.notFound({ error: 'Scenario plan not found' })
    return { success: true }
  }

  /** DELETE /api/plans/:id — delete a plan (steps CASCADE). */
  async destroy({ params, response }: HttpContext) {
    const id = Number(params.id)
    if (!Number.isInteger(id) || id <= 0) {
      return response.badRequest({ error: 'invalid id' })
    }
    const service = new ScenarioPlanService()
    const ok = await service.destroyPlan(id)
    if (!ok) return response.notFound({ error: 'Scenario plan not found' })
    return { success: true }
  }

  // ─── Step mutations ───────────────────────────────────────────────────────

  /** POST /api/plans/:planId/steps — append a step. */
  async storeStep({ params, request, response }: HttpContext) {
    const planId = Number(params.planId)
    if (!Number.isInteger(planId) || planId <= 0) {
      return response.badRequest({ error: 'invalid plan id' })
    }

    const payload = await request.validateUsing(createStepValidator)

    const gate = atMostOneLink(payload)
    if (!gate.ok) return response.badRequest({ error: gate.error })

    const service = new ScenarioPlanService()
    const step = await service.addStep(planId, payload)
    if (!step) return response.notFound({ error: 'Scenario plan not found' })
    return { success: true, id: step.id }
  }

  /** PATCH /api/plans/:planId/steps/:id — patch a step's text/position/link. */
  async updateStep({ params, request, response }: HttpContext) {
    const planId = Number(params.planId)
    const stepId = Number(params.id)
    if (!Number.isInteger(planId) || planId <= 0 || !Number.isInteger(stepId) || stepId <= 0) {
      return response.badRequest({ error: 'invalid id' })
    }

    const payload = await request.validateUsing(updateStepValidator)

    // Validate the EFFECTIVE post-patch link state so clearing one link and
    // setting another in the same payload, or leaving an existing link in place,
    // is judged correctly against the at-most-one rule.
    const existing = await new ScenarioPlanService()
      .findPlanWithSteps(planId)
      .then((plan) => plan?.steps.find((s) => s.id === stepId) ?? null)
    if (!existing) return response.notFound({ error: 'Step not found' })

    const effective = {
      inventory_item_id:
        payload.inventory_item_id !== undefined
          ? payload.inventory_item_id
          : existing.inventory_item_id,
      stl_file_id:
        payload.stl_file_id !== undefined ? payload.stl_file_id : existing.stl_file_id,
      zim_ref: payload.zim_ref !== undefined ? payload.zim_ref : existing.zim_ref,
    }
    const gate = atMostOneLink(effective)
    if (!gate.ok) return response.badRequest({ error: gate.error })

    const service = new ScenarioPlanService()
    const step = await service.updateStep(planId, stepId, payload)
    if (!step) return response.notFound({ error: 'Step not found' })
    return { success: true }
  }

  /** PATCH /api/plans/:planId/steps/:id/toggle — single-row checked set. */
  async toggleStep({ params, request, response }: HttpContext) {
    const planId = Number(params.planId)
    const stepId = Number(params.id)
    if (!Number.isInteger(planId) || planId <= 0 || !Number.isInteger(stepId) || stepId <= 0) {
      return response.badRequest({ error: 'invalid id' })
    }
    const { checked } = await request.validateUsing(toggleStepValidator)
    const service = new ScenarioPlanService()
    const step = await service.toggleStep(planId, stepId, checked)
    if (!step) return response.notFound({ error: 'Step not found' })
    return { success: true, checked: step.checked }
  }

  /** DELETE /api/plans/:planId/steps/:id — delete one step. */
  async destroyStep({ params, response }: HttpContext) {
    const planId = Number(params.planId)
    const stepId = Number(params.id)
    if (!Number.isInteger(planId) || planId <= 0 || !Number.isInteger(stepId) || stepId <= 0) {
      return response.badRequest({ error: 'invalid id' })
    }
    const service = new ScenarioPlanService()
    const ok = await service.destroyStep(planId, stepId)
    if (!ok) return response.notFound({ error: 'Step not found' })
    return { success: true }
  }

  // ─── helpers ────────────────────────────────────────────────────────────

  private enumsForUi() {
    return {
      scenarios: SCENARIOS.map((s) => ({ value: s, label: SCENARIO_LABELS[s] })),
    }
  }
}
