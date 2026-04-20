import { useState } from 'react'
import { ChevronRight, ChevronDown, Wrench, CheckCircle2, XCircle } from 'lucide-react'
import type { ToolCallLog } from '../types'
import { cn } from '../lib/utils'

interface ToolCallsPanelProps {
  toolCalls: ToolCallLog[]
  theme?: 'light' | 'dark'
  /** When true (streaming), render a subtle "ライブ" hint so the user knows the
   *  list is still growing. */
  live?: boolean
  /** Default expanded state. Defaults to false (collapsed). */
  defaultExpanded?: boolean
}

/**
 * Build a short summary line like "read_page, find_elements×3, scroll_by".
 */
function summarizeToolCalls(toolCalls: ToolCallLog[]): string {
  const counts = new Map<string, number>()
  const order: string[] = []
  for (const call of toolCalls) {
    if (!counts.has(call.name)) order.push(call.name)
    counts.set(call.name, (counts.get(call.name) ?? 0) + 1)
  }
  return order
    .map((name) => {
      const n = counts.get(name) ?? 0
      return n > 1 ? `${name}×${n}` : name
    })
    .join(', ')
}

/**
 * Collapsible panel showing a structured log of ToolCallLog entries.
 * Shared between completed assistant messages and the in-flight streaming
 * bubble / loading indicator, so the user sees progress in real time.
 */
export default function ToolCallsPanel({
  toolCalls,
  theme = 'dark',
  live = false,
  defaultExpanded = false,
}: ToolCallsPanelProps) {
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded)

  if (toolCalls.length === 0) return null

  const colors = {
    text: theme === 'dark' ? 'text-gray-100' : 'text-gray-900',
    textSecondary: theme === 'dark' ? 'text-gray-200' : 'text-gray-700',
    textTertiary: theme === 'dark' ? 'text-gray-500' : 'text-gray-500',
    toolCard: theme === 'dark' ? 'bg-gray-800/60 border-gray-700' : 'bg-gray-50 border-gray-200',
    toolCardHover: theme === 'dark' ? 'hover:bg-gray-800' : 'hover:bg-gray-100',
    toolDetailBg: theme === 'dark' ? 'bg-gray-900/60 border-gray-700' : 'bg-white border-gray-200',
    argsBg:
      theme === 'dark'
        ? 'bg-gray-950 border-gray-800 text-gray-200'
        : 'bg-gray-100 border-gray-200 text-gray-800',
    liveDot: theme === 'dark' ? 'bg-emerald-400' : 'bg-emerald-500',
  }

  return (
    <div className={cn('mb-2 rounded-lg border overflow-hidden', colors.toolCard)}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors',
          colors.textSecondary,
          colors.toolCardHover
        )}
      >
        <Wrench className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="font-semibold flex-shrink-0">Tool calls:</span>
        <span className={cn('font-mono truncate', colors.textTertiary)}>
          {summarizeToolCalls(toolCalls)}
        </span>
        {live && (
          <span className="flex items-center gap-1 flex-shrink-0">
            <span className={cn('w-1.5 h-1.5 rounded-full animate-pulse', colors.liveDot)} />
            <span className={cn('text-[10px] uppercase tracking-wide', colors.textTertiary)}>live</span>
          </span>
        )}
        <span className={cn('ml-auto flex-shrink-0 flex items-center gap-1', colors.textTertiary)}>
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          <span>詳細</span>
        </span>
      </button>
      {expanded && (
        <div className={cn('border-t px-3 py-2 space-y-2', colors.toolDetailBg)}>
          {toolCalls.map((call, i) => (
            <div key={i} className={cn('rounded-md border p-2', colors.toolDetailBg)}>
              <div className="flex items-center gap-2 text-xs">
                <span className={cn('font-mono font-semibold', colors.text)}>
                  {i + 1}. {call.name}
                </span>
                {call.success ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-red-500" />
                )}
                <span className={cn('ml-auto', colors.textTertiary)}>{call.durationMs}ms</span>
              </div>
              {Object.keys(call.args).length > 0 && (
                <pre
                  className={cn(
                    'mt-1.5 rounded border px-2 py-1.5 text-[11px] overflow-x-auto whitespace-pre-wrap break-all',
                    colors.argsBg
                  )}
                >
                  {JSON.stringify(call.args, null, 2)}
                </pre>
              )}
              <div className={cn('mt-1.5 text-xs', colors.textSecondary)}>
                <span className={cn('font-semibold mr-1', colors.textTertiary)}>→</span>
                <span className="font-mono break-words">{call.resultSummary}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

