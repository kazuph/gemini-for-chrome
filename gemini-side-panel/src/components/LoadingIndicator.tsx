import { Bot } from 'lucide-react'
import { cn } from '../lib/utils'

interface LoadingIndicatorProps {
  theme?: 'light' | 'dark'
}

export default function LoadingIndicator({ theme = 'dark' }: LoadingIndicatorProps) {
  const colors = {
    bg: theme === 'dark' ? 'bg-gray-900' : 'bg-white',
    text: theme === 'dark' ? 'text-gray-200' : 'text-gray-700',
    textSecondary: theme === 'dark' ? 'text-gray-400' : 'text-gray-500',
    dot: theme === 'dark' ? 'bg-gray-400' : 'bg-gray-500',
  }

  return (
    <div className={cn('flex gap-3 px-4 py-3', colors.bg)}>
      {/* Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-emerald-600">
        <Bot className="w-5 h-5 text-white" />
      </div>

      {/* Loading animation */}
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className={cn('text-sm font-medium', colors.text)}>Gemini</span>
        </div>
        <div className={cn('flex items-center gap-1.5', colors.textSecondary)}>
          <span className="animate-pulse">Thinking</span>
          <span className="flex gap-1">
            <span className={cn('w-1.5 h-1.5 rounded-full animate-bounce', colors.dot)} style={{ animationDelay: '0ms' }} />
            <span className={cn('w-1.5 h-1.5 rounded-full animate-bounce', colors.dot)} style={{ animationDelay: '150ms' }} />
            <span className={cn('w-1.5 h-1.5 rounded-full animate-bounce', colors.dot)} style={{ animationDelay: '300ms' }} />
          </span>
        </div>
      </div>
    </div>
  )
}
