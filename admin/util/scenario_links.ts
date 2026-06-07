/**
 * Self-Reliance Suite — Phase 3 pure step-link resolution.
 *
 * No DB, no Adonis imports — the embed_jobs.ts / units.ts shape, so this is
 * unit-testable without booting AdonisJS/MySQL/Redis (the local test contract;
 * see the suite design spec §8).
 *
 * A scenario-plan step carries AT MOST ONE optional cross-link to another part
 * of the appliance: an inventory item, an STL file in the Workshop, or a ZIM
 * article in the Kiwix reader. The link is identified purely by which of the
 * three nullable fields is set — there is no separate link_type discriminator
 * column (a deliberate simplification from spec §6.2's discriminator: the three
 * fields are already mutually exclusive by construction, and a precedence rule
 * makes resolution deterministic even if two were somehow set).
 *
 * Precedence when more than one field is set (defensive — the validator enforces
 * at most one): inventory > stl > zim. Inventory and STL links point at internal
 * appliance routes; a ZIM link is an external Kiwix-reader reference, so the
 * internal links win to avoid sending the user off to the reader when a
 * first-class internal target exists.
 *
 * Href conventions (mirroring the existing route table):
 *   • inventory → `/inventory/${id}`   (InventoryController.show)
 *   • stl       → `/workshop/${id}`    (WorkshopController.show)
 *   • zim       → the stored zim_ref verbatim. zim_ref is a Kiwix article
 *                 URL or path the reader understands; the Kiwix service is
 *                 reached at port 8090 via getServiceLink('8090'), so a fully
 *                 qualified ref (http://host:8090/...) or an absolute path is
 *                 stored as-is and used as the href.
 */

/** The kind of target a step links to, or 'none' when the step has no link. */
export type StepLinkKind = 'inventory' | 'stl' | 'zim' | 'none'

/**
 * The resolved link the UI renders. `kind` drives the icon/label; `href` is
 * where the link navigates (null only when kind is 'none').
 */
export interface ResolvedStepLink {
  kind: StepLinkKind
  href: string | null
}

/**
 * Resolve a step's single optional cross-link to a kind + href. Pure: takes only
 * the step's three nullable link fields, returns the navigable link or
 * { kind: 'none', href: null } when nothing is linked.
 *
 * Precedence (when multiple are set, which the validator prevents): inventory >
 * stl > zim. A zim_ref of '' (empty/whitespace) is treated as unset.
 */
export function resolveStepLink(step: {
  inventory_item_id?: number | null
  stl_file_id?: number | null
  zim_ref?: string | null
}): ResolvedStepLink {
  // inventory wins
  if (step.inventory_item_id !== null && step.inventory_item_id !== undefined) {
    return { kind: 'inventory', href: `/inventory/${step.inventory_item_id}` }
  }

  // then stl
  if (step.stl_file_id !== null && step.stl_file_id !== undefined) {
    return { kind: 'stl', href: `/workshop/${step.stl_file_id}` }
  }

  // then zim — an empty/whitespace ref counts as no link
  if (step.zim_ref !== null && step.zim_ref !== undefined) {
    const ref = step.zim_ref.trim()
    if (ref !== '') {
      return { kind: 'zim', href: ref }
    }
  }

  return { kind: 'none', href: null }
}
