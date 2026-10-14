/**
 * Rich text for customer email, as a small document rather than as HTML.
 *
 * The email box is a contentEditable, and what a contentEditable holds is
 * whatever HTML the browser, a paste or an extension put there. None of that
 * leaves the browser. It is read into the document below — paragraphs and
 * lists of runs of text, each run optionally bold, italic, underlined or a
 * link — and that is what is sent, stored and drawn. Anything the document
 * cannot say (colours, fonts, images, scripts, styles) simply does not survive
 * the reading.
 *
 *   { blocks: [
 *       { type: 'p',  runs: [{ text, b?, i?, u?, href? }, …] },
 *       { type: 'ul' | 'ol', items: [[run, …], …] },
 *   ] }
 *
 * A paragraph is one line as typed: Enter starts a new one, and an empty one
 * is a blank line. A run's text may carry '\n' for a soft line break.
 *
 * `normalizeDoc` and `docToHtml` are mirrored in `email-send`, which checks the
 * document again and builds the email's HTML from it — a Deno function cannot
 * import from src/. Uses the DOM API (no React, no Supabase), so it runs under
 * jsdom in tests.
 */

/** Caps that keep one email a sensible size. Mirrored in `email-send`. */
export const MAX_BLOCKS = 500
export const MAX_TEXT = 50_000

const SAFE_HREF = /^(https?:\/\/|mailto:)/i

/** A link target the email may carry: http(s) or mailto, nothing else. */
export const safeHref = (href) => {
  const h = String(href ?? '').trim()
  return SAFE_HREF.test(h) && !/[\s<>"]/.test(h) ? h : null
}

const MARKS = ['b', 'i', 'u']
const sameMarks = (a, b) =>
  MARKS.every((m) => Boolean(a[m]) === Boolean(b[m])) && (a.href ?? null) === (b.href ?? null)

/** Joins neighbouring runs that look the same, and drops empty ones. */
function mergeRuns(runs) {
  const out = []
  for (const r of runs) {
    if (!r.text) continue
    const last = out[out.length - 1]
    if (last && sameMarks(last, r)) last.text += r.text
    else out.push({ ...r })
  }
  return out
}

/** A run's text stripped of leading (or trailing) spaces across the whole line. */
function trimRuns(runs) {
  const out = runs.map((r) => ({ ...r }))
  while (out.length && !(out[0].text = out[0].text.replace(/^ +/, ''))) out.shift()
  while (out.length && !(out[out.length - 1].text = out[out.length - 1].text.replace(/ +$/, ''))) out.pop()
  return out
}

const isBlankRuns = (runs) => runs.every((r) => !r.text.trim())

/**
 * Checks a document that came from somewhere else — the browser, or the
 * database — and returns one that holds only what the format allows. Unknown
 * block types, unknown marks and unsafe links are dropped, not rejected: the
 * text is what matters, and it is kept.
 */
export function normalizeDoc(input) {
  const blocks = []
  let budget = MAX_TEXT
  const runsOf = (list) => mergeRuns((Array.isArray(list) ? list : []).map((r) => {
    let text = typeof r?.text === 'string' ? r.text.replace(/\r\n?/g, '\n') : ''
    if (text.length > budget) text = text.slice(0, budget)
    budget -= text.length
    const run = { text }
    for (const m of MARKS) if (r?.[m] === true) run[m] = true
    const href = safeHref(r?.href)
    if (href) run.href = href
    return run
  }))
  for (const b of Array.isArray(input?.blocks) ? input.blocks : []) {
    if (blocks.length >= MAX_BLOCKS || budget <= 0) break
    if (b?.type === 'p') blocks.push({ type: 'p', runs: runsOf(b.runs) })
    else if (b?.type === 'ul' || b?.type === 'ol') {
      const items = (Array.isArray(b.items) ? b.items : []).map(runsOf).filter((r) => !isBlankRuns(r))
      if (items.length) blocks.push({ type: b.type, items })
    }
  }
  // Blank lines at either end are the composer's leftovers, not the author's.
  while (blocks.length && blocks[0].type === 'p' && isBlankRuns(blocks[0].runs)) blocks.shift()
  while (blocks.length && blocks.at(-1).type === 'p' && isBlankRuns(blocks.at(-1).runs)) blocks.pop()
  return { blocks }
}

/** Nothing but blank lines. */
export const isEmptyDoc = (doc) =>
  !(doc?.blocks ?? []).some((b) =>
    b.type === 'p' ? !isBlankRuns(b.runs) : (b.items ?? []).some((it) => !isBlankRuns(it)))

/** Plain text, one paragraph per line — what a plain-text paste becomes. */
export const docFromText = (text) => normalizeDoc({
  blocks: String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
    .map((line) => ({ type: 'p', runs: [{ text: line }] })),
})

const runText = (r) => (r.href && r.href !== r.text && r.href !== `mailto:${r.text}`
  ? `${r.text} (${r.href.replace(/^mailto:/i, '')})` : r.text)

/**
 * The plain-text version of the email: what a mail app without HTML shows, and
 * what the thread falls back to. Lists keep their bullets and numbers, and a
 * link keeps its address beside its words.
 */
export function docToText(doc) {
  const lines = []
  for (const b of doc?.blocks ?? []) {
    if (b.type === 'p') lines.push(b.runs.map(runText).join(''))
    else b.items.forEach((item, n) =>
      lines.push(`${b.type === 'ol' ? `${n + 1}.` : '•'} ${item.map(runText).join('')}`))
  }
  return lines.join('\n')
}

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function runsToHtml(runs) {
  return runs.map((r) => {
    let html = escapeHtml(r.text).replace(/\n/g, '<br>')
    if (r.b) html = `<strong>${html}</strong>`
    if (r.i) html = `<em>${html}</em>`
    if (r.u) html = `<u>${html}</u>`
    if (r.href) html = `<a href="${escapeHtml(r.href)}">${html}</a>`
    return html
  }).join('')
}

/**
 * HTML for a document, built from it rather than passed through: every piece
 * of text is escaped, and the only tags are the ones written here. Used to put
 * a cleaned-up paste back into the editor; `email-send` builds the email's HTML
 * the same way, with inline styles mail apps honour.
 */
export function docToHtml(doc) {
  // Normalised first, so a link is re-checked here and not only where the
  // document was made.
  return normalizeDoc(doc).blocks.map((b) => {
    if (b.type === 'p') return `<div>${runsToHtml(b.runs) || '<br>'}</div>`
    const items = b.items.map((it) => `<li>${runsToHtml(it)}</li>`).join('')
    return `<${b.type}>${items}</${b.type}>`
  }).join('')
}

// ---------------------------------------------------------------------------
// Reading the editor

const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SECTION',
  'ARTICLE', 'HEADER', 'FOOTER', 'TABLE', 'TR', 'UL', 'OL', 'LI', 'HR',
])
// Never text: their contents are code, metadata or a picture.
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'IMG', 'svg', 'SVG',
  'IFRAME', 'OBJECT', 'TEMPLATE', 'NOSCRIPT', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'])

/** The marks an element adds to everything inside it — tags, and the inline styles a paste uses. */
function marksOf(el, marks) {
  const next = { ...marks }
  const tag = el.tagName
  const style = el.style ?? {}
  const weight = String(style.fontWeight ?? '')
  if (tag === 'B' || tag === 'STRONG' || weight === 'bold' || Number(weight) >= 600) next.b = true
  if (weight === 'normal' || (weight && Number(weight) > 0 && Number(weight) < 600)) delete next.b
  if (tag === 'I' || tag === 'EM' || style.fontStyle === 'italic') next.i = true
  if (tag === 'U' || /underline/.test(String(style.textDecoration ?? style.textDecorationLine ?? ''))) next.u = true
  if (tag === 'A') {
    const href = safeHref(el.getAttribute('href'))
    if (href) next.href = href
  }
  return next
}

/**
 * Reads a DOM subtree — the editor, or a parsed paste — into a document.
 *
 * Block elements end the line before them and start a new one; everything
 * else contributes runs to the current line. Whitespace in text is collapsed
 * the way a browser would draw it, since real line breaks are elements.
 */
export function docFromDom(root) {
  const blocks = []
  let line = null // runs of the paragraph being read, or null between blocks

  const flush = () => {
    if (line) blocks.push({ type: 'p', runs: trimRuns(mergeRuns(line)) })
    line = null
  }
  const push = (text, marks) => {
    line ??= []
    line.push({ ...marks, text })
  }

  const readList = (el, marks) => {
    flush()
    const items = []
    const readItem = (li) => {
      // An item is one line: nested blocks inside it are joined with breaks,
      // and a nested list's items join this list rather than nesting.
      const runs = []
      const walkItem = (node, m) => {
        for (const child of node.childNodes) {
          if (child.nodeType === 3) runs.push({ ...m, text: collapse(child.nodeValue) })
          else if (child.nodeType === 1 && !SKIP_TAGS.has(child.tagName)) {
            if (child.tagName === 'UL' || child.tagName === 'OL') {
              for (const sub of child.children) if (sub.tagName === 'LI') readItem(sub)
            } else if (child.tagName === 'BR') runs.push({ ...m, text: '\n' })
            else {
              if (BLOCK_TAGS.has(child.tagName) && runs.length) runs.push({ ...m, text: '\n' })
              walkItem(child, marksOf(child, m))
            }
          }
        }
      }
      const at = items.length
      items.push(null)
      walkItem(li, marksOf(li, marks))
      items[at] = trimRuns(mergeRuns(runs)).map((r) => ({ ...r, text: r.text.replace(/\n+$/, '') }))
    }
    for (const child of el.children) {
      if (child.tagName === 'LI') readItem(child)
    }
    const kept = items.filter((it) => it && !isBlankRuns(it))
    if (kept.length) blocks.push({ type: el.tagName === 'OL' ? 'ol' : 'ul', items: kept })
  }

  const walk = (node, marks) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        const text = collapse(child.nodeValue)
        // Whitespace between two blocks is source formatting, not a line.
        if (line || text.trim()) push(text, marks)
        continue
      }
      if (child.nodeType !== 1 || SKIP_TAGS.has(child.tagName)) continue
      const tag = child.tagName
      if (tag === 'UL' || tag === 'OL') readList(child, marks)
      else if (tag === 'BR') {
        // A <br> ends the line it is on; on an empty line it *is* the line.
        line ??= []
        flush()
      } else if (BLOCK_TAGS.has(tag)) {
        flush()
        walk(child, marksOf(child, marks))
        flush()
      } else walk(child, marksOf(child, marks))
    }
  }

  walk(root, {})
  flush()
  return normalizeDoc({ blocks })
}

/** As a browser draws text: runs of whitespace are one space, &nbsp; included. */
const collapse = (text) => String(text ?? '').replace(/[\s ]+/g, ' ')

/** Reads pasted HTML into a document, via an inert parse — nothing in it runs. */
export function docFromHtml(html) {
  const parsed = new DOMParser().parseFromString(String(html ?? ''), 'text/html')
  return docFromDom(parsed.body)
}
