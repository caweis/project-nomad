import {
  IconApps,
  IconBox,
  IconExternalLink,
  IconLayoutGrid,
  IconLayoutList,
  IconMapRoute,
  IconPencil,
  IconPill,
  IconPin,
  IconPlus,
  IconShieldCheck,
  IconTrash,
  IconWand,
  IconWifiOff,
} from '@tabler/icons-react'
import { Head, router, usePage } from '@inertiajs/react'
import { useState } from 'react'
import classNames from 'classnames'
import api from '~/lib/api'
import HomeLayout from '~/layouts/HomeLayout'
import { getServiceLink } from '~/lib/navigation'
import { ServiceSlim } from '../../types/services'
import DynamicIcon, { DynamicIconName } from '~/components/DynamicIcon'
import { useUpdateAvailable } from '~/hooks/useUpdateAvailable'
import Alert from '~/components/Alert'
import WhatsNewBanner from '~/components/WhatsNewBanner'
import LinkTileModal from '~/components/LinkTileModal'
import { useNotifications } from '~/context/NotificationContext'
import { SERVICE_NAMES } from '../../constants/service_names'
import { DEFAULT_LINK_TILE_ICON } from '../../constants/link_tile_icons'
import { linkTileColor } from '../../constants/link_tile_colors'
import { normalizeCustomUrl } from '../../util/custom_url'
import { groupIntoDecks } from '~/util/home_decks'

// Deck card icon sizing. The glyphs sit centered in each card; the stock 48px
// at the Tabler default stroke of 2 gives a ~4% stroke-to-size ratio that reads
// spindly, while 32px shrinks them out of balance with the titles. 40px at a
// heavier 2.5 stroke sits between the two. Both the hardcoded feature tiles and
// the DynamicIcon service tiles pull from these, so the grid stays uniform and
// retunes in one place.
const DECK_ICON_SIZE = 40
const DECK_ICON_STROKE = 2.5

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
    icon: <IconWand size={DECK_ICON_SIZE} stroke={DECK_ICON_STROKE} />,
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
  icon: <IconMapRoute size={DECK_ICON_SIZE} stroke={DECK_ICON_STROKE} />,
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
  icon: <IconBox size={DECK_ICON_SIZE} stroke={DECK_ICON_STROKE} />,
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
  description: 'Offline FDA drug labels — search by drug name, or by situation (burn, fever, diarrhea)',
  icon: <IconPill size={DECK_ICON_SIZE} stroke={DECK_ICON_STROKE} />,
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
  icon: <IconShieldCheck size={DECK_ICON_SIZE} stroke={DECK_ICON_STROKE} />,
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
  // Set only for the user's own link tiles (upstream 2c73139b), which are always
  // pinned, group in their own deck, and render and behave differently.
  isLinkTile?: boolean
  linkTile?: ServiceSlim
}

export default function Home(props: {
  system: {
    services: ServiceSlim[]
  }
  // Per-app pin overrides (issue #44): deckKey -> explicit pinned state. An entry
  // overrides the default display_order <= 8 rule. Default {} (server-supplied),
  // which leaves the home identical to the pre-override behavior.
  pins: Record<string, boolean>
  // Home layout preference. 'grid' = the traditional flat tile grid (default);
  // 'decks' = the categorized scenario decks. Server-supplied, defaults to 'grid'.
  homeLayout: 'grid' | 'decks'
}) {
  const items: DashboardItem[] = []
  const updateInfo = useUpdateAvailable()
  const { aiAssistantName } = usePage<{ aiAssistantName: string }>().props
  const { addNotification } = useNotifications()

  // Link tile management. `editingTile` null with the modal open means "create".
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [editingTile, setEditingTile] = useState<ServiceSlim | null>(null)
  // Removing a tile cannot be undone and the tile is the user's own data, so the
  // trash button arms a confirm rather than removing on the first click.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)

  const refreshServices = () => router.reload({ only: ['system'] })

  const handleDeleteTile = async (serviceName: string) => {
    const result = await api.deleteLinkTile(serviceName)
    setPendingDelete(null)
    if (!result?.success) {
      addNotification({ type: 'error', message: 'Failed to remove this link.' })
      return
    }
    refreshServices()
  }

  // Add installed services (non-dependency services only).
  //
  // Skip the OLLAMA row here — the AI Assistant tile is rendered separately
  // below (with a custom label, icon, and description). Without this filter
  // an installed OLLAMA row would produce a duplicate tile. Link tiles are
  // collected separately below and rendered with their own treatment.
  props.system.services
    .filter(
      (service) =>
        service.installed &&
        service.ui_location &&
        service.service_name !== SERVICE_NAMES.OLLAMA &&
        !service.is_link_tile
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
          <DynamicIcon
            icon={service.icon as DynamicIconName}
            className="!size-8"
            stroke={DECK_ICON_STROKE}
          />
        ) : (
          <IconWifiOff size={DECK_ICON_SIZE} stroke={DECK_ICON_STROKE} />
        ),
        installed: service.installed,
        displayOrder: service.display_order ?? 100,
        poweredBy: service.powered_by ?? null,
        deckKey: service.service_name,
      })
    })

  // The user's own link tiles: shortcuts to things NOMAD does not manage. The
  // stored URL was normalized to http(s) on the server; it is normalized again
  // here because it goes straight into an href, and a value that somehow is not
  // http(s) should become a dead link, never a javascript: one.
  props.system.services
    .filter((service) => service.is_link_tile && service.custom_url)
    .forEach((service) => {
      items.push({
        label: service.friendly_name || service.service_name,
        to: normalizeCustomUrl(service.custom_url) ?? '#',
        target: '_blank',
        description: service.description || 'Opens in a new tab',
        icon: (
          <DynamicIcon
            icon={(service.icon || DEFAULT_LINK_TILE_ICON) as DynamicIconName}
            className="!size-8"
            stroke={DECK_ICON_STROKE}
          />
        ),
        installed: true,
        displayOrder: service.display_order ?? 90,
        poweredBy: null,
        deckKey: service.service_name,
        isLinkTile: true,
        linkTile: service,
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

  // Group the pinned items into ordered scenario decks, dropping unpinned
  // utilities (they live behind "Browse all apps") and hiding empty decks. The
  // flat grid + the SYSTEM_ITEMS nav tiles (Easy Setup / Install Apps / Docs /
  // Settings) are gone: those destinations live in the sidebar rail and the
  // "Browse all apps" button. props.pins layers the user's per-app overrides
  // over the default display_order <= 8 rule (issue #44).
  const decks = groupIntoDecks(items, props.pins)

  // Unpin a card from the home. The card is an <a>, so the pin button must NOT
  // navigate — preventDefault/stopPropagation, POST the override, then reload.
  // The home only renders pinned items, so this is always an unpin: the card
  // leaves on reload.
  const unpinItem = (e: React.MouseEvent, deckKey: string) => {
    e.preventDefault()
    e.stopPropagation()
    router.post(
      '/api/home/pins',
      { key: deckKey, pinned: false },
      { preserveScroll: true, onSuccess: () => router.reload({ only: ['pins'] }) }
    )
  }

  // Flat list for the traditional grid: the same pinned cards the decks show,
  // ungrouped and ordered by displayOrder.
  const flatItems = decks.flatMap((d) => d.items).sort((a, b) => a.displayOrder - b.displayOrder)

  // Persist the layout choice, then reload just the homeLayout prop to re-render.
  const setLayout = (next: 'grid' | 'decks') => {
    if (next === props.homeLayout) return
    api.updateSetting('ui.homeLayout', next).finally(() => router.reload({ only: ['homeLayout'] }))
  }

  // A link tile is deliberately not styled like an app: outlined and dashed rather
  // than filled, with an external-link marker. If it looked the same, people would
  // expect Start, Stop and Update and file bugs when those controls are not there
  // (upstream 2c73139b). Its Edit and Remove controls replace the pin button and
  // stay visible, as the pin does, rather than appearing on hover as upstream's do:
  // on a phone or tablet there is no hover, and a hidden control is one a touch
  // user can never reach.
  const renderLinkTile = (item: DashboardItem) => {
    const tile = item.linkTile!
    const color = linkTileColor(tile.link_color)
    const confirming = pendingDelete === tile.service_name
    return (
      <div key={item.deckKey} className="relative flex flex-col">
        <a
          href={item.to}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col flex-1"
        >
          <div
            className={classNames(
              'relative rounded border-2 border-dashed text-text-primary hover:bg-surface-secondary transition-colors shadow-sm min-h-48 flex-1 flex flex-col items-center justify-center cursor-pointer text-center px-4 py-4',
              color.border,
              color.bg
            )}
          >
            <span
              className={classNames('absolute top-2 left-2', color.marker)}
              title="A shortcut you added. NOMAD does not manage this."
            >
              <IconExternalLink size={18} />
            </span>
            <div className="flex items-center justify-center mb-2">{item.icon}</div>
            <h3 className="font-bold text-2xl">{item.label}</h3>
            <p className="xl:text-lg mt-2">{item.description}</p>
          </div>
        </a>
        {confirming ? (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
            <button
              type="button"
              onClick={() => handleDeleteTile(tile.service_name)}
              className="rounded bg-desert-red px-2 py-1 text-xs font-medium text-white hover:brightness-110"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="rounded border border-border-default bg-surface-primary px-2 py-1 text-xs text-text-secondary hover:bg-surface-secondary"
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setEditingTile(tile)
                setLinkModalOpen(true)
              }}
              title="Edit this link"
              aria-label={`Edit the ${item.label} link`}
              className="rounded p-1 text-text-muted hover:bg-surface-secondary hover:text-text-primary transition-colors"
            >
              <IconPencil size={18} />
            </button>
            <button
              type="button"
              onClick={() => setPendingDelete(tile.service_name)}
              title="Remove this link"
              aria-label={`Remove the ${item.label} link`}
              className="rounded p-1 text-text-muted hover:bg-surface-secondary hover:text-desert-red transition-colors"
            >
              <IconTrash size={18} />
            </button>
          </div>
        )}
      </div>
    )
  }

  // Shared card — used by both the flat grid and the decks so the two layouts
  // stay identical at the card level.
  const renderAppCard = (item: DashboardItem) => (
    <a key={item.label} href={item.to} target={item.target} className="flex flex-col">
      <div className="relative rounded border-desert-green border-2 bg-desert-green hover:bg-transparent hover:text-black text-white transition-colors shadow-sm min-h-48 flex-1 flex flex-col items-center justify-center cursor-pointer text-center px-4 py-4">
        <button
          type="button"
          onClick={(e) => unpinItem(e, item.deckKey)}
          aria-label={`Unpin ${item.label} from home`}
          title="Unpin from home"
          className="absolute top-2 right-2 z-10 p-1 rounded text-white/80 hover:text-white hover:bg-black/20 transition-colors"
        >
          <IconPin size={20} fill="currentColor" />
        </button>
        <div className="flex items-center justify-center mb-2">{item.icon}</div>
        <h3 className="font-bold text-2xl">{item.label}</h3>
        {item.poweredBy && <p className="text-sm opacity-80">Powered by {item.poweredBy}</p>}
        <p className="xl:text-lg mt-2">{item.description}</p>
      </div>
    </a>
  )

  const renderCard = (item: DashboardItem) =>
    item.isLinkTile ? renderLinkTile(item) : renderAppCard(item)

  return (
    <HomeLayout>
      <Head title="Command Center" />
      {/* xl:pl-72 clears the fixed w-72 sidebar, matching every settings page. */}
      <div className="xl:pl-72 w-full">
      {updateInfo?.updateAvailable && (
        <div className="flex justify-center items-center p-4 w-full">
          <Alert
            title="An update is available for Project NOMAD!"
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

      <WhatsNewBanner />

      <div className="p-4">
        {/* Header: layout switcher (Grid / Decks) + Browse-all. The "Command
            Center" title lives in the sidebar header. */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div
            className="inline-flex rounded-lg border border-desert-tan-lighter overflow-hidden"
            role="group"
            aria-label="Home layout"
          >
            <button
              type="button"
              onClick={() => setLayout('grid')}
              aria-pressed={props.homeLayout === 'grid'}
              className={classNames(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors',
                props.homeLayout === 'grid'
                  ? 'bg-desert-green text-white'
                  : 'bg-transparent text-desert-green hover:bg-desert-green/10'
              )}
            >
              <IconLayoutGrid size={16} />
              Grid
            </button>
            <button
              type="button"
              onClick={() => setLayout('decks')}
              aria-pressed={props.homeLayout === 'decks'}
              className={classNames(
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors border-l border-desert-tan-lighter',
                props.homeLayout === 'decks'
                  ? 'bg-desert-green text-white'
                  : 'bg-transparent text-desert-green hover:bg-desert-green/10'
              )}
            >
              <IconLayoutList size={16} />
              Decks
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Dashed like the tiles it makes, so it reads as "add your own", not
                as another app to install. */}
            <button
              type="button"
              onClick={() => {
                setEditingTile(null)
                setLinkModalOpen(true)
              }}
              className="inline-flex items-center gap-2 rounded border-2 border-dashed border-desert-green text-desert-green hover:bg-desert-green/10 transition-colors px-4 py-2 font-semibold"
            >
              <IconPlus size={20} />
              Add a link
            </button>
            <a
              href="/settings/apps"
              className="inline-flex items-center gap-2 rounded border-desert-green border-2 bg-desert-green hover:bg-transparent hover:text-black text-white transition-colors px-4 py-2 font-semibold"
            >
              <IconApps size={20} />
              Browse all apps
            </a>
          </div>
        </div>

        {props.homeLayout === 'decks' ? (
          // Categorized scenario decks (opt-in).
          decks.map(({ deck, items: deckItems }) => (
            <section key={deck.key} className="mb-8">
              <div className="flex items-center gap-2 mb-3">
                <DynamicIcon
                  icon={deck.icon as DynamicIconName}
                  className="!size-6 text-desert-green"
                />
                <h2 className="text-xl font-semibold text-desert-green">{deck.label}</h2>
              </div>
              <hr className="border-none h-px bg-desert-tan-lighter mb-4" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {deckItems.map(renderCard)}
              </div>
            </section>
          ))
        ) : (
          // Traditional flat tile grid (default).
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {flatItems.map(renderCard)}
          </div>
        )}
      </div>
      </div>

      <LinkTileModal
        open={linkModalOpen}
        tile={editingTile}
        onClose={() => setLinkModalOpen(false)}
        onSaved={() => {
          setLinkModalOpen(false)
          refreshServices()
        }}
        showError={(message) => addNotification({ type: 'error', message })}
      />
    </HomeLayout>
  )
}
