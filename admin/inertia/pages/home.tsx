import {
  IconApps,
  IconBox,
  IconMapRoute,
  IconPill,
  IconShieldCheck,
  IconWand,
  IconWifiOff,
} from '@tabler/icons-react'
import { Head, usePage } from '@inertiajs/react'
import HomeLayout from '~/layouts/HomeLayout'
import { getServiceLink } from '~/lib/navigation'
import { ServiceSlim } from '../../types/services'
import DynamicIcon, { DynamicIconName } from '~/components/DynamicIcon'
import { useUpdateAvailable } from '~/hooks/useUpdateAvailable'
import Alert from '~/components/Alert'
import { SERVICE_NAMES } from '../../constants/service_names'
import { groupIntoDecks } from '~/util/home_decks'

// AI Assistant — Core Capability tile on the macOS distro (display_order: 3).
//
// Rendered only when the `nomad_ollama` services row has installed=true.
// `_syncContainersWithDatabase` in system_service.ts skips the OLLAMA row
// when DockerService.isNativeOllama() is true (OLLAMA_HOST env set), so the
// installed flag is preserved across renders for the macOS distro's native
// install path. On a fresh install the row starts at installed=false and
// the wizard flips it to true once Ollama is set up — at which point this
// tile appears.
function buildAIAssistantItem(aiAssistantName: string): DashboardItem {
  return {
    label: aiAssistantName || 'AI Assistant',
    to: '/chat',
    target: '',
    description: 'Local AI chat — runs on this Mac, no internet needed',
    icon: <IconWand size={48} />,
    installed: true,
    displayOrder: 3,
    poweredBy: 'Ollama',
    deckKey: 'ai-assistant',
  }
}

// Maps is a Core Capability (display_order: 4)
const MAPS_ITEM: DashboardItem = {
  label: 'Maps',
  to: '/maps',
  target: '',
  description: 'View offline maps',
  icon: <IconMapRoute size={48} />,
  installed: true,
  displayOrder: 4,
  poweredBy: null,
  deckKey: 'maps',
}

// Workshop — offline maker library: STL, CAD, PDF, images (Core Capability)
const WORKSHOP_ITEM: DashboardItem = {
  label: 'Workshop',
  to: '/workshop',
  target: '',
  description: 'Offline maker library: 3D prints, CAD, PDFs, and reference images.',
  icon: <IconBox size={48} />,
  installed: true,
  displayOrder: 5,
  poweredBy: null,
  deckKey: 'workshop',
}

// Drug Reference v1 — offline FDA drug-label search (Core Capability).
// displayOrder 6: between Workshop (5) and Preparedness (7). ONE surface: search
// by drug name OR by situation (burn, fever, diarrhea) via the curated chips. The
// former separate "When to use what" tile is folded in here — both tiles routed
// to /drug-reference, so the second was pure duplication.
const DRUG_REFERENCE_ITEM: DashboardItem = {
  label: 'Drug Reference',
  to: '/drug-reference',
  target: '',
  description: 'Offline FDA drug labels: search by drug name or by situation',
  icon: <IconPill size={48} />,
  installed: true,
  displayOrder: 6,
  poweredBy: null,
  deckKey: 'drug-reference',
}

// Preparedness — Self-Reliance Suite Phases 1 + 2 + 3 (Core Capability). One
// page with three tabs: Inventory (the hand-curated catalog of supplies, gear,
// and resource-mapped items — formerly a standalone tile), Supply Readiness
// (reads that catalog and a household config to show how many days of water,
// food, and power you have against your target horizon — stores no new stock),
// and Scenario Plans (the editable, checkable per-scenario plans whose steps
// cross-link to inventory items, STL files, and ZIM articles).
const READINESS_ITEM: DashboardItem = {
  label: 'Preparedness',
  to: '/readiness',
  target: '',
  description: 'Days of water, food, and power on hand, plus scenario checklists',
  icon: <IconShieldCheck size={48} />,
  installed: true,
  displayOrder: 7,
  poweredBy: null,
  deckKey: 'preparedness',
}

interface DashboardItem {
  label: string
  to: string
  target: string
  description: string
  icon: React.ReactNode
  installed: boolean
  displayOrder: number
  poweredBy: string | null
  // Which scenario deck this item belongs to. Service rows use their
  // service_name; the hardcoded feature tiles use their own feature keys
  // (ai-assistant / maps / workshop / drug-reference / preparedness). Unknown
  // keys fall to 'tools-workshop' via deckForKey.
  deckKey: string
}

export default function Home(props: {
  system: {
    services: ServiceSlim[]
  }
}) {
  const items: DashboardItem[] = []
  const updateInfo = useUpdateAvailable()
  const { aiAssistantName } = usePage<{ aiAssistantName: string }>().props

  // Add installed services (non-dependency services only).
  //
  // Skip the OLLAMA row here — the AI Assistant tile is rendered separately
  // below (with a custom label, icon, and description). Without this filter
  // an installed OLLAMA row would produce a duplicate tile.
  props.system.services
    .filter(
      (service) =>
        service.installed &&
        service.ui_location &&
        service.service_name !== SERVICE_NAMES.OLLAMA
    )
    .forEach((service) => {
      items.push({
        label: service.friendly_name || service.service_name,
        to: service.ui_location ? getServiceLink(service.ui_location) : '#',
        target: '_blank',
        description:
          service.description ||
          `Access the ${service.friendly_name || service.service_name} application`,
        icon: service.icon ? (
          <DynamicIcon icon={service.icon as DynamicIconName} className="!size-12" />
        ) : (
          <IconWifiOff size={48} />
        ),
        installed: service.installed,
        displayOrder: service.display_order ?? 100,
        poweredBy: service.powered_by ?? null,
        deckKey: service.service_name,
      })
    })

  // AI Assistant — Core Capability tile, gated on the nomad_ollama services
  // row being installed=true. See buildAIAssistantItem() for the rationale.
  const aiAssistantInstalled = props.system.services.some(
    (service) => service.service_name === SERVICE_NAMES.OLLAMA && service.installed
  )
  if (aiAssistantInstalled) {
    items.push(buildAIAssistantItem(aiAssistantName))
  }

  // Add Maps as a Core Capability
  items.push(MAPS_ITEM)

  // Add Workshop as a Core Capability (caweis macOS-distribution port of
  // SysAdminDoc §50 — offline STL library at ${NOMAD_DATA_ROOT}/storage/
  // stl-library/)
  items.push(WORKSHOP_ITEM)

  // Add Drug Reference as a Core Capability (offline FDA drug labels, v1 —
  // search by drug name or by situation; the former "When to use what" tile is
  // folded in here since both routed to the same /drug-reference page)
  items.push(DRUG_REFERENCE_ITEM)

  // Add Preparedness as a Core Capability (Self-Reliance Suite Phases 1 + 2 + 3;
  // the former standalone Inventory tile is now its first tab)
  items.push(READINESS_ITEM)

  // Group the pinned items (display_order <= 8) into ordered scenario decks,
  // dropping unpinned utilities (they live behind "Browse all apps") and hiding
  // empty decks. The flat grid + the SYSTEM_ITEMS nav tiles (Easy Setup / Install
  // Apps / Docs / Settings) are gone: those destinations live in the sidebar rail
  // and the "Browse all apps" button.
  const decks = groupIntoDecks(items)

  return (
    <HomeLayout>
      <Head title="Command Center" />
      {/* xl:pl-72 clears the fixed w-72 sidebar, matching every settings page. */}
      <div className="xl:pl-72 w-full">
      {updateInfo?.updateAvailable && (
        <div className="flex justify-center items-center p-4 w-full">
          <Alert
            title="An update is available for Project N.O.M.A.D.!"
            type="info-inverted"
            variant="solid"
            className="w-full"
            buttonProps={{
              variant: 'primary',
              children: 'Go to Settings',
              icon: 'IconSettings',
              onClick: () => {
                window.location.href = '/settings/update'
              },
            }}
          />
        </div>
      )}

      <div className="p-4">
        {/* The "Command Center" title lives in the sidebar header; the page just
            carries the Browse-all action. */}
        <div className="flex items-center justify-end mb-6">
          <a
            href="/settings/apps"
            className="inline-flex items-center gap-2 rounded border-desert-green border-2 bg-desert-green hover:bg-transparent hover:text-black text-white transition-colors px-4 py-2 font-semibold"
          >
            <IconApps size={20} />
            Browse all apps
          </a>
        </div>

        {decks.map(({ deck, items: deckItems }) => (
          <section key={deck.key} className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <DynamicIcon icon={deck.icon as DynamicIconName} className="!size-6 text-desert-green" />
              <h2 className="text-xl font-semibold text-desert-green">{deck.label}</h2>
            </div>
            <hr className="border-none h-px bg-desert-tan-lighter mb-4" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {deckItems.map((item) => (
                <a key={item.label} href={item.to} target={item.target}>
                  <div className="relative rounded border-desert-green border-2 bg-desert-green hover:bg-transparent hover:text-black text-white transition-colors shadow-sm h-48 flex flex-col items-center justify-center cursor-pointer text-center px-4">
                    <div className="flex items-center justify-center mb-2">{item.icon}</div>
                    <h3 className="font-bold text-2xl">{item.label}</h3>
                    {item.poweredBy && (
                      <p className="text-sm opacity-80">Powered by {item.poweredBy}</p>
                    )}
                    <p className="xl:text-lg mt-2">{item.description}</p>
                  </div>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>
      </div>
    </HomeLayout>
  )
}
