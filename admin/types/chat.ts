/**
 * A single provenance entry under an assistant answer: the document a chunk of
 * injected context came from. `source` is the originating file/ZIM path and is
 * what dedupes the list; `title` is what the user actually reads.
 */
export interface ChatSource {
  title: string
  date?: string
  source?: string
}

/**
 * An image attached to a message in the composer. The `file` is what gets
 * uploaded; `previewUrl` is a blob URL for showing it, which lives only in this
 * page. Images are never saved with the conversation.
 */
export interface ChatImageAttachment {
  id: string
  name: string
  file: File
  previewUrl: string
}

export interface ChatMessage {
  id: string
  role: 'system' | 'user' | 'assistant'
  content: string
  // Only on a message sent from this page; reloading or reopening the
  // conversation shows the text alone.
  images?: ChatImageAttachment[]
  timestamp: Date
  isStreaming?: boolean
  thinking?: string
  isThinking?: boolean
  thinkingDuration?: number
  // Generation stopped at the length limit, so the answer ends mid-thought.
  truncated?: boolean
  // The documents the answer was given to read (upstream #1179).
  sources?: ChatSource[]
}

export interface ChatSession {
  id: string
  title: string
  lastMessage?: string
  timestamp: Date
}
