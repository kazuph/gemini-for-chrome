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
  }
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

  async press(tabId: number, key: string): Promise<void> {
    try {
      await this.attachDebugger(tabId)
      const keyInfo = this.getKeyInfo(key)

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
