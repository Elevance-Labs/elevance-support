import { useEffect, useRef, useState } from 'react'

/**
 * Width of a wrapper element, so an SVG chart can lay itself out in real pixels
 * rather than being scaled by a viewBox — scaling a viewBox stretches the text
 * with the geometry.
 */
export function useContainerWidth(fallback = 640) {
  const ref = useRef(null)
  const [width, setWidth] = useState(fallback)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      if (w > 0) setWidth(w)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, width]
}
