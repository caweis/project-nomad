import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ChatSidebar from './ChatSidebar'
import ChatInterface from './ChatInterface'
import StyledModal from '../StyledModal'
import api from '~/lib/api'
import { formatBytes } from '~/lib/util'
import { useModals } from '~/context/ModalContext'
import { ChatMessage } from '../../../types/chat'
import classNames from '~/lib/classNames'
import { IconMenu2, IconX } from '@tabler/icons-react'
import { useSystemSetting } from '~/hooks/useSystemSetting'
import { isRagRetrievalEnabled } from '../../../app/utils/rag_toggle'
import Switch from '~/components/inputs/Switch'
import InfoTooltip from '~/components/InfoTooltip'

/**
 * Build a chat-failure message that names the likely cause instead of the old
 * generic "error processing your request". The most common real failure (seen
 * live, issue #25) is the selected model not being loadable — e.g. a 70B model
 * on a 32 GB Mac, or a model whose files were removed — which surfaced as a
 * generic error with no hint that switching models fixes it.
 */
function chatFailureText(error: unknown, model: string): string {
  const detail =
    error instanceof Error && error.message && error.message !== 'Failed to fetch'
      ? ` (${error.message.slice(0, 200)})`
      : ''
  const modelHint = model
    ? ` This often means "${model}" isn't installed or is too large to load on this Mac — try a different model from the dropdown.`
    : ''
  return `Sorry, the chat request failed${detail}.${modelHint}`
}

interface ChatProps {
  enabled: boolean
  isInModal?: boolean
  onClose?: () => void
  suggestionsEnabled?: boolean
  streamingEnabled?: boolean
}

export default function Chat({
  enabled,
  isInModal,
  onClose,
  suggestionsEnabled = false,
  streamingEnabled = true,
}: ChatProps) {
  const queryClient = useQueryClient()
  const { openModal, closeAllModals } = useModals()
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [collectionFilter, setCollectionFilter] = useState<string>('')
  const [isStreamingResponse, setIsStreamingResponse] = useState(false)
  // Tracks the mobile sidebar drawer open state. Desktop layout ignores
  // this entirely; the sidebar is permanently inline above the md
  // breakpoint. The hamburger button in the chat header is the only way
  // to toggle this on small screens.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const streamAbortRef = useRef<AbortController | null>(null)

  // Fetch all sessions
  const { data: sessions = [] } = useQuery({
    queryKey: ['chatSessions'],
    queryFn: () => api.getChatSessions(),
    enabled,
    select: (data) =>
      data?.map((s) => ({
        id: s.id,
        title: s.title,
        model: s.model || undefined,
        timestamp: new Date(s.timestamp),
        lastMessage: s.lastMessage || undefined,
      })) || [],
  })

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  const { data: lastModelSetting } = useSystemSetting({ key: 'chat.lastModel', enabled })
  const { data: autoThinkingSetting } = useSystemSetting({ key: 'ai.autoThinking', enabled })
  // Global default for models the user hasn't explicitly toggled. Coerce defensively — KV
  // booleans have historically round-tripped as strings.
  const autoThinkingDefault =
    autoThinkingSetting?.value === true || autoThinkingSetting?.value === 'true'

  // Knowledge base retrieval, shared with AI Assistant settings — same
  // rag.enabled KV key, so the two switches are one control in two places.
  // Note the coercion differs from autoThinking directly above on purpose:
  // this setting defaults ON, so an absent value must not read as false.
  const { data: ragEnabledSetting } = useSystemSetting({ key: 'rag.enabled', enabled })
  const ragEnabled = isRagRetrievalEnabled(ragEnabledSetting?.value)

  const ragEnabledMutation = useMutation({
    mutationFn: async (value: boolean) => await api.updateSetting('rag.enabled', value),
    // Flip the switch immediately rather than after the round-trip, and roll it
    // back if the write fails.
    onMutate: async (value: boolean) => {
      await queryClient.cancelQueries({ queryKey: ['system-setting', 'rag.enabled'] })
      const previous = queryClient.getQueryData(['system-setting', 'rag.enabled'])
      queryClient.setQueryData(['system-setting', 'rag.enabled'], { key: 'rag.enabled', value })
      return { previous }
    },
    onError: (_err, _value, context) => {
      queryClient.setQueryData(['system-setting', 'rag.enabled'], context?.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['system-setting', 'rag.enabled'] })
    },
  })

  const { data: installedModels = [], isLoading: isLoadingModels } = useQuery({
    queryKey: ['installedModels'],
    queryFn: () => api.getInstalledModels(),
    enabled,
    select: (data) => data || [],
    refetchInterval: 10_000,
  })

  // Per-model thinking overrides, remembered client-side (localStorage, keyed by model name).
  // An entry here means the user explicitly toggled thinking for that model; absent means fall
  // back to the global default (ai.autoThinking). Seeded from localStorage when models load.
  const [thinkingOverrides, setThinkingOverrides] = useState<Record<string, boolean>>({})
  useEffect(() => {
    const next: Record<string, boolean> = {}
    for (const m of installedModels) {
      try {
        const stored = localStorage.getItem(`nomad:thinking:${m.name}`)
        if (stored !== null) next[m.name] = stored === 'true'
      } catch {}
    }
    setThinkingOverrides(next)
  }, [installedModels])

  const selectedModelSupportsThinking =
    installedModels.find((m) => m.name === selectedModel)?.thinking === true

  // Effective thinking preference for a model: explicit override wins, else the global default.
  const effectiveThinking = useCallback(
    (model: string): boolean =>
      model in thinkingOverrides ? thinkingOverrides[model] : autoThinkingDefault,
    [thinkingOverrides, autoThinkingDefault]
  )

  const setModelThinking = useCallback((model: string, value: boolean) => {
    setThinkingOverrides((prev) => ({ ...prev, [model]: value }))
    try {
      localStorage.setItem(`nomad:thinking:${model}`, String(value))
    } catch {}
  }, [])

  const { data: knownCollections = [] } = useQuery({
    queryKey: ['kbCollections'],
    queryFn: () => api.getKnowledgeCollections(),
    enabled,
    select: (data) => data?.collections ?? [],
  })

  const { data: chatSuggestions, isLoading: chatSuggestionsLoading } = useQuery<string[]>({
    queryKey: ['chatSuggestions'],
    queryFn: async ({ signal }) => {
      const res = await api.getChatSuggestions(signal)
      return res ?? []
    },
    enabled: suggestionsEnabled && !activeSessionId,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  })

  const deleteAllSessionsMutation = useMutation({
    mutationFn: () => api.deleteAllChatSessions(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] })
      setActiveSessionId(null)
      setMessages([])
      closeAllModals()
    },
  })

  const chatMutation = useMutation({
    mutationFn: (request: {
      model: string
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
      sessionId?: number
      think?: boolean
      collection?: string
    }) => api.sendChatMessage({ ...request, stream: false }),
    onSuccess: async (data) => {
      if (!data || !activeSessionId) {
        throw new Error('No response from Ollama')
      }

      // Add assistant message
      const assistantMessage: ChatMessage = {
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        content: data.message?.content || 'Sorry, I could not generate a response.',
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])

      // Refresh sessions to pick up backend-persisted messages and title
      queryClient.invalidateQueries({ queryKey: ['chatSessions'] })
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['chatSessions'] }), 3000)
    },
    onError: (error) => {
      console.error('Error sending message:', error)
      const errorMessage: ChatMessage = {
        id: `msg-${Date.now()}-error`,
        role: 'assistant',
        content: chatFailureText(error, selectedModel),
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    },
  })

  // Set default model: prefer last used model, fall back to first installed if last model not available
  useEffect(() => {
    if (installedModels.length > 0 && !selectedModel) {
      const lastModel = lastModelSetting?.value as string | undefined
      if (lastModel && installedModels.some((m) => m.name === lastModel)) {
        setSelectedModel(lastModel)
      } else {
        setSelectedModel(installedModels[0].name)
      }
    }
  }, [installedModels, selectedModel, lastModelSetting])

  // Persist model selection
  useEffect(() => {
    if (selectedModel) {
      api.updateSetting('chat.lastModel', selectedModel)
    }
  }, [selectedModel])

  const handleNewChat = useCallback(() => {
    // Just clear the active session and messages - don't create a session yet
    setActiveSessionId(null)
    setMessages([])
  }, [])

  const handleClearHistory = useCallback(() => {
    openModal(
      <StyledModal
        title="Clear All Chat History?"
        onConfirm={() => deleteAllSessionsMutation.mutate()}
        onCancel={closeAllModals}
        open={true}
        confirmText="Clear All"
        cancelText="Cancel"
        confirmVariant="danger"
      >
        <p className="text-text-primary">
          Are you sure you want to delete all chat sessions? This action cannot be undone and all
          conversations will be permanently deleted.
        </p>
      </StyledModal>,
      'confirm-clear-history-modal'
    )
  }, [openModal, closeAllModals, deleteAllSessionsMutation])

  const handleSessionSelect = useCallback(
    async (sessionId: string) => {
      // Cancel any ongoing suggestions fetch
      queryClient.cancelQueries({ queryKey: ['chatSuggestions'] })

      setActiveSessionId(sessionId)
      // Load messages for this session
      const sessionData = await api.getChatSession(sessionId)
      if (sessionData?.messages) {
        setMessages(
          sessionData.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(m.timestamp),
          }))
        )
      } else {
        setMessages([])
      }

      // Set the model to match the session's model if it exists and is available
      if (sessionData?.model) {
        setSelectedModel(sessionData.model)
      }
    },
    [installedModels, queryClient]
  )

  const handleSendMessage = useCallback(
    async (content: string) => {
      let sessionId = activeSessionId

      // Create a new session if none exists
      if (!sessionId) {
        const newSession = await api.createChatSession('New Chat', selectedModel)
        if (newSession) {
          sessionId = newSession.id
          setActiveSessionId(sessionId)
          queryClient.invalidateQueries({ queryKey: ['chatSessions'] })
        } else {
          return
        }
      }

      // Add user message to UI
      const userMessage: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, userMessage])

      const chatMessages = [
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content },
      ]

      if (streamingEnabled !== false) {
        // Streaming path
        const abortController = new AbortController()
        streamAbortRef.current = abortController

        setIsStreamingResponse(true)

        const assistantMsgId = `msg-${Date.now()}-assistant`
        let isFirstChunk = true
        let fullContent = ''
        let thinkingContent = ''
        let isThinkingPhase = true
        let thinkingStartTime: number | null = null
        let thinkingDuration: number | null = null

        try {
          await api.streamChatMessage(
            { model: selectedModel || 'llama3.2', messages: chatMessages, stream: true, sessionId: sessionId ? Number(sessionId) : undefined, think: effectiveThinking(selectedModel), collection: collectionFilter || undefined },
            (chunkContent, chunkThinking, done) => {
              if (chunkThinking.length > 0 && thinkingStartTime === null) {
                thinkingStartTime = Date.now()
              }
              if (isFirstChunk) {
                isFirstChunk = false
                setIsStreamingResponse(false)
                setMessages((prev) => [
                  ...prev,
                  {
                    id: assistantMsgId,
                    role: 'assistant',
                    content: chunkContent,
                    thinking: chunkThinking,
                    timestamp: new Date(),
                    isStreaming: true,
                    isThinking: chunkThinking.length > 0 && chunkContent.length === 0,
                    thinkingDuration: undefined,
                  },
                ])
              } else {
                if (isThinkingPhase && chunkContent.length > 0) {
                  isThinkingPhase = false
                  if (thinkingStartTime !== null) {
                    thinkingDuration = Math.max(1, Math.round((Date.now() - thinkingStartTime) / 1000))
                  }
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? {
                        ...m,
                        content: m.content + chunkContent,
                        thinking: (m.thinking ?? '') + chunkThinking,
                        isStreaming: !done,
                        isThinking: isThinkingPhase,
                        thinkingDuration: thinkingDuration ?? undefined,
                      }
                      : m
                  )
                )
              }
              fullContent += chunkContent
              thinkingContent += chunkThinking
            },
            abortController.signal
          )
        } catch (error: any) {
          if (error?.name !== 'AbortError') {
            setMessages((prev) => {
              const hasAssistantMsg = prev.some((m) => m.id === assistantMsgId)
              if (hasAssistantMsg) {
                return prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, isStreaming: false } : m
                )
              }
              return [
                ...prev,
                {
                  id: assistantMsgId,
                  role: 'assistant',
                  content: chatFailureText(error, selectedModel),
                  timestamp: new Date(),
                },
              ]
            })
          }
        } finally {
          setIsStreamingResponse(false)
          streamAbortRef.current = null
        }

        if (fullContent && sessionId) {
          // Ensure the streaming cursor is removed
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, isStreaming: false } : m
            )
          )

          // Refresh sessions to pick up backend-persisted messages and title
          queryClient.invalidateQueries({ queryKey: ['chatSessions'] })
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ['chatSessions'] }), 3000)
        }
      } else {
        // Non-streaming (legacy) path
        chatMutation.mutate({
          model: selectedModel || 'llama3.2',
          messages: chatMessages,
          sessionId: sessionId ? Number(sessionId) : undefined,
          think: effectiveThinking(selectedModel),
          collection: collectionFilter || undefined,
        })
      }
    },
    [activeSessionId, messages, selectedModel, collectionFilter, chatMutation, queryClient, streamingEnabled, effectiveThinking]
  )

  return (
    <div
      className={classNames(
        'flex border border-border-subtle overflow-hidden shadow-sm w-full',
        isInModal ? 'h-full rounded-lg' : 'h-screen'
      )}
    >
      <ChatSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSessionSelect={handleSessionSelect}
        onNewChat={handleNewChat}
        onClearHistory={handleClearHistory}
        isInModal={isInModal}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-4 sm:px-6 py-3 border-b border-border-subtle bg-surface-secondary flex items-center justify-between h-[75px] flex-shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Hamburger toggle — visible only below the md breakpoint where
                the sidebar is hidden by default. Tap to open the drawer. */}
            <button
              type="button"
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden p-2 -ml-2 rounded-lg hover:bg-surface-secondary flex-shrink-0"
              aria-label="Open chat history"
            >
              <IconMenu2 className="h-6 w-6 text-text-secondary" />
            </button>
            <h2 className="text-base sm:text-lg font-semibold text-text-primary truncate">
              {activeSession?.title || 'New Chat'}
            </h2>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            {ragEnabled && knownCollections.length > 0 && (
              <div className="hidden sm:flex items-center gap-2">
                <label htmlFor="collection-select" className="text-sm text-text-secondary">
                  Search in:
                </label>
                <select
                  id="collection-select"
                  value={collectionFilter}
                  onChange={(e) => setCollectionFilter(e.target.value)}
                  className="px-2 sm:px-3 py-1.5 border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-desert-green focus:border-transparent bg-surface-primary max-w-[140px] truncate"
                >
                  <option value="">All</option>
                  {knownCollections.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <label htmlFor="model-select" className="hidden sm:inline text-sm text-text-secondary">
                Model:
              </label>
              {isLoadingModels ? (
                <div className="text-sm text-text-muted">Loading...</div>
              ) : installedModels.length === 0 ? (
                <div className="text-sm text-red-600">No models</div>
              ) : (
                <select
                  id="model-select"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="px-2 sm:px-3 py-1.5 border border-border-default rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-desert-green focus:border-transparent bg-surface-primary max-w-[150px] sm:max-w-none truncate"
                >
                  {installedModels.map((model) => (
                    <option key={model.name} value={model.name}>
                      {/* On the oMLX backend the proxy reports size 0 for chat
                          models (no size in the OpenAI API) — "(0 Bytes)" read
                          as "not installed" (issue #25), so omit it. */}
                      {model.size > 0 ? `${model.name} (${formatBytes(model.size)})` : model.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex items-center">
              <span className="text-sm text-text-secondary select-none">Knowledge Base:</span>
              <InfoTooltip
                position="bottom"
                align="right"
                text="When on, the assistant searches your knowledge base for relevant documents before answering. Turning it off skips that search, which is quicker and uses less memory when your knowledge base is small or empty. This is the same setting as the one in AI Assistant settings."
              />
              <Switch
                id="chat-rag-toggle"
                checked={ragEnabled}
                onChange={(v) => ragEnabledMutation.mutate(v)}
              />
            </div>
            {selectedModelSupportsThinking && (
              <div className="flex items-center">
                <span className="text-sm text-text-secondary select-none">Thinking:</span>
                <InfoTooltip
                  position="bottom"
                  align="right"
                  text="When on, this model works through its reasoning before answering. Slower, but often better on tricky questions. Your choice is remembered for this model; the default for other models is set in AI Assistant settings."
                />
                <Switch
                  id="chat-thinking-toggle"
                  checked={effectiveThinking(selectedModel)}
                  onChange={(v) => setModelThinking(selectedModel, v)}
                />
              </div>
            )}
            {isInModal && (
              <button
                onClick={() => {
                  if (onClose) {
                    onClose()
                  }
                }}
                className="rounded-lg hover:bg-surface-secondary transition-colors p-1"
                aria-label="Close chat"
              >
                <IconX className="h-6 w-6 text-text-muted" />
              </button>
            )}
          </div>
        </div>
        <ChatInterface
          messages={messages}
          onSendMessage={handleSendMessage}
          isLoading={isStreamingResponse || chatMutation.isPending}
          chatSuggestions={chatSuggestions}
          chatSuggestionsEnabled={suggestionsEnabled}
          chatSuggestionsLoading={chatSuggestionsLoading}
        />
      </div>
    </div>
  )
}
