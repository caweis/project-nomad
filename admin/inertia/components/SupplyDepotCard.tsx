import { IconArrowUp, IconCheck, IconExternalLink } from '@tabler/icons-react'
import StyledButton from '~/components/StyledButton'
import AppManageMenu, { AppMenuItem } from '~/components/AppManageMenu'
import HostCommandButton from '~/components/HostCommandButton'
import { ServiceSlim } from '../../types/services'
import { getServiceLink } from '~/lib/navigation'
import { SERVICE_NAMES } from '../../constants/service_names'
import { getSupplyDepotDocLink } from '../../constants/supply_depot_docs'

function extractTag(containerImage: string): string {
  if (!containerImage) return ''
  const parts = containerImage.split(':')
  return parts.length > 1 ? parts[parts.length - 1] : 'latest'
}

// The handler surface the card needs from its parent page. These are the SAME
// handlers settings/apps.tsx wires to its table-row buttons; the card page
// (settings/supply-depot.tsx) owns one copy of them and passes them down, so
// the action behaviour is identical on both surfaces without duplicating the
// handler bodies in two places.
export interface SupplyDepotCardHandlers {
  onInstall: (record: ServiceSlim) => void
  onForceReinstall: (record: ServiceSlim) => void
  onUpdate: (record: ServiceSlim) => void
  onAffect: (record: ServiceSlim, action: 'start' | 'stop' | 'restart') => void
  onEditCustom: (record: ServiceSlim) => void
  onPullLatest: (record: ServiceSlim) => void
  onViewLogs: (record: ServiceSlim) => void
  onDeleteCustom: (record: ServiceSlim) => void
  onToggleAutoUpdate: (record: ServiceSlim, enabled: boolean) => void
}

export interface SupplyDepotCardProps {
  record: ServiceSlim
  // Mirrors the props.* the apps.tsx AppActions / Version cell read.
  isNativeOllama: boolean
  aiBackend?: string
  aiAssistantVersion?: string
  isOnline: boolean
  isInstalling: boolean
  loading: boolean
  handlers: SupplyDepotCardHandlers
}

// One Supply Depot app rendered as a card. The action footer is a faithful port
// of apps.tsx's AppActions component — same oMLX special-case (Native (Metal) /
// Apple MLX pill + host-command Update/Reset, isMlx Update omission), same
// custom-app surface (#32: Edit / Pull latest / Logs / Delete / auto-update
// toggle), same install / start / stop / restart / force-reinstall. The Version
// line is the same backend-aware logic as the table's Version cell.
export default function SupplyDepotCard({
  record,
  isNativeOllama,
  aiBackend,
  aiAssistantVersion,
  isOnline,
  isInstalling,
  loading,
  handlers,
}: SupplyDepotCardProps) {
  if (!record) return null

  const docLink = getSupplyDepotDocLink(record.service_name)

  // ── backend-aware version line (mirrors apps.tsx Version cell) ──────────────
  function renderVersion() {
    if (!record.installed) return null
    if (isNativeOllama && record.service_name === SERVICE_NAMES.OLLAMA) {
      if (aiBackend === 'omlx') {
        return <span className="text-gray-600">Apple MLX</span>
      }
      return <span className="text-gray-600">{aiAssistantVersion || '—'}</span>
    }
    const currentTag = extractTag(record.container_image)
    if (record.available_update_version) {
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500">{currentTag}</span>
          <IconArrowUp className="h-4 w-4 text-desert-green" />
          <span className="text-desert-green font-semibold">{record.available_update_version}</span>
        </div>
      )
    }
    return <span className="text-gray-600">{currentTag}</span>
  }

  // ── action footer (faithful port of apps.tsx AppActions) ────────────────────
  function renderActions() {
    // Everything past Open (and a conditional Update) collapses into one "⋯"
    // overflow menu so the card's action row stays compact: lifecycle (Stop/Start,
    // Restart), then the custom-app cluster (Edit / Pull latest / Logs /
    // Auto-update), then a divider and the destructive zone (Delete for custom
    // apps, then Wipe & reinstall). Mirrors apps.tsx; the only difference is each
    // item calls a handlers.* prop instead of opening an inline modal.
    const buildInstalledMenu = (): AppMenuItem[] => {
      const items: AppMenuItem[] = []
      const statusKnown = !!record.status && record.status !== 'unknown'

      if (statusKnown) {
        items.push({
          kind: 'action',
          icon: record.status === 'running' ? 'IconPlayerStop' : 'IconPlayerPlay',
          label: record.status === 'running' ? 'Stop' : 'Start',
          onClick: () => handlers.onAffect(record, record.status === 'running' ? 'stop' : 'start'),
          disabled: isInstalling,
        })
        if (record.status === 'running') {
          items.push({
            kind: 'action',
            icon: 'IconRefresh',
            label: 'Restart',
            onClick: () => handlers.onAffect(record, 'restart'),
            disabled: isInstalling,
          })
        }
      }

      if (record.is_custom) {
        items.push(
          {
            kind: 'action',
            icon: 'IconPencil',
            label: 'Edit',
            onClick: () => handlers.onEditCustom(record),
            disabled: loading,
          },
          {
            kind: 'action',
            icon: 'IconArrowUp',
            label: 'Pull latest',
            onClick: () => handlers.onPullLatest(record),
            disabled: loading || !isOnline,
          },
          {
            kind: 'action',
            icon: 'IconFileText',
            label: 'Logs',
            onClick: () => handlers.onViewLogs(record),
            disabled: loading,
          },
          {
            kind: 'toggle',
            label: 'Auto-update',
            checked: !!record.auto_update_enabled,
            onChange: (enabled) => handlers.onToggleAutoUpdate(record, enabled),
          }
        )
      }

      const destructive: AppMenuItem[] = []
      if (record.is_custom) {
        destructive.push({
          kind: 'action',
          icon: 'IconTrash',
          label: 'Delete',
          onClick: () => handlers.onDeleteCustom(record),
          disabled: loading,
          danger: true,
        })
      }
      if (statusKnown) {
        destructive.push({
          kind: 'action',
          icon: 'IconAlertTriangle',
          label: 'Wipe & reinstall',
          onClick: () => handlers.onForceReinstall(record),
          disabled: isInstalling,
          danger: true,
        })
      }
      if (destructive.length) {
        if (items.length) items.push({ kind: 'divider' })
        items.push(...destructive)
      }
      return items
    }

    // Native Ollama: every Docker-side action routes through DockerService which
    // refuses with a "manage via CLI" error. Replace with the Native (Metal)
    // pill plus host-command Update/Reset. On 'omlx' chat runs on Apple MLX and
    // this native Ollama is only the embeddings sidecar, so the Ollama "Update"
    // is omitted (it wouldn't update the chat engine); the whole AI stack is
    // updated host-side via `nomad upgrade`. "Reset" recovers the host Ollama
    // engine on both backends.
    if (isNativeOllama && record.service_name === SERVICE_NAMES.OLLAMA) {
      const isMlx = aiBackend === 'omlx'
      return (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800"
            title={
              isMlx
                ? "Chat runs on Apple MLX (Metal-accelerated). The AI stack is host-managed — update it with 'nomad upgrade' on the host. Ollama here serves only embeddings."
                : "Ollama is running natively on this Mac (Metal-accelerated). Container actions don't apply."
            }
          >
            {isMlx ? 'Apple MLX (Metal)' : 'Native (Metal)'}
          </span>
          {!isMlx && <HostCommandButton cmd="upgrade-ollama" label="Update" disabled={!isOnline} />}
          <HostCommandButton
            cmd="reset-ollama"
            label="Reset"
            icon="IconRefresh"
            variant="action"
            successLabel="✓ Reset complete"
          />
        </div>
      )
    }

    if (!record.installed) {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <StyledButton
            icon="IconDownload"
            variant="primary"
            onClick={() => handlers.onInstall(record)}
            disabled={isInstalling || !isOnline}
            loading={isInstalling}
          >
            Install
          </StyledButton>
          <AppManageMenu
            items={[
              {
                kind: 'action',
                icon: 'IconAlertTriangle',
                label: 'Wipe & reinstall',
                onClick: () => handlers.onForceReinstall(record),
                disabled: isInstalling,
                danger: true,
              },
            ]}
            disabled={isInstalling}
          />
        </div>
      )
    }

    const menuItems = buildInstalledMenu()
    return (
      <div className="flex flex-wrap items-center gap-2">
        <StyledButton
          icon="IconExternalLink"
          onClick={() => {
            // custom_url (a reverse-proxy / local-DNS override) wins over the default port link.
            window.open(
              getServiceLink(record.custom_url || record.ui_location || 'unknown'),
              '_blank'
            )
          }}
        >
          Open
        </StyledButton>
        {/* Curated-app version updates stay inline while an update is waiting; custom
            apps update via "Pull latest" in the menu. `!!` guard: available_update_version
            arrives as the number 0 when up to date, and a bare `&& 0` would render a
            literal "0" next to the buttons. */}
        {!record.is_custom && !!record.available_update_version && (
          <StyledButton
            icon="IconArrowUp"
            variant="action"
            onClick={() => handlers.onUpdate(record)}
            disabled={isInstalling || !isOnline}
          >
            Update
          </StyledButton>
        )}
        {menuItems.length > 0 && <AppManageMenu items={menuItems} disabled={isInstalling} />}
      </div>
    )
  }

  return (
    <div className="flex flex-col rounded-lg border border-desert-tan-lighter bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-semibold text-desert-stone-dark">
              {record.friendly_name || record.service_name}
            </h3>
            {record.installed && (
              <IconCheck className="h-5 w-5 shrink-0 text-desert-green" aria-label="Installed" />
            )}
          </div>
          {record.powered_by && (
            <p className="text-xs text-gray-400">by {record.powered_by}</p>
          )}
        </div>
        {record.category && (
          <span className="shrink-0 inline-flex items-center rounded-full bg-desert-sand px-2.5 py-0.5 text-xs font-medium capitalize text-desert-stone-dark">
            {record.category}
          </span>
        )}
      </div>

      <p className="mt-2 flex-1 text-sm text-gray-600">{record.description}</p>

      <div className="mt-3 flex items-center justify-between gap-2 text-sm">
        <div className="text-gray-500">{renderVersion()}</div>
        {docLink && (
          <a
            href={docLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-desert-green hover:underline"
          >
            Learn more
            <IconExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      <div className="mt-4 border-t border-desert-tan-lighter pt-4">{renderActions()}</div>
    </div>
  )
}
