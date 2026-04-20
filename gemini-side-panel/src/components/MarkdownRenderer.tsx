import { useMemo, Fragment } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { cn } from '../lib/utils'
import MermaidDiagram from './MermaidDiagram'

interface MarkdownRendererProps {
  content: string
  className?: string
  theme?: 'light' | 'dark'
  fontSize?: number
}

// Configure marked options
marked.setOptions({
  breaks: true, // Convert \n to <br>
  gfm: true, // GitHub Flavored Markdown
})

// Regex to match mermaid code blocks
const MERMAID_REGEX = /```mermaid\n([\s\S]*?)```/g

interface ContentSegment {
  type: 'markdown' | 'mermaid'
  content: string
}

function parseContentSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = []
  let lastIndex = 0

  // Find all mermaid blocks
  const matches = [...content.matchAll(MERMAID_REGEX)]

  for (const match of matches) {
    const matchIndex = match.index!
    const mermaidCode = match[1]

    // Add markdown segment before this mermaid block (if any)
    if (matchIndex > lastIndex) {
      const markdownContent = content.slice(lastIndex, matchIndex)
      if (markdownContent.trim()) {
        segments.push({ type: 'markdown', content: markdownContent })
      }
    }

    // Add mermaid segment
    segments.push({ type: 'mermaid', content: mermaidCode.trim() })

    lastIndex = matchIndex + match[0].length
  }

  // Add remaining markdown content (if any)
  if (lastIndex < content.length) {
    const remainingContent = content.slice(lastIndex)
    if (remainingContent.trim()) {
      segments.push({ type: 'markdown', content: remainingContent })
    }
  }

  // If no segments were created, treat entire content as markdown
  if (segments.length === 0 && content.trim()) {
    segments.push({ type: 'markdown', content })
  }

  return segments
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel'],
    ADD_TAGS: ['pre', 'code'],
  })
}

export default function MarkdownRenderer({ content, className, theme = 'dark', fontSize = 14 }: MarkdownRendererProps) {
  const segments = useMemo(() => parseContentSegments(content), [content])

  // Theme-specific styles
  const themeStyles = theme === 'dark' ? `
    [&_pre]:bg-gray-800
    [&_code]:bg-gray-700
    [&_blockquote]:border-gray-600
    [&_blockquote]:text-gray-400
    [&_a]:text-blue-400
    [&_hr]:border-gray-700
    [&_table]:border-gray-600
    [&_th]:bg-gray-800 [&_th]:border-gray-600
    [&_td]:border-gray-700
    [&_tbody_tr:nth-child(even)]:bg-gray-900/40
  ` : `
    [&_pre]:bg-gray-100
    [&_code]:bg-gray-200
    [&_blockquote]:border-gray-300
    [&_blockquote]:text-gray-600
    [&_a]:text-blue-600
    [&_hr]:border-gray-300
    [&_table]:border-gray-300
    [&_th]:bg-gray-100 [&_th]:border-gray-300
    [&_td]:border-gray-200
    [&_tbody_tr:nth-child(even)]:bg-gray-50
  `

  const baseMarkdownStyles = cn(
    'prose max-w-none',
    theme === 'dark' ? 'prose-invert' : '',
    // Base styles
    '[&_pre]:rounded-md [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto',
    '[&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_code]:font-mono',
    '[&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_blockquote]:my-2 [&_blockquote]:italic',
    '[&_a]:underline [&_a]:hover:opacity-80',
    '[&_ul]:list-disc [&_ul]:ml-4 [&_ul]:my-2',
    '[&_ol]:list-decimal [&_ol]:ml-4 [&_ol]:my-2',
    '[&_li]:my-1',
    '[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-5 [&_h1]:mb-3',
    '[&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2',
    '[&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-2',
    '[&_h4]:text-base [&_h4]:font-semibold [&_h4]:mt-4 [&_h4]:mb-2',
    '[&_p]:my-2',
    '[&_hr]:my-4',
    // Table styles — proper borders / header contrast / zebra rows so GFM
    // tables render as actual tables instead of visually-merged text columns.
    '[&_table]:w-full [&_table]:my-3 [&_table]:border-collapse [&_table]:border [&_table]:text-sm [&_table]:block [&_table]:overflow-x-auto',
    '[&_thead]:text-left',
    '[&_th]:px-3 [&_th]:py-2 [&_th]:border [&_th]:font-semibold [&_th]:text-left',
    '[&_td]:px-3 [&_td]:py-2 [&_td]:border [&_td]:align-top',
    themeStyles
  )

  return (
    <div className={className} style={{ fontSize: `${fontSize}px` }}>
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {segment.type === 'mermaid' ? (
            <MermaidDiagram code={segment.content} theme={theme} />
          ) : (
            <div
              className={baseMarkdownStyles}
              dangerouslySetInnerHTML={{
                __html: sanitizeHtml(marked.parse(segment.content) as string)
              }}
            />
          )}
        </Fragment>
      ))}
    </div>
  )
}
