// Native input via Chrome DevTools Protocol.
// React/Gmail/X.com reject isTrusted:false synthetic events, so CDP is required
// to emit genuine user-level input events.

interface KeyInfo {
  key: string
  code: string
  windowsVirtualKeyCode: number
}

interface RuntimeEvaluateResult {
  result?: {
    value?: unknown
    type?: string
    subtype?: string
    description?: string
  }
  exceptionDetails?: {
    text?: string
    exception?: {
      description?: string
      value?: unknown
    }
    lineNumber?: number
    columnNumber?: number
  }
}

export interface RunJsOutcome {
  success: boolean
  value?: unknown
  valuePreview?: string
  valueByteSize?: number
  type?: string
  truncated?: boolean
  error?: string
  durationMs: number
}

interface ElementRect {
  x: number
  y: number
  width: number
  height: number
}

export interface NativeClickOptions {
  button?: 'left' | 'right' | 'middle'
  offsetX?: number
  offsetY?: number
}

export interface NativeScrollOptions {
  behavior?: 'auto' | 'smooth'
  block?: 'start' | 'center' | 'end' | 'nearest'
}

export interface ScrollPosition {
  x: number
  y: number
  maxX: number
  maxY: number
}

export interface ScrollToBottomInfo extends ScrollPosition {
  scrollHeight: number
  iterations: number
}

export interface FoundElementInfoRaw {
  index: number
  text: string
  visible: boolean
  rect: { x: number; y: number; width: number; height: number }
  tagName: string
  href?: string
  ariaLabel?: string
}

export interface LinkInfoRaw {
  text: string
  href: string
  title?: string
  ariaLabel?: string
}

// Shared visibility predicate injected into page-side evaluation.
// Mirrors the logic used by getElementCoordinates so behavior stays consistent.
const VISIBILITY_HELPER_JS = `
  const __isVisible = (el) => {
    if (!el || !(el instanceof Element)) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    const rr = el.getBoundingClientRect();
    return rr.width > 0 && rr.height > 0;
  };
`

const CDP_VERSION = '1.3'
const DOUBLE_CLICK_DELAY_MS = 100

const MODIFIER_ALT = 1
const MODIFIER_CTRL = 2
const MODIFIER_META = 4
const MODIFIER_SHIFT = 8

export class NativeInputHandler {
  private modifiers = 0

  async click(tabId: number, selector: string, options?: NativeClickOptions): Promise<void> {
    try {
      await this.attachDebugger(tabId)

      const rect = await this.getElementCoordinates(tabId, selector)
      if (!rect) throw new Error(`Element not found: ${selector}`)

      const x = rect.x + (options?.offsetX ?? rect.width / 2)
      const y = rect.y + (options?.offsetY ?? rect.height / 2)
      const button = options?.button ?? 'left'

      await this.cdpSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
        button: 'none',
      })
      await this.cdpSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button,
        clickCount: 1,
      })
      await this.cdpSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button,
        clickCount: 1,
      })
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async doubleClick(tabId: number, selector: string): Promise<void> {
    try {
      await this.attachDebugger(tabId)

      const rect = await this.getElementCoordinates(tabId, selector)
      if (!rect) throw new Error(`Element not found: ${selector}`)

      const x = rect.x + rect.width / 2
      const y = rect.y + rect.height / 2

      await this.cdpSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1,
      })
      await this.cdpSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1,
      })

      await this.sleep(DOUBLE_CLICK_DELAY_MS)

      await this.cdpSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 2,
      })
      await this.cdpSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 2,
      })
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async rightClick(tabId: number, selector: string): Promise<void> {
    try {
      await this.attachDebugger(tabId)

      const rect = await this.getElementCoordinates(tabId, selector)
      if (!rect) throw new Error(`Element not found: ${selector}`)

      const x = rect.x + rect.width / 2
      const y = rect.y + rect.height / 2

      await this.cdpSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'right',
        clickCount: 1,
      })
      await this.cdpSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'right',
        clickCount: 1,
      })
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async hover(tabId: number, selector: string): Promise<void> {
    try {
      await this.attachDebugger(tabId)

      const rect = await this.getElementCoordinates(tabId, selector)
      if (!rect) throw new Error(`Element not found: ${selector}`)

      const x = rect.x + rect.width / 2
      const y = rect.y + rect.height / 2

      await this.cdpSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
      })
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async focus(tabId: number, selector: string): Promise<void> {
    try {
      await this.attachDebugger(tabId)

      const result = (await this.cdpSend(tabId, 'Runtime.evaluate', {
        expression: `
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (el && typeof el.focus === 'function') {
              el.focus();
              el.scrollIntoView({ block: 'nearest' });
              return true;
            }
            return false;
          })()
        `,
        returnByValue: true,
      })) as RuntimeEvaluateResult

      if (result.result?.value !== true) {
        throw new Error(`Element not found or not focusable: ${selector}`)
      }
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async blur(tabId: number, selector?: string): Promise<void> {
    try {
      await this.attachDebugger(tabId)

      const expression = selector
        ? `
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (el && typeof el.blur === 'function') {
              el.blur();
              return true;
            }
            return false;
          })()
        `
        : `
          (() => {
            const el = document.activeElement;
            if (el && typeof el.blur === 'function') {
              el.blur();
              return true;
            }
            return false;
          })()
        `

      const result = (await this.cdpSend(tabId, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
      })) as RuntimeEvaluateResult

      if (result.result?.value !== true) {
        throw new Error(selector ? `Element not found: ${selector}` : 'No active element to blur')
      }
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async scroll(tabId: number, selector: string, options?: NativeScrollOptions): Promise<void> {
    try {
      await this.attachDebugger(tabId)

      const behavior = JSON.stringify(options?.behavior ?? 'auto')
      const block = JSON.stringify(options?.block ?? 'nearest')

      const result = (await this.cdpSend(tabId, 'Runtime.evaluate', {
        expression: `
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (el) {
              el.scrollIntoView({ behavior: ${behavior}, block: ${block} });
              return true;
            }
            return false;
          })()
        `,
        returnByValue: true,
      })) as RuntimeEvaluateResult

      if (result.result?.value !== true) {
        throw new Error(`Element not found: ${selector}`)
      }
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async selectText(tabId: number, selector: string, start?: number, end?: number): Promise<void> {
    try {
      await this.attachDebugger(tabId)

      if (start !== undefined && end !== undefined) {
        const result = (await this.cdpSend(tabId, 'Runtime.evaluate', {
          expression: `
            (() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (el && typeof el.setSelectionRange === 'function') {
                el.focus();
                el.setSelectionRange(${start}, ${end});
                return true;
              }
              return false;
            })()
          `,
          returnByValue: true,
        })) as RuntimeEvaluateResult

        if (result.result?.value !== true) {
          throw new Error(`Element does not support setSelectionRange: ${selector}`)
        }
      } else {
        const result = (await this.cdpSend(tabId, 'Runtime.evaluate', {
          expression: `
            (() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return false;

              if (typeof el.setSelectionRange === 'function') {
                el.focus();
                const len = (el.value || '').length;
                el.setSelectionRange(0, len);
                return true;
              }

              const selection = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(el);
              if (selection) {
                selection.removeAllRanges();
                selection.addRange(range);
              }
              return true;
            })()
          `,
          returnByValue: true,
        })) as RuntimeEvaluateResult

        if (result.result?.value !== true) {
          throw new Error(`Failed to select text: ${selector}`)
        }
      }
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async type(tabId: number, selector: string, text: string): Promise<void> {
    try {
      await this.attachDebugger(tabId)

      const focusResult = (await this.cdpSend(tabId, 'Runtime.evaluate', {
        expression: `
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (el && typeof el.focus === 'function') {
              el.focus();
              el.scrollIntoView({ block: 'nearest' });
              return true;
            }
            return false;
          })()
        `,
        returnByValue: true,
      })) as RuntimeEvaluateResult

      if (focusResult.result?.value !== true) {
        throw new Error(`Element not found or not focusable: ${selector}`)
      }

      // SiteSurf-style per-character input: keyDown with text param, then keyUp.
      // text on keyDown lets React/IME frameworks observe proper characters (incl. JP).
      for (const char of text) {
        await this.cdpSend(tabId, 'Input.dispatchKeyEvent', {
          type: 'keyDown',
          text: char,
        })
        await this.cdpSend(tabId, 'Input.dispatchKeyEvent', {
          type: 'keyUp',
        })
      }

      // Ensure frameworks relying on input/change events see the change.
      await this.cdpSend(tabId, 'Runtime.evaluate', {
        expression: `
          (() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          })()
        `,
      })
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async press(tabId: number, key: string, selector?: string): Promise<void> {
    try {
      await this.attachDebugger(tabId)
      const keyInfo = this.getKeyInfo(key)

      // fill_element detaches the debugger on completion which drops focus;
      // re-focus here if the caller points at the intended target (otherwise
      // keys land on <body> and form submission silently no-ops).
      if (selector) {
        await this.cdpSend(tabId, 'Runtime.evaluate', {
          expression: `
            (() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (el && typeof el.focus === 'function') { el.focus(); return true; }
              return false;
            })()
          `,
          returnByValue: true,
        })
      }

      if (this.isModifierKey(key)) this.updateModifierState(key, true)
      await this.dispatchKey(tabId, keyInfo, true)
      await this.dispatchKey(tabId, keyInfo, false)
      if (this.isModifierKey(key)) this.updateModifierState(key, false)
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async keyDown(tabId: number, key: string): Promise<void> {
    try {
      await this.attachDebugger(tabId)
      const keyInfo = this.getKeyInfo(key)
      if (this.isModifierKey(key)) this.updateModifierState(key, true)
      await this.dispatchKey(tabId, keyInfo, true)
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async keyUp(tabId: number, key: string): Promise<void> {
    try {
      await this.attachDebugger(tabId)
      const keyInfo = this.getKeyInfo(key)
      await this.dispatchKey(tabId, keyInfo, false)
      if (this.isModifierKey(key)) this.updateModifierState(key, false)
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  /**
   * Send a key combination such as Ctrl+S / Cmd+A.
   * Sequence: press all modifier keyDown → main keyDown → main keyUp → modifier keyUp.
   */
  async pressKeyCombination(tabId: number, keys: string[]): Promise<void> {
    if (keys.length === 0) throw new Error('keys must not be empty')

    try {
      await this.attachDebugger(tabId)

      const modifiers = keys.filter((k) => this.isModifierKey(k))
      const nonModifiers = keys.filter((k) => !this.isModifierKey(k))
      if (nonModifiers.length > 1) {
        throw new Error('At most one non-modifier key is allowed in a combination')
      }

      // Modifier keyDowns
      for (const mod of modifiers) {
        this.updateModifierState(mod, true)
        await this.dispatchKey(tabId, this.getKeyInfo(mod), true)
      }

      // Main key
      if (nonModifiers.length === 1) {
        const info = this.getKeyInfo(nonModifiers[0])
        await this.dispatchKey(tabId, info, true)
        await this.dispatchKey(tabId, info, false)
      }

      // Modifier keyUps (reverse order)
      for (const mod of modifiers.slice().reverse()) {
        await this.dispatchKey(tabId, this.getKeyInfo(mod), false)
        this.updateModifierState(mod, false)
      }
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async waitForElement(tabId: number, selector: string, timeoutMs = 5000): Promise<number> {
    const cappedTimeout = Math.max(0, Math.min(timeoutMs, 60_000))
    const pollIntervalMs = 200
    const startedAt = Date.now()
    const deadline = startedAt + cappedTimeout

    try {
      await this.attachDebugger(tabId)

      while (true) {
        const result = (await this.cdpSend(tabId, 'Runtime.evaluate', {
          expression: `
            (() => {
              ${VISIBILITY_HELPER_JS}
              const nodes = document.querySelectorAll(${JSON.stringify(selector)});
              for (const el of nodes) {
                if (__isVisible(el)) return true;
              }
              return false;
            })()
          `,
          returnByValue: true,
        })) as RuntimeEvaluateResult

        if (result.result?.value === true) {
          return Date.now() - startedAt
        }

        if (Date.now() >= deadline) {
          throw new Error(
            `Timeout waiting for visible element after ${cappedTimeout}ms: ${selector}`
          )
        }

        await this.sleep(pollIntervalMs)
      }
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async scrollBy(tabId: number, dx: number, dy: number): Promise<ScrollPosition> {
    try {
      await this.attachDebugger(tabId)

      const centerX = 100
      const centerY = 100

      await this.cdpSend(tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: centerX,
        y: centerY,
        deltaX: dx,
        deltaY: dy,
      })

      return await this.getScrollPositionInternal(tabId)
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async scrollToBottom(tabId: number, behavior: 'auto' | 'smooth' = 'auto'): Promise<ScrollToBottomInfo> {
    try {
      await this.attachDebugger(tabId)

      const behaviorJson = JSON.stringify(behavior)
      let lastHeight = -1
      let iterations = 0
      const maxIterations = 3

      for (let i = 0; i < maxIterations; i++) {
        iterations = i + 1
        const result = (await this.cdpSend(tabId, 'Runtime.evaluate', {
          expression: `
            (() => {
              window.scrollTo({ top: document.body.scrollHeight, left: 0, behavior: ${behaviorJson} });
              return document.body.scrollHeight;
            })()
          `,
          returnByValue: true,
        })) as RuntimeEvaluateResult

        const height = typeof result.result?.value === 'number' ? (result.result.value as number) : 0

        await this.sleep(500)

        if (height === lastHeight) break
        lastHeight = height
      }

      const pos = await this.getScrollPositionInternal(tabId)
      const heightResult = (await this.cdpSend(tabId, 'Runtime.evaluate', {
        expression: 'document.body.scrollHeight',
        returnByValue: true,
      })) as RuntimeEvaluateResult
      const scrollHeight =
        typeof heightResult.result?.value === 'number' ? (heightResult.result.value as number) : 0

      return { ...pos, scrollHeight, iterations }
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async scrollToTop(tabId: number, behavior: 'auto' | 'smooth' = 'auto'): Promise<ScrollPosition> {
    try {
      await this.attachDebugger(tabId)
      const behaviorJson = JSON.stringify(behavior)

      await this.cdpSend(tabId, 'Runtime.evaluate', {
        expression: `window.scrollTo({ top: 0, left: 0, behavior: ${behaviorJson} })`,
      })

      return await this.getScrollPositionInternal(tabId)
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async getScrollPosition(tabId: number): Promise<ScrollPosition> {
    try {
      await this.attachDebugger(tabId)
      return await this.getScrollPositionInternal(tabId)
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async getText(tabId: number, selector: string): Promise<string> {
    try {
      await this.attachDebugger(tabId)

      const result = (await this.cdpSend(tabId, 'Runtime.evaluate', {
        expression: `
          (() => {
            ${VISIBILITY_HELPER_JS}
            const nodes = document.querySelectorAll(${JSON.stringify(selector)});
            for (const el of nodes) {
              if (__isVisible(el)) {
                const text = (el.textContent || '').trim();
                return { found: true, text: text.slice(0, 5000) };
              }
            }
            return { found: false, count: nodes.length };
          })()
        `,
        returnByValue: true,
      })) as RuntimeEvaluateResult

      const value = result.result?.value as
        | { found: true; text: string }
        | { found: false; count: number }
        | undefined

      if (!value) throw new Error(`Failed to evaluate: ${selector}`)
      if (!value.found) {
        throw new Error(
          `No visible element found for selector: ${selector} (matched ${value.count} node(s))`
        )
      }
      return value.text
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async getAttribute(tabId: number, selector: string, name: string): Promise<string | null> {
    try {
      await this.attachDebugger(tabId)

      const result = (await this.cdpSend(tabId, 'Runtime.evaluate', {
        expression: `
          (() => {
            ${VISIBILITY_HELPER_JS}
            const nodes = document.querySelectorAll(${JSON.stringify(selector)});
            for (const el of nodes) {
              if (__isVisible(el)) {
                const v = el.getAttribute(${JSON.stringify(name)});
                return { found: true, value: v };
              }
            }
            return { found: false, count: nodes.length };
          })()
        `,
        returnByValue: true,
      })) as RuntimeEvaluateResult

      const value = result.result?.value as
        | { found: true; value: string | null }
        | { found: false; count: number }
        | undefined

      if (!value) throw new Error(`Failed to evaluate: ${selector}`)
      if (!value.found) {
        throw new Error(
          `No visible element found for selector: ${selector} (matched ${value.count} node(s))`
        )
      }
      return value.value
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async findElements(
    tabId: number,
    selector: string,
    limit = 20
  ): Promise<FoundElementInfoRaw[]> {
    try {
      await this.attachDebugger(tabId)
      const cappedLimit = Math.max(1, Math.min(limit, 200))

      const result = (await this.cdpSend(tabId, 'Runtime.evaluate', {
        expression: `
          (() => {
            ${VISIBILITY_HELPER_JS}
            const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
            const limited = nodes.slice(0, ${cappedLimit});
            return limited.map((el, index) => {
              const r = el.getBoundingClientRect();
              const text = (el.textContent || '').trim().slice(0, 200);
              const info = {
                index,
                text,
                visible: __isVisible(el),
                rect: { x: r.x, y: r.y, width: r.width, height: r.height },
                tagName: el.tagName.toLowerCase(),
              };
              const href = el.getAttribute('href');
              if (href) info.href = href;
              const aria = el.getAttribute('aria-label');
              if (aria) info.ariaLabel = aria;
              return info;
            });
          })()
        `,
        returnByValue: true,
      })) as RuntimeEvaluateResult

      const value = result.result?.value
      if (!Array.isArray(value)) return []
      return value as FoundElementInfoRaw[]
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async getAllLinks(tabId: number, filterSelector?: string): Promise<LinkInfoRaw[]> {
    try {
      await this.attachDebugger(tabId)
      const sel = filterSelector ?? 'a'

      const result = (await this.cdpSend(tabId, 'Runtime.evaluate', {
        expression: `
          (() => {
            ${VISIBILITY_HELPER_JS}
            const nodes = Array.from(document.querySelectorAll(${JSON.stringify(sel)}));
            const links = [];
            for (const el of nodes) {
              if (!__isVisible(el)) continue;
              const href = (el.getAttribute('href') || el.href || '').toString();
              if (!href) continue;
              const text = (el.textContent || '').trim().slice(0, 200);
              const link = { text, href };
              const title = el.getAttribute('title');
              if (title) link.title = title;
              const aria = el.getAttribute('aria-label');
              if (aria) link.ariaLabel = aria;
              links.push(link);
              if (links.length >= 50) break;
            }
            return links;
          })()
        `,
        returnByValue: true,
      })) as RuntimeEvaluateResult

      const value = result.result?.value
      if (!Array.isArray(value)) return []
      return value as LinkInfoRaw[]
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  async wait(ms: number): Promise<number> {
    const capped = Math.max(0, Math.min(ms, 10_000))
    await this.sleep(capped)
    return capped
  }

  /**
   * Run arbitrary JS in the active tab via CDP Runtime.evaluate.
   * Code is wrapped in an async IIFE so `return` and top-level `await` both
   * work. The result is returned by value (JSON-serialized through CDP) and
   * any thrown exception is surfaced in `error`. The serialized value is
   * capped at 100KB; when over that the preview is truncated and the
   * `truncated` flag is set. A dual timeout (CDP-side + JS-side) protects
   * against runaway scripts.
   */
  async runJs(tabId: number, code: string, timeoutMs = 10_000): Promise<RunJsOutcome> {
    const cappedTimeout = Math.max(100, Math.min(timeoutMs, 30_000))
    const MAX_BYTES = 100 * 1024
    const startedAt = Date.now()
    try {
      await this.attachDebugger(tabId)
      const wrappedCode = `(async () => { ${code}\n})()`

      const evalPromise = this.cdpSend(tabId, 'Runtime.evaluate', {
        expression: wrappedCode,
        returnByValue: true,
        awaitPromise: true,
        timeout: cappedTimeout,
        userGesture: true,
      }) as Promise<RuntimeEvaluateResult>

      // Extra JS-side guard: CDP `timeout` should be honored by the browser,
      // but we add a small buffer (+500ms) setTimeout so a misbehaving CDP
      // evaluation cannot stall the extension indefinitely.
      const guardPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`run_js timed out after ${cappedTimeout}ms`))
        }, cappedTimeout + 500)
      })

      const result = (await Promise.race([evalPromise, guardPromise])) as RuntimeEvaluateResult

      if (result.exceptionDetails) {
        const ex = result.exceptionDetails
        const errText =
          ex.exception?.description ??
          (typeof ex.exception?.value === 'string' ? ex.exception.value : undefined) ??
          ex.text ??
          'Unknown JavaScript exception'
        return {
          success: false,
          error: errText,
          durationMs: Date.now() - startedAt,
        }
      }

      const rawValue = result.result?.value
      const type =
        result.result?.subtype ??
        result.result?.type ??
        (rawValue === null ? 'null' : typeof rawValue)

      // Serialize defensively: try JSON.stringify with a two-arg fallback for
      // circular structures / functions / symbols. If everything fails, use
      // String(v) so the model still sees something.
      let serialized: string
      try {
        serialized = JSON.stringify(rawValue, null, 2) ?? 'undefined'
      } catch {
        try {
          serialized = String(rawValue)
        } catch {
          serialized = '<unserializable>'
        }
      }

      const byteSize = serialized.length
      const truncated = byteSize > MAX_BYTES
      const bodyForPreview = truncated ? serialized.slice(0, MAX_BYTES) : serialized
      const valuePreview = bodyForPreview.slice(0, 200)

      // When truncated, drop the full value to avoid blowing the tool-result
      // payload — keep only the preview + size info.
      const returnValue = truncated ? undefined : rawValue

      return {
        success: true,
        value: returnValue,
        valuePreview,
        valueByteSize: byteSize,
        type,
        truncated,
        durationMs: Date.now() - startedAt,
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      }
    } finally {
      await this.detachDebugger(tabId)
    }
  }

  private async getScrollPositionInternal(tabId: number): Promise<ScrollPosition> {
    const result = (await this.cdpSend(tabId, 'Runtime.evaluate', {
      expression: `
        (() => ({
          x: window.scrollX,
          y: window.scrollY,
          maxX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
          maxY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
        }))()
      `,
      returnByValue: true,
    })) as RuntimeEvaluateResult

    const value = result.result?.value as ScrollPosition | undefined
    if (!value) throw new Error('Failed to read scroll position')
    return value
  }

  private async attachDebugger(tabId: number): Promise<void> {
    try {
      await chrome.debugger.attach({ tabId }, CDP_VERSION)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('already attached')) return
      throw err instanceof Error ? err : new Error(message)
    }
  }

  private async detachDebugger(tabId: number): Promise<void> {
    try {
      await chrome.debugger.detach({ tabId })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('not attached')) return
      // Intentionally swallow detach errors so action success is not masked.
    }
  }

  private async cdpSend<T = unknown>(
    tabId: number,
    method: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params ?? {}, (result) => {
        const err = chrome.runtime.lastError
        if (err) {
          reject(new Error(err.message || `CDP ${method} failed`))
        } else {
          resolve(result as T)
        }
      })
    })
  }

  private async getElementCoordinates(tabId: number, selector: string): Promise<ElementRect | null> {
    // CDP dispatchMouseEvent expects viewport coords; do NOT add scrollX/Y.
    // Pick the first *visible* match to avoid hitting hidden duplicate elements
    // (e.g. Zenn has 2 "いいね" buttons where [0] is display:none at 0x0).
    const expression = `
      (() => {
        const nodes = document.querySelectorAll(${JSON.stringify(selector)});
        if (nodes.length === 0) return null;
        const isVisible = (el) => {
          if (!el || !(el instanceof Element)) return false;
          if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
          const rr = el.getBoundingClientRect();
          return rr.width > 0 && rr.height > 0;
        };
        let target = null;
        for (const el of nodes) {
          if (isVisible(el)) { target = el; break; }
        }
        if (!target) return { notVisible: true, count: nodes.length };
        target.scrollIntoView({ block: 'center', inline: 'center' });
        const r = target.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, count: nodes.length };
      })()
    `
    const result = (await this.cdpSend(tabId, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
    })) as RuntimeEvaluateResult

    const value = result.result?.value
    if (!value || typeof value !== 'object') return null
    const v = value as { notVisible?: boolean; count?: number; x?: number; y?: number; width?: number; height?: number }
    if (v.notVisible) {
      throw new Error(
        `Element is not visible (matched ${v.count ?? '?'} node(s) but all hidden / zero-sized): ${selector}`
      )
    }
    if (typeof v.x !== 'number' || typeof v.y !== 'number') return null
    if ((v.width ?? 0) <= 0 || (v.height ?? 0) <= 0) {
      throw new Error(`Element has zero size: ${selector}`)
    }
    return { x: v.x, y: v.y, width: v.width ?? 0, height: v.height ?? 0 }
  }

  private async dispatchKey(tabId: number, keyInfo: KeyInfo, isDown: boolean): Promise<void> {
    await this.cdpSend(tabId, 'Input.dispatchKeyEvent', {
      type: isDown ? 'keyDown' : 'keyUp',
      key: keyInfo.key,
      code: keyInfo.code,
      windowsVirtualKeyCode: keyInfo.windowsVirtualKeyCode,
      nativeVirtualKeyCode: keyInfo.windowsVirtualKeyCode,
      modifiers: this.modifiers,
    })
  }

  private isModifierKey(key: string): boolean {
    return key === 'Alt' || key === 'Control' || key === 'Meta' || key === 'Shift'
  }

  private updateModifierState(key: string, isDown: boolean): void {
    const bit = this.getModifierBit(key)
    if (bit === 0) return
    if (isDown) this.modifiers |= bit
    else this.modifiers &= ~bit
  }

  private getModifierBit(key: string): number {
    switch (key) {
      case 'Alt':
        return MODIFIER_ALT
      case 'Control':
        return MODIFIER_CTRL
      case 'Meta':
        return MODIFIER_META
      case 'Shift':
        return MODIFIER_SHIFT
      default:
        return 0
    }
  }

  private getKeyInfo(key: string): KeyInfo {
    const keyMap: Record<string, KeyInfo> = {
      Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
      Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
      Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
      Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
      Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
      Insert: { key: 'Insert', code: 'Insert', windowsVirtualKeyCode: 45 },
      Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
      End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
      PageUp: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
      PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },

      ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
      ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
      ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
      ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },

      Alt: { key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 },
      Control: { key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 },
      Shift: { key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 },
      Meta: { key: 'Meta', code: 'MetaLeft', windowsVirtualKeyCode: 91 },

      Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },

      F1: { key: 'F1', code: 'F1', windowsVirtualKeyCode: 112 },
      F2: { key: 'F2', code: 'F2', windowsVirtualKeyCode: 113 },
      F3: { key: 'F3', code: 'F3', windowsVirtualKeyCode: 114 },
      F4: { key: 'F4', code: 'F4', windowsVirtualKeyCode: 115 },
      F5: { key: 'F5', code: 'F5', windowsVirtualKeyCode: 116 },
      F6: { key: 'F6', code: 'F6', windowsVirtualKeyCode: 117 },
      F7: { key: 'F7', code: 'F7', windowsVirtualKeyCode: 118 },
      F8: { key: 'F8', code: 'F8', windowsVirtualKeyCode: 119 },
      F9: { key: 'F9', code: 'F9', windowsVirtualKeyCode: 120 },
      F10: { key: 'F10', code: 'F10', windowsVirtualKeyCode: 121 },
      F11: { key: 'F11', code: 'F11', windowsVirtualKeyCode: 122 },
      F12: { key: 'F12', code: 'F12', windowsVirtualKeyCode: 123 },
    }

    if (key.length === 1) {
      const upper = key.toUpperCase()
      const isLetter = upper >= 'A' && upper <= 'Z'
      const isDigit = key >= '0' && key <= '9'
      if (isLetter) {
        return {
          key,
          code: `Key${upper}`,
          windowsVirtualKeyCode: upper.charCodeAt(0),
        }
      }
      if (isDigit) {
        return {
          key,
          code: `Digit${key}`,
          windowsVirtualKeyCode: key.charCodeAt(0),
        }
      }
    }

    const mapped = keyMap[key]
    if (mapped) return mapped
    throw new Error(`Unknown key: ${key}`)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export const nativeInputHandler = new NativeInputHandler()
