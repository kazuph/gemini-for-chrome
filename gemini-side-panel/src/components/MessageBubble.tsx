import { useState, useEffect, useRef } from 'react'
import { User, Bot, Copy, Check, X } from 'lucide-react'
import type { Message } from '../types'
import { cn, formatTime } from '../lib/utils'
import MarkdownRenderer from './MarkdownRenderer'
import ToolCallsPanel from './ToolCallsPanel'
import { toolCallsToMarkdown } from '../lib/toolCallsMarkdown'

interface MessageBubbleProps {
  message: Message
  theme?: 'light' | 'dark'
  fontSize?: number
  /** When this message is the currently-streaming assistant bubble, the tool
   *  names that are mid-execution (rendered as a small "実行中" badge row). */
  runningToolNames?: string[]
  /** When true, show a "live" hint on the tool-calls panel (streaming case). */
  live?: boolean
  /** Whether this message is currently being edited (user messages only). */
  isEditing?: boolean
  /** User double-clicked the body — request edit mode. */
  onStartEdit?: (messageId: string) => void
  /** User pressed Escape or clicked cancel. */
  onCancelEdit?: () => void
  /** User submitted the edited content. */
  onSubmitEdit?: (messageId: string, newContent: string) => void
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    // Fallback to execCommand for older environments / permission-restricted
    // side panels.
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    try {
      document.execCommand('copy')
    } finally {
      document.body.removeChild(ta)
    }
  }
}

export default function MessageBubble({
  message,
  theme = 'dark',
  fontSize = 14,
  runningToolNames,
  live = false,
  isEditing = false,
  onStartEdit,
  onCancelEdit,
  onSubmitEdit,
}: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const [draft, setDraft] = useState<string>(message.content)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const colors = {
    bg: isUser
      ? theme === 'dark' ? 'bg-gray-800/50' : 'bg-gray-100'
      : theme === 'dark' ? 'bg-gray-900' : 'bg-white',
    text: theme === 'dark' ? 'text-gray-100' : 'text-gray-900',
    textSecondary: theme === 'dark' ? 'text-gray-200' : 'text-gray-700',
    textTertiary: theme === 'dark' ? 'text-gray-500' : 'text-gray-500',
    copyButton: theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200',
    runningBadge:
      theme === 'dark'
        ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700'
        : 'bg-emerald-50 text-emerald-700 border-emerald-300',
    editInput:
      theme === 'dark'
        ? 'bg-gray-900 border-blue-500 text-gray-100 placeholder-gray-500'
        : 'bg-white border-blue-500 text-gray-900 placeholder-gray-400',
    cancelButton:
      theme === 'dark'
        ? 'bg-gray-700 text-gray-200 hover:bg-gray-600'
        : 'bg-gray-200 text-gray-700 hover:bg-gray-300',
  }

  const toolCalls = message.toolCalls
  const hasToolCalls = !isUser && toolCalls !== undefined && toolCalls.length > 0
  const hasRunning = !isUser && runningToolNames !== undefined && runningToolNames.length > 0

  const handleCopy = async () => {
    const body = message.content
    const toolMd = hasToolCalls ? toolCallsToMarkdown(toolCalls!) : ''
    const full = toolMd ? `${body}\n\n${toolMd}` : body
    try {
      await copyToClipboard(full)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  // Keep local draft synchronised with the message whenever we enter edit mode.
  // We intentionally setState here to initialise the textarea from the
  // canonical message content each time the user double-clicks.
  useEffect(() => {
    if (isEditing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(message.content)
    }
  }, [isEditing, message.content])

  // Auto-focus + place caret at end when edit mode is entered.
  useEffect(() => {
    if (isEditing) {
      const ta = textareaRef.current
      if (ta) {
        ta.focus()
        const end = ta.value.length
        ta.setSelectionRange(end, end)
      }
    }
  }, [isEditing])

  // Auto-resize textarea to fit content (mirrors ChatInput logic).
  useEffect(() => {
    if (!isEditing) return
    const ta = textareaRef.current
    if (ta) {
      ta.style.height = 'auto'
      ta.style.height = `${Math.min(ta.scrollHeight, 400)}px`
    }
  }, [draft, isEditing])

  const canSubmitEdit = draft.trim().length > 0
  const draftHasNewline = draft.includes('\n')

  const handleSubmitEdit = () => {
    if (!canSubmitEdit) return
    onSubmitEdit?.(message.id, draft)
  }

  const handleCancelEdit = () => {
    onCancelEdit?.()
  }

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
      return
    }
    if (e.key !== 'Enter') return
    // IME変換中は常に送信しない
    if (e.nativeEvent.isComposing) return

    const withModifier = e.metaKey || e.ctrlKey

    if (withModifier) {
      e.preventDefault()
      handleSubmitEdit()
      return
    }

    if (e.shiftKey) {
      // Shift+Enter は改行 (デフォルト挙動)
      return
    }

    // 素のEnter: 改行が無いなら送信、改行があるなら改行挿入 (デフォルト)
    if (!draftHasNewline) {
      e.preventDefault()
      handleSubmitEdit()
    }
  }

  const canStartEdit = isUser && !isEditing && onStartEdit !== undefined

  return (
    <div className={cn('flex gap-3 px-4 py-3 group', colors.bg)}>
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
          isUser ? 'bg-blue-600' : 'bg-emerald-600'
        )}
      >
        {isUser ? (
          <User className="w-5 h-5 text-white" />
        ) : (
          <Bot className="w-5 h-5 text-white" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={cn('text-sm font-medium', colors.textSecondary)}>
            {isUser ? 'You' : 'Gemini'}
          </span>
          <span className={cn('text-xs', colors.textTertiary)}>
            {formatTime(message.timestamp)}
          </span>
          {isEditing && isUser && (
            <span className={cn('text-xs font-medium text-blue-500')}>
              Editing…
            </span>
          )}
          {/* Copy button — assistant only; User messages get no copy button. */}
          {!isUser && (
            <button
              onClick={handleCopy}
              className={cn(
                'ml-auto p-1 rounded transition-all',
                colors.textTertiary,
                colors.copyButton,
                'opacity-60 hover:opacity-100'
              )}
              title="Copy message (with tool calls) to clipboard"
              aria-label="Copy to clipboard"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>

        {/* Tool calls summary panel (assistant only, collapsible) */}
        {hasToolCalls && (
          <ToolCallsPanel toolCalls={toolCalls!} theme={theme} live={live} />
        )}

        {/* Running tools badges (only while streaming) */}
        {hasRunning && (
          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className={cn('text-xs', colors.textTertiary)}>実行中:</span>
            {runningToolNames!.map((name, i) => (
              <span
                key={`${name}-${i}`}
                className={cn(
                  'inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-mono animate-pulse',
                  colors.runningBadge
                )}
              >
                {name}
              </span>
            ))}
          </div>
        )}

        <div className={colors.text}>
          {isEditing && isUser ? (
            <div className="flex flex-col gap-2">
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleEditKeyDown}
                rows={1}
                className={cn(
                  'w-full px-3 py-2 rounded-lg border resize-none',
                  'focus:outline-none focus:ring-1 focus:ring-blue-500',
                  colors.editInput
                )}
                style={{ fontSize: `${fontSize}px` }}
                placeholder="Edit your message…"
              />
              <div className="flex items-center justify-between gap-2">
                <p className={cn('text-xs', colors.textTertiary)}>
                  {draftHasNewline
                    ? '⌘+Enter / Ctrl+Enter to resend · Esc to cancel'
                    : 'Enter to resend · Shift+Enter for new line · Esc to cancel'}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className={cn(
                      'flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      colors.cancelButton
                    )}
                    title="Cancel edit (Esc)"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmitEdit}
                    disabled={!canSubmitEdit}
                    className={cn(
                      'flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                      'bg-emerald-600 text-white hover:bg-emerald-500',
                      'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-emerald-600'
                    )}
                    title="Resend edited message"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Resend
                  </button>
                </div>
              </div>
            </div>
          ) : isUser ? (
            <p
              className={cn(
                'whitespace-pre-wrap break-words',
                canStartEdit ? 'cursor-text hover:cursor-pointer' : undefined
              )}
              style={{ fontSize: `${fontSize}px` }}
              onDoubleClick={
                canStartEdit ? () => onStartEdit?.(message.id) : undefined
              }
              title={canStartEdit ? 'Double-click to edit' : undefined}
            >
              {message.content}
            </p>
          ) : (
            <MarkdownRenderer content={message.content} theme={theme} fontSize={fontSize} />
          )}
        </div>
      </div>
    </div>
  )
}
