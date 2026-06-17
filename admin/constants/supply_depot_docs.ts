import { SERVICE_NAMES } from './service_names.js'

// Per-app documentation map for the Supply Depot card page.
//
// Every non-dependency service in the catalog (database/seeders/service_seeder.ts)
// gets one entry pointing at its section on the in-app docs page
// admin/docs/supply-depot-apps.md, served at /docs/supply-depot-apps. QDRANT is
// excluded — it is a dependency service (is_dependency_service: true), never
// shown as an installable app, so it has no card and no docs section.
//
// `slug` is the docs page slug (the .md filename without extension); `anchor`
// MUST match the heading id set in that .md file (e.g.
// `## CyberChef {% #cyberchef %}`). The Heading markdoc component
// (inertia/components/markdoc/Heading.tsx) renders the id as a real DOM anchor,
// so /docs/${slug}#${anchor} deep-links to the section. Keep this map and the
// .md headings in lockstep — a missing heading id makes the "Learn more" link
// scroll to the top of the page instead of the app's section.

// The single docs page that hosts every Supply Depot app section.
export const SUPPLY_DEPOT_DOC_PAGE = 'supply-depot-apps'

export interface SupplyDepotDocEntry {
  slug: string
  anchor: string
}

export const SUPPLY_DEPOT_DOCS: Record<string, SupplyDepotDocEntry> = {
  [SERVICE_NAMES.KIWIX]: { slug: SUPPLY_DEPOT_DOC_PAGE, anchor: 'information-library' },
  [SERVICE_NAMES.OLLAMA]: { slug: SUPPLY_DEPOT_DOC_PAGE, anchor: 'ai-assistant' },
  [SERVICE_NAMES.CYBERCHEF]: { slug: SUPPLY_DEPOT_DOC_PAGE, anchor: 'data-tools' },
  [SERVICE_NAMES.FLATNOTES]: { slug: SUPPLY_DEPOT_DOC_PAGE, anchor: 'notes' },
  [SERVICE_NAMES.KOLIBRI]: { slug: SUPPLY_DEPOT_DOC_PAGE, anchor: 'education-platform' },
  [SERVICE_NAMES.GROCY]: { slug: SUPPLY_DEPOT_DOC_PAGE, anchor: 'grocy' },
  [SERVICE_NAMES.MESHTASTIC_WEB]: { slug: SUPPLY_DEPOT_DOC_PAGE, anchor: 'meshtastic-web' },
  [SERVICE_NAMES.MESHCORE_WEB]: { slug: SUPPLY_DEPOT_DOC_PAGE, anchor: 'meshcore-web' },
  [SERVICE_NAMES.MESH]: { slug: SUPPLY_DEPOT_DOC_PAGE, anchor: 'mesh-bridge' },
}

// Returns the in-app docs link for a service, or null if it has no documentation
// section (e.g. a custom app, or the QDRANT dependency service).
export function getSupplyDepotDocLink(serviceName: string): string | null {
  const entry = SUPPLY_DEPOT_DOCS[serviceName]
  return entry ? `/docs/${entry.slug}#${entry.anchor}` : null
}
