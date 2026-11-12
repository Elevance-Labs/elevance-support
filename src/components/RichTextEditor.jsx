import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import {
  Box, Divider, IconButton, List, ListItemButton, Paper, Popper, Stack, Tooltip, Typography,
} from '@mui/material'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered'
import InsertLinkIcon from '@mui/icons-material/InsertLink'
import FormatClearIcon from '@mui/icons-material/FormatClear'
import {
  docFromDom, docFromHtml, docToHtml, isEmptyDoc, mentionHtml, normalizeDoc, safeHref, stripMentions,
} from '../lib/richText'
import { matchPeople, mentionQuery, mentionText } from '../lib/mentions'
import { UserOption } from './UserAvatar'
import { MOD_KEY_LABEL } from './composer'

/** Runs a formatting command; false where the browser (or jsdom) has none. */
const exec = (command, value) => {
  try { return document.execCommand?.(command, false, value) ?? false } catch { return false }
}
const isOn = (command) => {
  try { return document.queryCommandState?.(command) ?? false } catch { return false }
}

const TOOLS = [
  { command: 'bold', label: 'Bold', key: 'B', Icon: FormatBoldIcon },
  { command: 'italic', label: 'Italic', key: 'I', Icon: FormatItalicIcon },
  { command: 'underline', label: 'Underline', key: 'U', Icon: FormatUnderlinedIcon },
  { command: 'insertUnorderedList', label: 'Bulleted list', Icon: FormatListBulletedIcon },
  { command: 'insertOrderedList', label: 'Numbered list', Icon: FormatListNumberedIcon },
]

/**
 * A rich text box: bold, italic, underline, lists and links — what a support
 * email or a comment needs, and nothing a mail app might draw differently.
 *
 * What it holds is read into a document (`lib/richText.js`) on every change,
 * and that document is all `onChange` ever hands out — the editor's HTML never
 * leaves it. A paste goes through the same reading before it lands, so text
 * copied from a web page or a Word file keeps its bold and its links and loses
 * everything else.
 *
 * `footer` is drawn inside the same border, under the text, and cannot be
 * edited — the sender's signature, so the box shows the email as it will go.
 *
 * `mentionables` turns on @mentions: typing "@" offers these people, and a
 * pick becomes one uneditable "@Name" that the document carries as a mention
 * (`lib/richText.js`). Without it — the email box, templates, signatures — a
 * mention pasted in from elsewhere arrives as plain text.
 *
 * Imperative handle (`ref`): `clear()`, `focus()`, `insertText(text)` and
 * `insertDoc(doc)` at the caret, and `getDoc()`.
 */
export default function RichTextEditor({
  ref, initialDoc, onChange, placeholder, disabled = false, onKeyDown, onPasteFiles,
  footer, minHeight = 96, ariaLabel, mentionables,
}) {
  const box = useRef(null)
  const saved = useRef(null) // the caret, kept while focus is elsewhere (a template menu)
  const initial = useRef(initialDoc) // only ever read once, on mount
  const [empty, setEmpty] = useState(() => isEmptyDoc(normalizeDoc(initialDoc)))
  const [active, setActive] = useState({})
  // The mention being typed: where its "@" is, what follows it, who matches.
  // `pick` is the highlighted name; it survives typing more of the same one.
  const [typing, setTyping] = useState(null) // { node, at, end, people, anchor, pick }
  const mentions = Boolean(mentionables)

  /** The document as this box may hand it out. */
  const read = useCallback(() => {
    const doc = docFromDom(box.current)
    return mentions ? doc : stripMentions(doc)
  }, [mentions])

  /**
   * Whether the caret is just after "@something" — and if so, who it could
   * be. Only inside one text node, so a mention never reaches across a line
   * or into formatting.
   */
  const lookForMention = useCallback(() => {
    if (!mentions) return
    const sel = document.getSelection?.()
    const node = sel?.rangeCount ? sel.anchorNode : null
    if (!sel?.isCollapsed || node?.nodeType !== 3 || !box.current?.contains(node)) {
      setTyping(null)
      return
    }
    const found = mentionQuery(node.nodeValue.slice(0, sel.anchorOffset))
    const people = found ? matchPeople(mentionables, found.query) : []
    if (!found || !people.length) {
      setTyping(null)
      return
    }
    let rect = null
    try { rect = sel.getRangeAt(0).getBoundingClientRect?.() ?? null } catch { rect = null }
    setTyping((prev) => {
      const same = prev?.node === node && prev?.at === found.at
      return {
        node, at: found.at, end: sel.anchorOffset, people, anchor: caretAnchor(rect, box),
        pick: same ? Math.min(prev.pick, people.length - 1) : 0,
      }
    })
  }, [mentions, mentionables])

  const emit = useCallback(() => {
    const doc = read()
    setEmpty(isEmptyDoc(doc))
    onChange?.(doc)
    lookForMention()
  }, [onChange, read, lookForMention])

  // The starting content is written once; after that the box is the browser's.
  useEffect(() => {
    if (box.current) box.current.innerHTML = docToHtml(normalizeDoc(initial.current))
  }, [])

  // Which buttons are lit, and where the caret was — for every selection
  // change inside this box.
  useEffect(() => {
    const onSelection = () => {
      const sel = document.getSelection?.()
      if (!sel?.rangeCount || !box.current?.contains(sel.anchorNode)) return
      saved.current = sel.getRangeAt(0).cloneRange()
      setActive(Object.fromEntries(TOOLS.map((t) => [t.command, isOn(t.command)])))
      lookForMention()
    }
    document.addEventListener('selectionchange', onSelection)
    return () => document.removeEventListener('selectionchange', onSelection)
  }, [lookForMention])

  /**
   * Swaps the typed "@query" for the person: one span that reads and deletes
   * as a whole, then a space, with the caret after it.
   */
  const choose = (person) => {
    const t = typing
    setTyping(null)
    if (!t || !person || !box.current?.contains(t.node)) return
    const range = document.createRange()
    range.setStart(t.node, t.at)
    range.setEnd(t.node, Math.min(t.end, t.node.nodeValue.length))
    range.deleteContents()
    const holder = document.createElement('template')
    holder.innerHTML = mentionHtml(person.id, mentionText(person))
    const span = holder.content.firstChild
    const space = document.createTextNode('\u00a0')
    range.insertNode(space)
    range.insertNode(span)
    const sel = document.getSelection?.()
    if (sel) {
      const after = document.createRange()
      after.setStart(space, 1)
      after.collapse(true)
      sel.removeAllRanges()
      sel.addRange(after)
      saved.current = after.cloneRange()
    }
    box.current.focus()
    emit()
  }

  /** Focus the box with the caret back where it was, or at the end. */
  const restore = () => {
    const el = box.current
    el.focus()
    const sel = document.getSelection?.()
    if (!sel) return
    sel.removeAllRanges()
    if (saved.current && el.contains(saved.current.startContainer)) {
      sel.addRange(saved.current)
    } else {
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(false)
      sel.addRange(range)
    }
  }

  /** Inserts plain text at the caret, with or without execCommand. */
  const insertText = (text) => {
    restore()
    if (!exec('insertText', text)) {
      const sel = document.getSelection?.()
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        const node = document.createTextNode(text)
        range.insertNode(node)
        range.setStartAfter(node)
        range.collapse(true)
      } else {
        box.current.append(document.createTextNode(text))
      }
    }
    emit()
  }

  /**
   * Inserts a document at the caret, formatting and all — a template. One line
   * goes into the line the caret is on; anything longer brings its own lines.
   * The HTML is built from the document, so nothing in it is markup of its own.
   */
  const insertDoc = (doc) => {
    const clean = normalizeDoc(doc)
    if (isEmptyDoc(clean)) return
    const oneLine = clean.blocks.length === 1 && clean.blocks[0].type === 'p'
    const html = oneLine ? docToHtml(clean).replace(/^<div>|<\/div>$/g, '') : docToHtml(clean)
    restore()
    if (!exec('insertHTML', html)) {
      const parsed = document.createElement('template')
      parsed.innerHTML = html
      const last = parsed.content.lastChild
      const sel = document.getSelection?.()
      if (sel?.rangeCount) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        range.insertNode(parsed.content)
        if (last) { range.setStartAfter(last); range.collapse(true) }
      } else {
        box.current.append(parsed.content)
      }
    }
    emit()
  }

  useImperativeHandle(ref, () => ({
    clear: () => {
      if (box.current) box.current.innerHTML = ''
      saved.current = null
      emit()
    },
    focus: () => restore(),
    insertText,
    insertDoc,
    getDoc: () => read(),
  }))

  const run = (command) => {
    restore()
    exec(command)
    emit()
  }

  const link = () => {
    restore()
    const sel = document.getSelection?.()
    const selected = sel?.toString() ?? ''
    const href = safeHref(window.prompt('Link address (https://… or mailto:…)', 'https://'))
    restore()
    if (!href) return
    if (selected) exec('createLink', href)
    else exec('insertHTML', docToHtml({ blocks: [{ type: 'p', runs: [{ text: href, href }] }] })
      .replace(/^<div>|<\/div>$/g, ''))
    emit()
  }

  const clearFormatting = () => {
    restore()
    exec('removeFormat')
    exec('unlink')
    emit()
  }

  const onPaste = (e) => {
    // Files first: a pasted screenshot is an attachment, not part of the text.
    onPasteFiles?.(e)
    if (e.defaultPrevented) return
    e.preventDefault()
    const html = e.clipboardData?.getData('text/html')
    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (html) {
      const clean = docToHtml(docFromHtml(html))
      if (!exec('insertHTML', clean)) insertText(text)
    } else {
      if (!exec('insertText', text)) insertText(text)
    }
    emit()
  }

  const keyDown = (e) => {
    // While names are offered, the arrows, Enter and Tab are the picker's.
    if (typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const count = typing.people.length
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setTyping((t) => ({ ...t, pick: (t.pick + (e.key === 'ArrowDown' ? 1 : count - 1)) % count }))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        choose(typing.people[Math.min(typing.pick, count - 1)])
        return
      }
      if (e.key === 'Escape') {
        // Closes the list, not whatever the box sits in.
        e.preventDefault()
        e.stopPropagation()
        setTyping(null)
        return
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      link()
      return
    }
    onKeyDown?.(e)
  }

  return (
    <Box sx={{
      border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper',
      '&:focus-within': { borderColor: 'primary.main', boxShadow: (t) => `0 0 0 1px ${t.palette.primary.main}` },
      opacity: disabled ? 0.6 : 1,
    }}>
      <Stack direction="row" spacing={0.25} sx={{ px: 0.5, py: 0.25, borderBottom: 1, borderColor: 'divider' }}>
        {TOOLS.map(({ command, label, key, Icon }) => (
          <Tooltip key={command} title={key ? `${label} (${MOD_KEY_LABEL}+${key})` : label}>
            <span>
              <IconButton size="small" aria-label={label} aria-pressed={Boolean(active[command])}
                disabled={disabled}
                color={active[command] ? 'primary' : 'default'}
                // Keep the selection in the box: a click would otherwise move
                // focus to the button and format nothing.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => run(command)}>
                <Icon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
        ))}
        <Tooltip title={`Link (${MOD_KEY_LABEL}+K)`}>
          <span>
            <IconButton size="small" aria-label="Link" disabled={disabled}
              onMouseDown={(e) => e.preventDefault()} onClick={link}>
              <InsertLinkIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Clear formatting">
          <span>
            <IconButton size="small" aria-label="Clear formatting" disabled={disabled}
              onMouseDown={(e) => e.preventDefault()} onClick={clearFormatting}>
              <FormatClearIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Box sx={{ position: 'relative' }}>
        {empty && placeholder && (
          <Typography variant="body2" color="text.disabled" aria-hidden
            sx={{ position: 'absolute', top: 10, left: 14, pointerEvents: 'none' }}>
            {placeholder}
          </Typography>
        )}
        <Box ref={box} role="textbox" aria-multiline="true" aria-label={ariaLabel ?? placeholder}
          data-rich-text-editor
          contentEditable={!disabled} suppressContentEditableWarning
          onInput={emit} onPaste={onPaste} onKeyDown={keyDown}
          onBlur={() => setTyping(null)}
          onDrop={(e) => e.preventDefault()}
          onFocus={() => exec('defaultParagraphSeparator', 'div')}
          sx={{
            ...richTextSx,
            minHeight, px: 1.75, py: 1.25, outline: 'none',
            typography: 'body2', overflowWrap: 'anywhere',
          }} />
      </Box>

      {typing && (
        <Popper open anchorEl={typing.anchor} placement="bottom-start"
          sx={{ zIndex: (t) => t.zIndex.modal + 1 }}>
          <Paper elevation={6} sx={{ mt: 0.5, minWidth: 240, maxWidth: 320 }}>
            <List dense role="listbox" aria-label="People to mention">
              {typing.people.map((p, n) => (
                <ListItemButton key={p.id} role="option" aria-selected={n === typing.pick} selected={n === typing.pick}
                  // Keep the caret in the box: a click would otherwise blur it first.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setTyping((t) => (t ? { ...t, pick: n } : t))}
                  onClick={() => choose(p)}>
                  <UserOption user={p} size={22} />
                </ListItemButton>
              ))}
            </List>
          </Paper>
        </Popper>
      )}

      {footer && (
        // Inside the border, under the text: part of the email as it will be
        // sent, but outside the editable region, so it cannot be typed into.
        <Box data-rich-text-footer
          sx={{ px: 1.75, pb: 1.25, color: 'text.secondary', userSelect: 'none' }}>
          <Divider sx={{ mb: 1, borderStyle: 'dashed' }} />
          {footer}
        </Box>
      )}
    </Box>
  )
}

/**
 * Where the mention list hangs: under the caret when the browser can say where
 * that is, otherwise under the box.
 */
const caretAnchor = (rect, box) => ({
  getBoundingClientRect: () => (rect && (rect.width || rect.height || rect.left || rect.top)
    ? rect : box.current?.getBoundingClientRect?.() ?? new DOMRect()),
  nodeType: 1,
})

/** How a mention looks, wherever rich text is drawn. */
const mentionSx = {
  color: 'primary.main', bgcolor: 'rgba(37, 99, 235, 0.08)', borderRadius: 1, px: 0.5,
  fontWeight: 500, whiteSpace: 'nowrap',
}

/** The spacing both the editor and a sent email draw rich text with. */
const richTextSx = {
  '& div, & p': { m: 0 },
  '& ul, & ol': { my: 0.5, pl: 3 },
  '& a': { color: 'primary.main' },
  '& [data-mention]': mentionSx,
}

function Runs({ runs }) {
  return runs.map((r, n) => {
    let node = r.text.split('\n').flatMap((part, k) => (k ? [<br key={`br${k}`} />, part] : [part]))
    if (r.b) node = <strong>{node}</strong>
    if (r.i) node = <em>{node}</em>
    if (r.u) node = <u>{node}</u>
    if (r.mention) return <span key={n} data-mention={r.mention}>{node}</span>
    // Re-checked here as well as when it was written: the row is data.
    const href = r.href ? safeHref(r.href) : null
    if (href) node = <a href={href} target="_blank" rel="noopener noreferrer">{node}</a>
    return <span key={n}>{node}</span>
  })
}

/**
 * A document drawn as React elements — never as HTML — so a sent email, a
 * signature or a comment shows its formatting without anything in it being
 * able to run.
 */
export function RichTextView({ doc, sx }) {
  const { blocks } = normalizeDoc(doc)
  return (
    <Box sx={{ ...richTextSx, typography: 'body2', overflowWrap: 'anywhere', ...sx }}>
      {blocks.map((b, n) => {
        if (b.type === 'p') return <div key={n}>{b.runs.length ? <Runs runs={b.runs} /> : <br />}</div>
        const List = b.type
        return (
          <List key={n}>
            {b.items.map((item, k) => <li key={k}><Runs runs={item} /></li>)}
          </List>
        )
      })}
    </Box>
  )
}

/**
 * A comment (or template) as stored: its document when it has one, otherwise
 * the plain text it was written as before rich text — drawn exactly as it
 * always was, line breaks and spacing kept.
 */
export function StoredRichText({ body, doc, sx }) {
  if (doc) return <RichTextView doc={doc} sx={sx} />
  if (!body) return null
  return (
    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...sx }}>
      {body}
    </Typography>
  )
}
