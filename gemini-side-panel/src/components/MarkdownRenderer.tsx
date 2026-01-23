import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { cn } from '../lib/utils'

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

export default function MarkdownRenderer({ content, className, theme = 'dark', fontSize = 14 }: MarkdownRendererProps) {
  const sanitizedHtml = useMemo(() => {
    // Parse markdown to HTML
    const rawHtml = marked.parse(content) as string

    // Sanitize HTML
    return DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ['target', 'rel'],
      ADD_TAGS: ['pre', 'code'],
    })
  }, [content])

  // Theme-specific styles
  const themeStyles = theme === 'dark' ? `
    [&_pre]:bg-gray-800
    [&_code]:bg-gray-700
    [&_blockquote]:border-gray-600
    [&_blockquote]:text-gray-400
    [&_a]:text-blue-400
    [&_hr]:border-gray-700
  ` : `
    [&_pre]:bg-gray-100
    [&_code]:bg-gray-200
    [&_blockquote]:border-gray-300
    [&_blockquote]:text-gray-600
    [&_a]:text-blue-600
    [&_hr]:border-gray-300
  `

  return (
    <div
      className={cn(
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
        themeStyles,
        className
      )}
      style={{ fontSize: `${fontSize}px` }}
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  )
}
