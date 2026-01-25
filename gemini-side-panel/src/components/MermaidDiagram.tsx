import { useEffect, useRef, useState, useCallback } from 'react'
import mermaid from 'mermaid'
import { cn } from '../lib/utils'
import { X, Maximize2, AlertCircle, Copy, Download, Check } from 'lucide-react'

interface MermaidDiagramProps {
  code: string
  theme?: 'light' | 'dark'
}

// Initialize mermaid with default config
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
})

let diagramId = 0

export default function MermaidDiagram({ code, theme = 'dark' }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const idRef = useRef(`mermaid-${diagramId++}`)

  const renderDiagram = useCallback(async () => {
    if (!code.trim()) return

    try {
      // Update mermaid theme based on prop
      mermaid.initialize({
        startOnLoad: false,
        theme: theme === 'dark' ? 'dark' : 'default',
        securityLevel: 'loose',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      })

      // Validate syntax first
      await mermaid.parse(code)

      // Render the diagram
      const { svg: renderedSvg } = await mermaid.render(idRef.current, code)
      setSvg(renderedSvg)
      setError(null)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      setError(errorMessage)
      setSvg('')
    }
  }, [code, theme])

  useEffect(() => {
    renderDiagram()
  }, [renderDiagram])

  const openFullscreenOverlay = async () => {
    if (!svg) return

    try {
      // Get current active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (tab?.id) {
        // Send message to content script to show overlay on main page
        await chrome.tabs.sendMessage(tab.id, {
          action: 'SHOW_MERMAID_OVERLAY',
          svgContent: svg,
        })
        console.log('Mermaid overlay message sent to content script')
      }
    } catch (error) {
      console.error('Failed to show fullscreen overlay:', error)
      // Fallback to in-panel modal if content script communication fails
      setIsModalOpen(true)
    }
  }

  const closeModal = () => {
    setIsModalOpen(false)
  }

  // Copy Mermaid code to clipboard
  const handleCopyCode = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy code:', err)
    }
  }

  // Download SVG as image
  const handleDownloadImage = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!svg) return

    try {
      // Add background color to SVG for better visibility
      const parser = new DOMParser()
      const doc = parser.parseFromString(svg, 'image/svg+xml')
      const svgElement = doc.querySelector('svg')

      if (svgElement) {
        // Add a background rect
        const bgColor = theme === 'dark' ? '#1f2937' : '#ffffff'

        // Create background rect
        const bgRect = doc.createElementNS('http://www.w3.org/2000/svg', 'rect')
        bgRect.setAttribute('width', '100%')
        bgRect.setAttribute('height', '100%')
        bgRect.setAttribute('fill', bgColor)

        // Insert at beginning
        svgElement.insertBefore(bgRect, svgElement.firstChild)

        // Serialize back to string
        const serializer = new XMLSerializer()
        const svgWithBg = serializer.serializeToString(doc)

        // Download as SVG
        const blob = new Blob([svgWithBg], { type: 'image/svg+xml;charset=utf-8' })
        const url = URL.createObjectURL(blob)

        const link = document.createElement('a')
        link.download = `mermaid-diagram-${Date.now()}.svg`
        link.href = url
        link.click()

        URL.revokeObjectURL(url)
      }
    } catch (err) {
      console.error('Failed to download image:', err)
      // Fallback: download raw SVG
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.download = `mermaid-diagram-${Date.now()}.svg`
      link.href = url
      link.click()
      URL.revokeObjectURL(url)
    }
  }

  // Handle escape key to close modal (fallback only)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen) {
        closeModal()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isModalOpen])

  if (error) {
    return (
      <div
        className={cn(
          'my-3 p-4 rounded-lg border',
          theme === 'dark'
            ? 'bg-red-900/30 border-red-700 text-red-300'
            : 'bg-red-50 border-red-300 text-red-700'
        )}
      >
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold mb-1">Mermaid Syntax Error</div>
            <pre className="text-sm whitespace-pre-wrap break-words font-mono overflow-x-auto">
              {error}
            </pre>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm opacity-70 hover:opacity-100">
                Show source code
              </summary>
              <pre
                className={cn(
                  'mt-2 p-2 rounded text-xs font-mono overflow-x-auto',
                  theme === 'dark' ? 'bg-gray-800' : 'bg-gray-100'
                )}
              >
                {code}
              </pre>
            </details>
          </div>
        </div>
      </div>
    )
  }

  if (!svg) {
    return (
      <div
        className={cn(
          'my-3 p-4 rounded-lg animate-pulse',
          theme === 'dark' ? 'bg-gray-800' : 'bg-gray-200'
        )}
      >
        <div className="h-32 flex items-center justify-center text-sm opacity-50">
          Rendering diagram...
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Inline diagram with click to expand */}
      <div
        ref={containerRef}
        onClick={openFullscreenOverlay}
        className={cn(
          'my-3 p-4 rounded-lg cursor-pointer group relative transition-all',
          theme === 'dark'
            ? 'bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-gray-600'
            : 'bg-gray-100 hover:bg-gray-200 border border-gray-300 hover:border-gray-400'
        )}
      >
        {/* Action buttons */}
        <div
          className={cn(
            'absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity'
          )}
        >
          {/* Copy code button */}
          <button
            onClick={handleCopyCode}
            title="Copy Mermaid code"
            className={cn(
              'p-1.5 rounded transition-colors',
              theme === 'dark'
                ? 'bg-gray-700 hover:bg-gray-600'
                : 'bg-gray-300 hover:bg-gray-400'
            )}
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-500" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>

          {/* Download image button */}
          <button
            onClick={handleDownloadImage}
            title="Download as PNG"
            className={cn(
              'p-1.5 rounded transition-colors',
              theme === 'dark'
                ? 'bg-gray-700 hover:bg-gray-600'
                : 'bg-gray-300 hover:bg-gray-400'
            )}
          >
            <Download className="w-4 h-4" />
          </button>

          {/* Expand button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              openFullscreenOverlay()
            }}
            title="Expand"
            className={cn(
              'p-1.5 rounded transition-colors',
              theme === 'dark'
                ? 'bg-gray-700 hover:bg-gray-600'
                : 'bg-gray-300 hover:bg-gray-400'
            )}
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>

        {/* SVG container */}
        <div
          className="overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      {/* Fullscreen modal */}
      {isModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={closeModal}
        >
          {/* Close button */}
          <button
            onClick={closeModal}
            className={cn(
              'absolute top-4 right-4 p-2 rounded-full transition-colors',
              'bg-gray-800 hover:bg-gray-700 text-white'
            )}
          >
            <X className="w-6 h-6" />
          </button>

          {/* Modal content */}
          <div
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'max-w-[95vw] max-h-[95vh] overflow-auto p-6 rounded-xl',
              theme === 'dark' ? 'bg-gray-900' : 'bg-white'
            )}
          >
            <div
              className="[&_svg]:max-w-full [&_svg]:h-auto"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      )}
    </>
  )
}
