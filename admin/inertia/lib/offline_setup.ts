/**
 * What the Easy Setup wizard can and cannot do without a connection.
 *
 * The wizard used to gate everything on `isOnline`: navigation between steps
 * returned false and Finish refused outright. On an appliance built to run
 * without a connection that is backwards — a host with no internet could not
 * even walk through setup and finish with nothing selected, which is exactly
 * what an offline operator wants to do before they plug a content drive in.
 *
 * Moving between steps needs nothing from the network. Finishing only needs it
 * for the selections that actually fetch something. Everything here is pure so
 * it can be tested without a browser.
 */

export interface WizardSelections {
  /** service_name values queued for install (each pulls a container image) */
  services: string[]
  /** map collection slugs queued for download */
  mapCollections: string[]
  /** number of content category tiers queued for download */
  categoryTierCount: number
  /** AI model names queued for download */
  aiModels: string[]
  /** chosen Wikipedia option id, or null. 'none' means the user opted out. */
  wikipediaOptionId: string | null
  /** whether the FDA drug reference download was requested */
  drugReference: boolean
}

/**
 * The selections that need a connection, phrased for a person to read.
 * Empty means Finish can run offline.
 */
export function offlineBlockers(selections: WizardSelections): string[] {
  const blockers: string[] = []

  if (selections.services.length > 0) {
    blockers.push(
      `${selections.services.length} app${selections.services.length === 1 ? '' : 's'} to install`
    )
  }
  if (selections.mapCollections.length > 0) {
    blockers.push(
      `${selections.mapCollections.length} map${selections.mapCollections.length === 1 ? '' : 's'} to download`
    )
  }
  if (selections.categoryTierCount > 0) {
    blockers.push(
      `${selections.categoryTierCount} content selection${selections.categoryTierCount === 1 ? '' : 's'} to download`
    )
  }
  if (selections.aiModels.length > 0) {
    blockers.push(
      `${selections.aiModels.length} AI model${selections.aiModels.length === 1 ? '' : 's'} to download`
    )
  }
  // 'none' is the opt-out option and downloads nothing.
  if (selections.wikipediaOptionId && selections.wikipediaOptionId !== 'none') {
    blockers.push('Wikipedia to download')
  }
  if (selections.drugReference) {
    blockers.push('the drug reference to download')
  }

  return blockers
}

/** True when Finish would fetch nothing, so it can run with no connection. */
export function canCompleteSetupOffline(selections: WizardSelections): boolean {
  return offlineBlockers(selections).length === 0
}

/** One sentence naming what has to be dropped to finish without a connection. */
export function describeOfflineBlockers(blockers: string[]): string {
  if (blockers.length === 0) return ''
  const list =
    blockers.length === 1
      ? blockers[0]
      : `${blockers.slice(0, -1).join(', ')} and ${blockers[blockers.length - 1]}`
  return `No internet connection, so setup can't finish with ${list}. Clear those to finish now, or connect and try again.`
}
