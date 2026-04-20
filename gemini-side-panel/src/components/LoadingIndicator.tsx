import { Bot } from 'lucide-react'
import type { ToolCallLog } from '../types'
import { cn } from '../lib/utils'
import ToolCallsPanel from './ToolCallsPanel'

interface LoadingIndicatorProps {
  theme?: 'light' | 'dark'
  runningToolNames?: string[]
  /** Tool calls already completed during this turn (streamed). Rendered as a
   *  collapsible panel so the user can peek at progress while the model is
   *  still working. */
  toolCalls?: ToolCallLog[]
}

export default function LoadingIndicator({
  theme = 'dark',
  runningToolNames,
  toolCalls,
}: LoadingIndicatorProps) {
  const colors = {
    bg: theme === 'dark' ? 'bg-gray-900' : 'bg-white',
    text: theme === 'dark' ? 'text-gray-200' : 'text-gray-700',
    textSecondary: theme === 'dark' ? 'text-gray-400' : 'text-gray-500',
    dot: theme === 'dark' ? 'bg-gray-400' : 'bg-gray-500',
    runningBadge:
      theme === 'dark'
        ? 'bg-emerald-900/40 text-emerald-300 border-emerald-700'
        : 'bg-emerald-50 text-emerald-700 border-emerald-300',
  }

  const hasRunning = runningToolNames && runningToolNames.length > 0
  const hasToolCalls = toolCalls !== undefined && toolCalls.length > 0

  return (
    <div className={cn('flex gap-3 px-4 py-3', colors.bg)}>
      {/* Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-emerald-600">
        <Bot className="w-5 h-5 text-white" />
      </div>

      {/* Loading animation + progress */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={cn('text-sm font-medium', colors.text)}>Gemini</span>
        </div>

        {/* Completed tool calls so far (live panel) */}
        {hasToolCalls && (
          <ToolCallsPanel toolCalls={toolCalls!} theme={theme} live={true} />
        )}

        {/* "実行中: <tool>" pulse badges */}
        {hasRunning && (
          <div className="mb-2 flex flex-wrap items-center gap-1">
            <span className={cn('text-xs', colors.textSecondary)}>実行中:</span>
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

        {/* Thinking / running dots */}
        <div className={cn('flex items-center gap-1.5', colors.textSecondary)}>
          <span className="animate-pulse">{hasRunning ? '実行中' : 'Thinking'}</span>
          <span className="flex gap-1">
            <span
              className={cn('w-1.5 h-1.5 rounded-full animate-bounce', colors.dot)}
              style={{ animationDelay: '0ms' }}
            />
            <span
              className={cn('w-1.5 h-1.5 rounded-full animate-bounce', colors.dot)}
              style={{ animationDelay: '150ms' }}
            />
            <span
              className={cn('w-1.5 h-1.5 rounded-full animate-bounce', colors.dot)}
              style={{ animationDelay: '300ms' }}
            />
          </span>
        </div>
      </div>
    </div>
  )
}
