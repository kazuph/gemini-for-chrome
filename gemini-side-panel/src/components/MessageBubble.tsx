import { useState } from 'react'
import { User, Bot, Copy, Check } from 'lucide-react'
import type { Message } from '../types'
import { cn, formatTime } from '../lib/utils'
import MarkdownRenderer from './MarkdownRenderer'

interface MessageBubbleProps {
  message: Message
  theme?: 'light' | 'dark'
  fontSize?: number
}

export default function MessageBubble({ message, theme = 'dark', fontSize = 14 }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)

  const colors = {
    bg: isUser
      ? theme === 'dark' ? 'bg-gray-800/50' : 'bg-gray-100'
      : theme === 'dark' ? 'bg-gray-900' : 'bg-white',
    text: theme === 'dark' ? 'text-gray-100' : 'text-gray-900',
    textSecondary: theme === 'dark' ? 'text-gray-200' : 'text-gray-700',
    textTertiary: theme === 'dark' ? 'text-gray-500' : 'text-gray-500',
    copyButton: theme === 'dark' ? 'hover:bg-gray-700' : 'hover:bg-gray-200',
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

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
          {/* Copy button - always visible for assistant, on hover for user */}
          <button
            onClick={handleCopy}
            className={cn(
              'p-1 rounded transition-all',
              colors.textTertiary,
              colors.copyButton,
              isUser ? 'opacity-0 group-hover:opacity-100' : 'opacity-60 hover:opacity-100'
            )}
            title="Copy to clipboard"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
        <div className={colors.text}>
          {isUser ? (
            <p className="whitespace-pre-wrap break-words" style={{ fontSize: `${fontSize}px` }}>
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
