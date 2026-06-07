import {
  IconBolt,
  IconBox,
  IconClipboardList,
  IconHelp,
  IconMapRoute,
  IconPlus,
  IconSettings,
  IconWand,
  IconWifiOff,
} from '@tabler/icons-react'
import { Head, usePage } from '@inertiajs/react'
import AppLayout from '~/layouts/AppLayout'
import { getServiceLink } from '~/lib/navigation'
import { ServiceSlim } from '../../types/services'
import DynamicIcon, { DynamicIconName } from '~/components/DynamicIcon'
import { useUpdateAvailable } from '~/hooks/useUpdateAvailable'
import { useSystemSetting } from '~/hooks/useSystemSetting'
import Alert from '~/components/Alert'
import { SERVICE_NAMES } from '../../constants/service_names'

// AI Assistant — Core Capability tile on the macOS distro (display_order: 3).
//
// Rendered only when the `nomad_ollama` services row has installed=true.
// `_syncContainersWithDatabase` in system_service.ts skips the OLLAMA row
// when DockerService.isNativeOllama() is true (OLLAMA_HOST env set), so the
// installed flag is preserved across renders for the macOS distro's native
// install path. On a fresh install the row starts at installed=false and
// the wizard flips it to true once Ollama is set up — at which point this
// tile appears.
function buildAIAssistantItem(aiAssistantName: string) {
  return {
    label: aiAssistantName || 'AI Assistant',
    to: '/chat',
    target: '',
    description: 'Local AI chat — runs on this Mac, no internet needed',
    icon: <IconWand size={48} />,
    installed: true,
    displayOrder: 3,
    poweredBy: 'Ollama',
  }
}

// Maps is a Core Capability (display_order: 4)
const MAPS_ITEM = {
  label: 'Maps',
  to: '/maps',
  target: '',
  description: 'View offline maps',
  icon: <IconMapRoute size={48} />,
  installed: true,
  displayOrder: 4,
  poweredBy: null,
}

// Workshop — offline 3D-printable STL catalog (Core Capability)
const WORKSHOP_ITEM = {
  label: 'Workshop',
  to: '/workshop',
  target: '',
  description: 'Offline catalog of 3D-printable STL files',
  icon: <IconBox size={48} />,
  installed: true,
  displayOrder: 5,
  poweredBy: null,
}

// Inventory — Self-Reliance Suite Phase 1 (Core Capability). Hand-curated
// catalog of supplies, gear, and resource-mapped items that feed the readiness
// calculator (Phase 2).
const INVENTORY_ITEM = {
  label: 'Inventory',
  to: '/inventory',
  target: '',
  description: 'Track supplies, gear, and resources for self-reliance',
  icon: <IconClipboardList size={48} />,
  installed: true,
  displayOrder: 6,
  poweredBy: null,
}

// System items shown after all apps
const SYSTEM_ITEMS = [
  {
    label: 'Easy Setup',
    to: '/easy-setup',
    target: '',
    description:
      'Not sure where to start? Use the setup wizard to quickly configure your N.O.M.A.D.!',
    icon: <IconBolt size={48} />,
    installed: true,
    displayOrder: 50,
    poweredBy: null,
  },
  {
    label: 'Install Apps',
    to: '/settings/apps',
    target: '',
    description: 'Not seeing your favorite app? Install it here!',
    icon: <IconPlus size={48} />,
    installed: true,
    displayOrder: 51,
    poweredBy: null,
  },
  {
    label: 'Docs',
    to: '/docs/home',
    target: '',
    description: 'Read Project N.O.M.A.D. manuals and guides',
    icon: <IconHelp size={48} />,
    installed: true,
    displayOrder: 52,
    poweredBy: null,
  },
  {
    label: 'Settings',
    to: '/settings/system',
    target: '',
    description: 'Configure your N.O.M.A.D. settings',
    icon: <IconSettings size={48} />,
    installed: true,
    displayOrder: 53,
    poweredBy: null,
  },
]

interface DashboardItem {
  label: string
  to: string
  target: string
  description: string
  icon: React.ReactNode
  installed: boolean
  displayOrder: number
  poweredBy: string | null
}

export default function Home(props: {
  system: {
    services: ServiceSlim[]
  }
}) {
  const items: DashboardItem[] = []
  const updateInfo = useUpdateAvailable();
  const { aiAssistantName } = usePage<{ aiAssistantName: string }>().props

  // Check if user has visited Easy Setup
  const { data: easySetupVisited } = useSystemSetting({
    key: 'ui.hasVisitedEasySetup'
  })
  const shouldHighlightEasySetup = easySetupVisited?.value ? easySetupVisited?.value !== 'true' : false

  // Add installed services (non-dependency services only).
  //
  // Skip the OLLAMA row here — the AI Assistant tile is rendered separately
  // below (with a custom label, icon, and description). Without this filter
  // an installed OLLAMA row would produce a duplicate tile.
  props.system.services
    .filter((service) =>
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
      })
    })

  // AI Assistant — Core Capability tile, gated on the nomad_ollama services
  // row being installed=true. See buildAIAssistantItem() for the rationale.
  const aiAssistantInstalled = props.system.services.some(
    (service) =>
      service.service_name === SERVICE_NAMES.OLLAMA && service.installed
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

  // Add Inventory as a Core Capability (Self-Reliance Suite Phase 1)
  items.push(INVENTORY_ITEM)

  // Add system items
  items.push(...SYSTEM_ITEMS)

  // Sort all items by display order
  items.sort((a, b) => a.displayOrder - b.displayOrder)

  return (
    <AppLayout>
      <Head title="Command Center" />
      {
        updateInfo?.updateAvailable && (
          <div className='flex justify-center items-center p-4 w-full'>
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
        )
      }
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
        {items.map((item) => {
          const isEasySetup = item.label === 'Easy Setup'
          const shouldHighlight = isEasySetup && shouldHighlightEasySetup

          return (
            <a key={item.label} href={item.to} target={item.target}>
              <div className="relative rounded border-desert-green border-2 bg-desert-green hover:bg-transparent hover:text-black text-white transition-colors shadow-sm h-48 flex flex-col items-center justify-center cursor-pointer text-center px-4">
                {shouldHighlight && (
                  <span className="absolute top-2 right-2 flex items-center justify-center">
                    <span
                      className="animate-ping absolute inline-flex w-16 h-6 rounded-full bg-desert-orange-light opacity-75"
                      style={{ animationDuration: '1.5s' }}
                    ></span>
                    <span className="relative inline-flex items-center rounded-full px-2.5 py-1 bg-desert-orange-light text-xs font-semibold text-white shadow-sm">
                      Start here!
                    </span>
                  </span>
                )}
                <div className="flex items-center justify-center mb-2">{item.icon}</div>
                <h3 className="font-bold text-2xl">{item.label}</h3>
                {item.poweredBy && <p className="text-sm opacity-80">Powered by {item.poweredBy}</p>}
                <p className="xl:text-lg mt-2">{item.description}</p>
              </div>
            </a>
          )
        })}
      </div>
    </AppLayout>
  )
}
