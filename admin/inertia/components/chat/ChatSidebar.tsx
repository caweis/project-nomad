import classNames from '~/lib/classNames'
import StyledButton from '../StyledButton'
import { router, usePage } from '@inertiajs/react'
import { ChatSession } from '../../../types/chat'
import { IconMessage, IconX } from '@tabler/icons-react'
import { useState } from 'react'
import KnowledgeBaseModal from './KnowledgeBaseModal'
import NomadMdModal from './NomadMdModal'

interface ChatSidebarProps {
  sessions: ChatSession[]
  activeSessionId: string | null
  onSessionSelect: (id: string) => void
  onNewChat: () => void
  onClearHistory: () => void
  isInModal?: boolean
  // Mobile drawer support — when set, the sidebar renders as a slide-in
  // overlay on small screens and an inline column on desktop. Parent owns
  // the open/close state so it can render the toggle button in the chat
  // header alongside the other controls.
  mobileOpen?: boolean
  onMobileClose?: () => void
}

export default function ChatSidebar({
  sessions,
  activeSessionId,
  onSessionSelect,
  onNewChat,
  onClearHistory,
  isInModal = false,
  mobileOpen = false,
  onMobileClose,
}: ChatSidebarProps) {
  const { aiAssistantName } = usePage<{ aiAssistantName: string }>().props
  const [isKnowledgeBaseModalOpen, setIsKnowledgeBaseModalOpen] = useState(
    () => new URLSearchParams(window.location.search).get('knowledge_base') === 'true'
  )
  const [isNomadMdModalOpen, setIsNomadMdModalOpen] = useState(false)

  function handleCloseKnowledgeBase() {
    setIsKnowledgeBaseModalOpen(false)
    const params = new URLSearchParams(window.location.search)
    if (params.has('knowledge_base')) {
      params.delete('knowledge_base')
      const newUrl = [window.location.pathname, params.toString()].filter(Boolean).join('?')
      window.history.replaceState(window.history.state, '', newUrl)
    }
  }

  // Responsive layout:
  //  - md+ : inline column, always visible, w-64 (original behavior)
  //  - <md : slide-in drawer from the left, w-72, hidden when mobileOpen=false
  //    The parent renders a hamburger button (md:hidden) in the chat header
  //    to toggle mobileOpen. A semi-transparent backdrop sits behind the
  //    drawer so the user can tap outside to dismiss.
  const handleSessionClick = (id: string) => {
    onSessionSelect(id)
    onMobileClose?.()
  }

  const handleNewChatClick = () => {
    onNewChat()
    onMobileClose?.()
  }

  return (
    <>
      {/* Mobile-only backdrop — covers the chat area when the drawer is open,
          tap to dismiss. Hidden on md+ since the sidebar is permanently inline. */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-30"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}
      <div
        className={classNames(
          // Mobile drawer styles
          'md:hidden fixed inset-y-0 left-0 w-72 z-40 transition-transform duration-200 ease-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // Shared layout
          'bg-surface-secondary border-r border-border-subtle flex flex-col h-full'
        )}
      >
        <SidebarBody
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSessionSelect={handleSessionClick}
          onNewChat={handleNewChatClick}
          onClearHistory={onClearHistory}
          isInModal={isInModal}
          aiAssistantName={aiAssistantName}
          setIsKnowledgeBaseModalOpen={setIsKnowledgeBaseModalOpen}
          setIsNomadMdModalOpen={setIsNomadMdModalOpen}
          showMobileCloseButton={true}
          onMobileClose={onMobileClose}
        />
      </div>
      {/* Desktop inline sidebar — hidden below md, the original layout above md */}
      <div className="hidden md:flex w-64 bg-surface-secondary border-r border-border-subtle flex-col h-full">
        <SidebarBody
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSessionSelect={onSessionSelect}
          onNewChat={onNewChat}
          onClearHistory={onClearHistory}
          isInModal={isInModal}
          aiAssistantName={aiAssistantName}
          setIsKnowledgeBaseModalOpen={setIsKnowledgeBaseModalOpen}
          setIsNomadMdModalOpen={setIsNomadMdModalOpen}
          showMobileCloseButton={false}
        />
      </div>
      {/* Render the Knowledge Base modal ONCE here — both SidebarBody copies
          are in the DOM at different breakpoints, so embedding the modal in
          either one would cause double-mount issues (extra API calls, duped
          effects). Hoisting it to the shared parent ensures a single
          instance regardless of which breakpoint is active. */}
      {isKnowledgeBaseModalOpen && (
        <KnowledgeBaseModal aiAssistantName={aiAssistantName} onClose={handleCloseKnowledgeBase} />
      )}
      {/* Same single-instance hoisting as the Knowledge Base modal above. */}
      {isNomadMdModalOpen && (
        <NomadMdModal
          aiAssistantName={aiAssistantName}
          onClose={() => setIsNomadMdModalOpen(false)}
        />
      )}
    </>
  )
}

// Extracted to reuse the same body in both the mobile drawer and the desktop
// inline sidebar without duplicating ~80 lines of markup. Props are a flat
// pass-through; the only mobile-specific bit is the close button at the top.
interface SidebarBodyProps {
  sessions: ChatSession[]
  activeSessionId: string | null
  onSessionSelect: (id: string) => void
  onNewChat: () => void
  onClearHistory: () => void
  isInModal: boolean
  aiAssistantName: string
  setIsKnowledgeBaseModalOpen: (open: boolean) => void
  setIsNomadMdModalOpen: (open: boolean) => void
  showMobileCloseButton: boolean
  onMobileClose?: () => void
}

function SidebarBody({
  sessions,
  activeSessionId,
  onSessionSelect,
  onNewChat,
  onClearHistory,
  isInModal,
  aiAssistantName: _aiAssistantName,
  setIsKnowledgeBaseModalOpen,
  setIsNomadMdModalOpen,
  showMobileCloseButton,
  onMobileClose,
}: SidebarBodyProps) {
  return (
    <>
      <div className="p-4 border-b border-border-subtle h-[75px] flex items-center justify-center gap-2">
        <StyledButton onClick={onNewChat} icon="IconPlus" variant="primary" fullWidth>
          New Chat
        </StyledButton>
        {showMobileCloseButton && (
          <button
            type="button"
            onClick={onMobileClose}
            className="p-2 rounded-lg hover:bg-surface-secondary flex-shrink-0"
            aria-label="Close sidebar"
          >
            <IconX className="h-5 w-5 text-text-secondary" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 ? (
          <div className="p-4 text-center text-text-muted text-sm">No previous chats</div>
        ) : (
          <div className="p-2 space-y-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSessionSelect(session.id)}
                className={classNames(
                  'w-full text-left px-3 py-2 rounded-lg transition-colors group',
                  activeSessionId === session.id
                    ? 'bg-desert-green text-white'
                    : 'hover:bg-surface-secondary text-text-primary'
                )}
              >
                <div className="flex items-start gap-2">
                  <IconMessage
                    className={classNames(
                      'h-5 w-5 mt-0.5 shrink-0',
                      activeSessionId === session.id ? 'text-white' : 'text-text-muted'
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{session.title}</div>
                    {session.lastMessage && (
                      <div
                        className={classNames(
                          'text-xs truncate mt-0.5',
                          activeSessionId === session.id ? 'text-white/80' : 'text-text-muted'
                        )}
                      >
                        {session.lastMessage}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="p-4 flex flex-col items-center justify-center gap-y-2">
        <img src="/project_nomad_logo.png" alt="Project Nomad Logo" className="h-28 w-28 mb-6" />
        <StyledButton
          onClick={() => {
            if (isInModal) {
              window.open('/chat', '_blank')
            } else {
              router.visit('/home')
            }
          }}
          icon={isInModal ? 'IconExternalLink' : 'IconHome'}
          variant="outline"
          size="sm"
          fullWidth
        >
          {isInModal ? 'Open in New Tab' : 'Back to Home'}
        </StyledButton>
        <StyledButton
          onClick={() => {
            router.visit('/settings/models')
          }}
          icon="IconDatabase"
          variant="primary"
          size="sm"
          fullWidth
        >
          Models & Settings
        </StyledButton>
        <StyledButton
          onClick={() => {
            setIsKnowledgeBaseModalOpen(true)
          }}
          icon="IconBrain"
          variant="primary"
          size="sm"
          fullWidth
        >
          Knowledge Base
        </StyledButton>
        <StyledButton
          onClick={() => {
            setIsNomadMdModalOpen(true)
          }}
          icon="IconFileDescription"
          variant="primary"
          size="sm"
          fullWidth
        >
          NOMAD.md
        </StyledButton>
        {sessions.length > 0 && (
          <StyledButton
            onClick={onClearHistory}
            icon="IconTrash"
            variant="danger"
            size="sm"
            fullWidth
          >
            Clear History
          </StyledButton>
        )}
      </div>
    </>
  )
}
