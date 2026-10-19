import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Box, Divider, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import FormatBoldIcon from '@mui/icons-material/FormatBold'
import FormatItalicIcon from '@mui/icons-material/FormatItalic'
import FormatUnderlinedIcon from '@mui/icons-material/FormatUnderlined'
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted'
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered'
import InsertLinkIcon from '@mui/icons-material/InsertLink'
import FormatClearIcon from '@mui/icons-material/FormatClear'
import {
  docFromDom, docFromHtml, docToHtml, isEmptyDoc, normalizeDoc, safeHref,
} from '../lib/richText'
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
 * Imperative handle (`ref`): `clear()`, `focus()`, `insertText(text)` and
 * `insertDoc(doc)` at the caret, and `getDoc()`.
 */
export default function RichTextEditor({
  ref, initialDoc, onChange, placeholder, disabled = false, onKeyDown, onPasteFiles,
  footer, minHeight = 96, ariaLabel,
}) {
  const box = useRef(null)
  const saved = useRef(null) // the caret, kept while focus is elsewhere (a template menu)
  const initial = useRef(initialDoc) // only ever read once, on mount
  const [empty, setEmpty] = useState(() => isEmptyDoc(normalizeDoc(initialDoc)))
  const [active, setActive] = useState({})

  const emit = useCallback(() => {
    const doc = docFromDom(box.current)
    setEmpty(isEmptyDoc(doc))
    onChange?.(doc)
  }, [onChange])

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
    }
    document.addEventListener('selectionchange', onSelection)
    return () => document.removeEventListener('selectionchange', onSelection)
  }, [])

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
    getDoc: () => docFromDom(box.current),
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
          onDrop={(e) => e.preventDefault()}
          onFocus={() => exec('defaultParagraphSeparator', 'div')}
          sx={{
            ...richTextSx,
            minHeight, px: 1.75, py: 1.25, outline: 'none',
            typography: 'body2', overflowWrap: 'anywhere',
          }} />
      </Box>

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

/** The spacing both the editor and a sent email draw rich text with. */
const richTextSx = {
  '& div, & p': { m: 0 },
  '& ul, & ol': { my: 0.5, pl: 3 },
  '& a': { color: 'primary.main' },
}

function Runs({ runs }) {
  return runs.map((r, n) => {
    let node = r.text.split('\n').flatMap((part, k) => (k ? [<br key={`br${k}`} />, part] : [part]))
    if (r.b) node = <strong>{node}</strong>
    if (r.i) node = <em>{node}</em>
    if (r.u) node = <u>{node}</u>
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
