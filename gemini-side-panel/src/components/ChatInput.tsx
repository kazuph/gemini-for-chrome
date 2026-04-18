import { useState, useRef, useEffect } from 'react'
import { Send, FileText, Square, MousePointer2 } from 'lucide-react'
import { cn } from '../lib/utils'

interface ChatInputProps {
  onSend: (message: string, includePageContent: boolean) => void
  onStop?: () => void
  isLoading: boolean
  theme?: 'light' | 'dark'
  browserActionMode: boolean
  onToggleBrowserActionMode: () => void
}

export default function ChatInput({
  onSend,
  onStop,
  isLoading,
  theme = 'dark',
  browserActionMode,
  onToggleBrowserActionMode,
}: ChatInputProps) {
  const [message, setMessage] = useState('')
  const [includePageContent, setIncludePageContent] = useState(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const colors = {
    bg: theme === 'dark' ? 'bg-gray-800' : 'bg-white',
    border: theme === 'dark' ? 'border-gray-700' : 'border-gray-200',
    input: theme === 'dark' ? 'bg-gray-900 border-gray-700' : 'bg-gray-50 border-gray-300',
    text: theme === 'dark' ? 'text-gray-100' : 'text-gray-900',
    placeholder: theme === 'dark' ? 'placeholder-gray-500' : 'placeholder-gray-400',
    textSecondary: theme === 'dark' ? 'text-gray-500' : 'text-gray-500',
    toggleActive: 'bg-blue-600 text-white',
    toggleInactive: theme === 'dark' ? 'bg-gray-700 text-gray-400 hover:bg-gray-600' : 'bg-gray-200 text-gray-600 hover:bg-gray-300',
  }

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }, [message])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isLoading) {
      // 送信ボタンはローディング中はStop動作のみ（submit経由でも安全に誘導）
      onStop?.()
      return
    }
    const trimmedMessage = message.trim()
    if (trimmedMessage) {
      onSend(trimmedMessage, includePageContent)
      setMessage('')
    }
  }

  const hasNewline = message.includes('\n')

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return
    // IME変換中は常に送信しない
    if (e.nativeEvent.isComposing) return

    const withModifier = e.metaKey || e.ctrlKey

    if (withModifier) {
      // ⌘/Ctrl+Enter は常に送信
      e.preventDefault()
      handleSubmit(e)
      return
    }

    if (e.shiftKey) {
      // Shift+Enter は常に改行挿入 (デフォルト挙動)
      return
    }

    // 素のEnter: 改行が無いなら送信、改行があるなら改行挿入 (デフォルト)
    if (!hasNewline) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={cn('border-t p-4', colors.bg, colors.border)}>
      {/* Mode pills - browser actions + page content */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          type="button"
          onClick={onToggleBrowserActionMode}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
            browserActionMode ? colors.toggleActive : colors.toggleInactive
          )}
          title={
            browserActionMode
              ? 'Browser actions enabled (model can click / fill / press keys)'
              : 'Browser actions disabled (chat only)'
          }
        >
          <MousePointer2 className="w-3.5 h-3.5" />
          {browserActionMode ? 'Actions on' : 'Actions off'}
        </button>

        <button
          type="button"
          onClick={() => setIncludePageContent(!includePageContent)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
            includePageContent ? colors.toggleActive : colors.toggleInactive
          )}
        >
          <FileText className="w-3.5 h-3.5" />
          {includePageContent ? 'Include page' : 'Page excluded'}
        </button>
        {includePageContent && (
          <span className={cn('text-xs', colors.textSecondary)}>
            Fetches on send
          </span>
        )}
      </div>

      {/* Input area */}
      <div className="flex items-end gap-2">
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this page or anything else..."
            disabled={isLoading}
            rows={1}
            className={cn(
              'w-full px-4 py-3 rounded-xl border',
              colors.input,
              colors.text,
              colors.placeholder,
              'focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500',
              'resize-none transition-colors',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          />
        </div>

        {/* Send / Stop button */}
        {isLoading ? (
          <button
            type="button"
            onClick={onStop}
            className={cn(
              'flex-shrink-0 p-3 rounded-xl transition-colors',
              'bg-red-600 text-white hover:bg-red-500'
            )}
            title="Stop generation"
          >
            <Square className="w-5 h-5" fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!message.trim()}
            className={cn(
              'flex-shrink-0 p-3 rounded-xl transition-colors',
              'bg-blue-600 text-white',
              'hover:bg-blue-500',
              'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600'
            )}
            title="Send message"
          >
            <Send className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Help text */}
      <p className={cn('mt-2 text-xs text-center', colors.textSecondary)}>
        {hasNewline
          ? '⌘+Enter / Ctrl+Enter to send · Enter for new line'
          : 'Enter to send · Shift+Enter for new line'}
      </p>
    </form>
  )
}
