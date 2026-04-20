import type { ToolCallLog } from '../types'

/**
 * Render a ToolCallLog[] as a collapsible Markdown block suitable for
 * clipboard export / GitHub comments. Kept in /lib (not /components) so that
 * react-refresh is happy (components should only export components).
 */
export function toolCallsToMarkdown(toolCalls: ToolCallLog[]): string {
  const lines: string[] = []
  lines.push(`<details><summary>Tool calls (${toolCalls.length})</summary>`)
  lines.push('')
  for (const [i, call] of toolCalls.entries()) {
    lines.push(
      `### ${i + 1}. \`${call.name}\` ${call.success ? 'OK' : 'FAIL'} (${call.durationMs}ms)`
    )
    lines.push('')
    lines.push('**args:**')
    lines.push('```json')
    lines.push(JSON.stringify(call.args, null, 2))
    lines.push('```')
    lines.push('')
    lines.push('**result:**')
    lines.push('')
    lines.push(`> ${call.resultSummary.replace(/\n/g, '\n> ')}`)
    lines.push('')
  }
  lines.push('</details>')
  return lines.join('\n')
}
