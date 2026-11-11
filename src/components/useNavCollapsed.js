import { useState } from 'react'

const KEY = 'elevance.nav-collapsed'

/**
 * Whether the side navigation is collapsed to a rail of icons, and a way to
 * flip it. Remembered in the browser, under one key for every Elevance app:
 * they share an origin, so collapsing the navigation in one leaves it
 * collapsed in the next, and switching apps does not rearrange the screen.
 */
export function useNavCollapsed() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(KEY) === '1'
    } catch {
      return false
    }
  })
  const toggle = () =>
    setCollapsed((was) => {
      try {
        window.localStorage.setItem(KEY, was ? '0' : '1')
      } catch {
        // Storage can be refused (private windows); the choice then lasts the visit.
      }
      return !was
    })
  return [collapsed, toggle]
}
