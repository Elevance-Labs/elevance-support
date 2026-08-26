// Minimal browser environment for rendering MUI components under vite-node.
import { JSDOM } from 'jsdom'

export function setupDom(url = 'http://localhost/') {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url })
  const w = dom.window

  global.window = w
  global.document = w.document
  Object.defineProperty(global, 'navigator', { value: w.navigator, configurable: true })
  global.getComputedStyle = w.getComputedStyle
  global.IS_REACT_ACT_ENVIRONMENT = true
  // The project picker remembers its selection here.
  global.localStorage = w.localStorage

  // MUI reaches for these DOM globals directly (focus management, portals, transitions).
  for (const name of [
    'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Node', 'Element',
    'DocumentFragment', 'Event', 'MouseEvent', 'KeyboardEvent', 'DOMRect',
    'MutationObserver', 'ResizeObserver', 'getSelection', 'ShadowRoot',
    'HTMLDivElement', 'HTMLButtonElement', 'DOMParser', 'CustomEvent',
    // MUI's Avatar preloads its src with `new Image()` before showing a photo.
    'Image', 'HTMLImageElement',
  ]) {
    if (w[name] !== undefined) global[name] = w[name]
  }

  global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0)
  global.cancelAnimationFrame = (id) => clearTimeout(id)
  w.requestAnimationFrame = global.requestAnimationFrame
  w.cancelAnimationFrame = global.cancelAnimationFrame

  return dom
}

export function reporter() {
  const state = { fail: 0 }
  return {
    check(name, cond, extra = '') {
      console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' — ' + extra}`)
      if (!cond) state.fail++
    },
    done: () => process.exit(state.fail ? 1 : 0),
  }
}
