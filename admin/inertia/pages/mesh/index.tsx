import { useEffect, useState } from 'react'
import { Head } from '@inertiajs/react'
import AppLayout from '~/layouts/AppLayout'
import StyledButton from '~/components/StyledButton'
import {
  IconAntenna,
  IconArrowDownLeft,
  IconArrowUpRight,
  IconBroadcast,
  IconCpu,
  IconInbox,
  IconRefresh,
  IconSend,
} from '@tabler/icons-react'
import {
  ALERT_BODY_MAX_CHARS,
  validateAlertBody,
  type MeshStatus,
  type MeshMessage,
} from '../../../util/mesh'

/**
 * Mesh Bridge admin console (P4).
 *
 * Three panels on the desert palette, modeled on chat.tsx + readiness/index.tsx:
 *   • Status — adapter kind, node model, and live connection, seeded from the
 *     server-rendered initialStatus and refreshable via GET /api/mesh/status.
 *   • Recent messages — the in/out log from GET /api/mesh/messages, each row
 *     keyed by direction (received over the air vs. sent from this node).
 *   • Send outbound alert — a recipient + body form with a LIVE byte/char
 *     counter against the radio budget (ALERT_BODY_MAX_CHARS). The same pure
 *     validateAlertBody the server gates on drives the counter, so the client
 *     and the 422 boundary never disagree. POST /api/mesh/send keys a radio
 *     transmission and is localNetworkOnly()-gated server-side.
 *
 * The page itself is gated by the controller (404 when the Mesh service isn't
 * installed), so it only renders for an installed bridge — an installed-but-
 * unreachable bridge arrives with initialStatus=null and shows "disconnected".
 */

interface PageProps {
  initialStatus: MeshStatus | null
}

/** A disconnected placeholder for when the bridge is installed but unreachable. */
const DISCONNECTED_STATUS: MeshStatus = {
  adapter: 'unknown',
  model: null,
  connected: false,
  nodeId: null,
}

/** Shared elevated-card surface, matching the readiness tab cards. */
const CARD_SURFACE =
  'rounded-2xl border border-desert-stone-lighter/60 bg-desert-white ' +
  'shadow-[0_1px_2px_rgba(66,68,32,0.04),0_8px_24px_-12px_rgba(66,68,32,0.12)]'

export default function MeshIndex({ initialStatus }: PageProps) {
  const [status, setStatus] = useState<MeshStatus>(initialStatus ?? DISCONNECTED_STATUS)
  const [messages, setMessages] = useState<MeshMessage[]>([])
  const [loadingMessages, setLoadingMessages] = useState(true)
  const [refreshingStatus, setRefreshingStatus] = useState(false)

  const refreshStatus = async () => {
    setRefreshingStatus(true)
    try {
      const res = await fetch('/api/mesh/status', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      if (res.ok) {
        setStatus((await res.json()) as MeshStatus)
      } else {
        setStatus(DISCONNECTED_STATUS)
      }
    } catch {
      setStatus(DISCONNECTED_STATUS)
    } finally {
      setRefreshingStatus(false)
    }
  }

  const refreshMessages = async () => {
    setLoadingMessages(true)
    try {
      const res = await fetch('/api/mesh/messages', {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
      })
      if (res.ok) {
        const data = (await res.json()) as { messages?: MeshMessage[] }
        setMessages(Array.isArray(data.messages) ? data.messages : [])
      }
    } catch {
      // Leave the prior list in place on a transient failure.
    } finally {
      setLoadingMessages(false)
    }
  }

  // Initial messages load on mount (status arrives server-rendered).
  useEffect(() => {
    refreshMessages()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AppLayout>
      <Head title="Mesh Bridge" />

      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-bold text-desert-green flex items-center gap-2">
            <IconAntenna size={32} /> Mesh Bridge
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            Your node&apos;s link to the off-grid radio mesh — connection status, the recent message
            log, and a form to push an outbound alert over the air.
          </p>
        </header>

        <StatusPanel
          status={status}
          refreshing={refreshingStatus}
          onRefresh={refreshStatus}
        />

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <MessagesPanel
            messages={messages}
            loading={loadingMessages}
            onRefresh={refreshMessages}
          />
          <SendAlertForm onSent={refreshMessages} />
        </div>
      </div>
    </AppLayout>
  )
}

// ─── Status panel ─────────────────────────────────────────────────────────────

function StatusPanel({
  status,
  refreshing,
  onRefresh,
}: {
  status: MeshStatus
  refreshing: boolean
  onRefresh: () => void
}) {
  return (
    <section className={`overflow-hidden ${CARD_SURFACE}`}>
      <div className="flex items-center justify-between border-b border-desert-stone-lighter/40 bg-gradient-to-b from-desert-sand/50 to-transparent px-5 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-desert-green-dark">
          <IconBroadcast size={20} /> Adapter status
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-label="Refresh status"
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-desert-green transition hover:bg-desert-green/5 disabled:opacity-50"
        >
          <IconRefresh size={16} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <dl className="grid grid-cols-1 gap-px bg-desert-stone-lighter/30 sm:grid-cols-3">
        <StatusCell
          icon={<IconAntenna size={16} />}
          label="Adapter"
          value={status.adapter}
        />
        <StatusCell icon={<IconCpu size={16} />} label="Model" value={status.model ?? '—'} />
        <ConnectionCell connected={status.connected} nodeId={status.nodeId} />
      </dl>
    </section>
  )
}

function StatusCell({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="bg-desert-white px-5 py-4">
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-desert-stone">
        <span className="text-desert-green">{icon}</span>
        {label}
      </dt>
      <dd className="mt-1 break-words font-semibold text-desert-green-dark">{value}</dd>
    </div>
  )
}

function ConnectionCell({ connected, nodeId }: { connected: boolean; nodeId: string | null }) {
  return (
    <div className="bg-desert-white px-5 py-4">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-desert-stone">
        Connection
      </dt>
      <dd className="mt-1 flex items-center gap-2">
        <span
          className={[
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
            connected
              ? 'bg-desert-olive/10 text-desert-olive-dark border-desert-olive/30'
              : 'bg-desert-red/10 text-desert-red-dark border-desert-red/30',
          ].join(' ')}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-desert-olive' : 'bg-desert-red'}`}
          />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      </dd>
      {nodeId && <p className="mt-1.5 break-words text-xs text-desert-stone">node {nodeId}</p>}
    </div>
  )
}

// ─── Recent messages panel ────────────────────────────────────────────────────

function MessagesPanel({
  messages,
  loading,
  onRefresh,
}: {
  messages: MeshMessage[]
  loading: boolean
  onRefresh: () => void
}) {
  return (
    <section className={`flex flex-col overflow-hidden ${CARD_SURFACE}`}>
      <div className="flex items-center justify-between border-b border-desert-stone-lighter/40 bg-gradient-to-b from-desert-sand/50 to-transparent px-5 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-desert-green-dark">
          <IconInbox size={20} /> Recent messages
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh messages"
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-desert-green transition hover:bg-desert-green/5 disabled:opacity-50"
        >
          <IconRefresh size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-12 text-center text-desert-stone-dark">
          <IconInbox size={40} className="mb-3 text-desert-stone-light" />
          <p className="text-sm">{loading ? 'Loading messages…' : 'No messages yet.'}</p>
        </div>
      ) : (
        <ul className="divide-y divide-desert-stone-lighter/40">
          {messages.map((m, i) => (
            <MessageRow key={m.id ?? `${m.direction}-${i}`} message={m} />
          ))}
        </ul>
      )}
    </section>
  )
}

function MessageRow({ message }: { message: MeshMessage }) {
  const inbound = message.direction === 'in'
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <span
        className={[
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
          inbound
            ? 'bg-desert-green/10 text-desert-green'
            : 'bg-desert-orange/10 text-desert-orange-dark',
        ].join(' ')}
        aria-hidden="true"
      >
        {inbound ? <IconArrowDownLeft size={16} /> : <IconArrowUpRight size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold text-desert-green-dark">
            {inbound ? 'Received' : 'Sent'}
            {message.peer ? ` · ${message.peer}` : ''}
          </span>
          {message.timestamp && (
            <span className="shrink-0 text-[11px] text-desert-stone">
              {formatTimestamp(message.timestamp)}
            </span>
          )}
        </div>
        <p className="mt-0.5 break-words text-sm text-desert-stone-dark">{message.body}</p>
      </div>
    </li>
  )
}

// ─── Send outbound alert form ─────────────────────────────────────────────────

function SendAlertForm({ onSent }: { onSent: () => void }) {
  const [to, setTo] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // The SAME pure validator the server gates on drives the live counter, so the
  // client's "over budget" state and the server's 422 never disagree.
  const validation = validateAlertBody(body)
  const trimmedLength = body.trim().length
  const overBudget = !validation.ok && validation.reason === 'too_long'
  const remaining = ALERT_BODY_MAX_CHARS - trimmedLength

  const onSubmit = async () => {
    if (sending || !validation.ok) return
    setSending(true)
    setMessage(null)
    try {
      const res = await fetch('/api/mesh/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ to: to.trim(), body }),
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload.error || `HTTP ${res.status}`)
      }
      setMessage({ kind: 'ok', text: 'Alert transmitted.' })
      setBody('')
      onSent()
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err)
      setMessage({ kind: 'err', text: `Send failed: ${text}` })
    } finally {
      setSending(false)
    }
  }

  return (
    <section className={`overflow-hidden ${CARD_SURFACE}`}>
      <div className="border-b border-desert-stone-lighter/40 bg-gradient-to-b from-desert-sand/50 to-transparent px-5 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-desert-green-dark">
          <IconSend size={20} /> Send outbound alert
        </h2>
      </div>

      <div className="space-y-4 px-5 py-5">
        <div className="flex flex-col">
          <label
            htmlFor="mesh-to"
            className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-desert-stone-dark"
          >
            Recipient <span className="font-normal normal-case text-desert-stone">(blank = broadcast)</span>
          </label>
          <input
            id="mesh-to"
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="node id or name"
            className="block w-full rounded-lg border border-desert-stone-lighter bg-surface-primary px-3 py-2 text-sm text-desert-green-darker transition focus:border-desert-green focus:outline-none focus:ring-2 focus:ring-desert-green/20"
          />
        </div>

        <div className="flex flex-col">
          <label
            htmlFor="mesh-body"
            className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-desert-stone-dark"
          >
            Message
          </label>
          <textarea
            id="mesh-body"
            value={body}
            rows={3}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Keep it short — the radio carries only a couple hundred characters."
            className={[
              'block w-full resize-y rounded-lg border bg-surface-primary px-3 py-2 text-sm text-desert-green-darker transition focus:outline-none focus:ring-2',
              overBudget
                ? 'border-desert-red focus:border-desert-red focus:ring-desert-red/20'
                : 'border-desert-stone-lighter focus:border-desert-green focus:ring-desert-green/20',
            ].join(' ')}
          />
          {/* Live byte/char counter against the radio budget. */}
          <div className="mt-1.5 flex items-center justify-between text-[11px]">
            <span className={overBudget ? 'text-desert-red-dark' : 'text-desert-stone'}>
              {trimmedLength} / {ALERT_BODY_MAX_CHARS} chars
            </span>
            <span
              className={
                overBudget
                  ? 'font-semibold text-desert-red-dark'
                  : remaining <= 20
                    ? 'text-desert-orange-dark'
                    : 'text-desert-stone'
              }
            >
              {overBudget ? `${-remaining} over budget` : `${remaining} left`}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <StyledButton
            variant="primary"
            icon="IconSend"
            loading={sending}
            disabled={sending || !validation.ok}
            onClick={onSubmit}
          >
            Transmit
          </StyledButton>
          {message && (
            <span
              className={
                message.kind === 'ok'
                  ? 'text-sm text-desert-olive-dark'
                  : 'text-sm text-desert-red-dark'
              }
            >
              {message.text}
            </span>
          )}
        </div>
      </div>
    </section>
  )
}

// ─── pure display helpers ─────────────────────────────────────────────────────

/** Format an epoch-millis timestamp as a short local time; never throws. */
function formatTimestamp(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}
