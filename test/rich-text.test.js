/**
 * Rich text for customer email: what the email box's HTML is read into, and
 * what may come out the other end. The point of the format is that nothing
 * but text and a handful of marks survives it — so most of what is checked
 * here is what gets dropped.
 */
import { setupDom, reporter } from './setup.js'
setupDom('http://localhost/')
const {
  docFromDom, docFromHtml, docFromText, docToHtml, docToText, isEmptyDoc, normalizeDoc, safeHref,
} = await import('../src/lib/richText.js')
const { signatureDoc } = await import('../src/lib/email.js')

const { check, done } = reporter()
const read = (html) => {
  const el = document.createElement('div')
  el.innerHTML = html
  return docFromDom(el)
}
const show = (doc) => JSON.stringify(doc)

// ---- what a typed email looks like ----
const typed = read('<div>Hi Jane,</div><div><br></div><div>It is <b>fixed</b> now.</div>')
check('each line as typed is a paragraph, and a blank line is kept',
  typed.blocks.length === 3 && isEmptyDoc({ blocks: [typed.blocks[1]] }), show(typed))
check('bold is a mark on a run, not a tag',
  typed.blocks[2].runs.some((r) => r.b && r.text === 'fixed'), show(typed))
check('text typed straight into the box, before any line, is a line too',
  docToText(read('Hello<div>there</div>')) === 'Hello\nthere', docToText(read('Hello<div>there</div>')))
check('a soft break inside a line stays a break',
  docToText(read('<div>one<br>two</div>')) === 'one\ntwo', show(read('<div>one<br>two</div>')))
check('lists keep their items',
  show(read('<ol><li>One</li><li>Two</li></ol>').blocks) === show([{ type: 'ol', items: [[{ text: 'One' }], [{ text: 'Two' }]] }]))
check('a nested list joins its parent rather than nesting',
  read('<ul><li>a<ul><li>b</li></ul></li></ul>').blocks[0].items.length === 2)

// ---- what a paste brings, and what it does not ----
const pasted = docFromHtml(`<html><head><style>p{color:red}</style><script>alert(1)</script></head>
  <body><p style="font-family:Comic Sans">Plain <span style="font-weight:700">bold</span>
  <a href="javascript:alert(1)" onclick="steal()">bad link</a>
  <a href="https://gideonsystem.com">good link</a>
  <img src="x" onerror="alert(2)"></p></body></html>`)
const pastedJson = show(pasted)
check('a pasted style tag and script contribute no text',
  !pastedJson.includes('color') && !pastedJson.includes('alert'), pastedJson)
check('bold written as a style is still bold', pasted.blocks[0].runs.some((r) => r.b && r.text === 'bold'), pastedJson)
check('a javascript: link loses its link and keeps its words',
  pasted.blocks[0].runs.some((r) => r.text.includes('bad link') && !r.href), pastedJson)
check('an https link is kept', pasted.blocks[0].runs.some((r) => r.href === 'https://gideonsystem.com'), pastedJson)
check('images, fonts and handlers are gone', !/img|onerror|Comic|onclick|steal/.test(pastedJson), pastedJson)
check('whitespace in pasted source collapses as a browser draws it',
  !pastedJson.includes('\\n  '), pastedJson)

// ---- a document from elsewhere is checked, not trusted ----
const crafted = normalizeDoc({ blocks: [
  { type: 'p', runs: [{ text: 'hi', b: 'yes', style: 'x', href: 'data:text/html,evil' }] },
  { type: 'script', runs: [{ text: 'alert(1)' }] },
  { type: 'ul', items: 'nope' },
  { type: 'p', runs: [{ text: '<b>not a tag</b>' }] },
] })
check('unknown blocks and marks are dropped; a non-true mark is not a mark',
  show(crafted.blocks[0]) === show({ type: 'p', runs: [{ text: 'hi' }] }), show(crafted))
check('only what the format knows survives', crafted.blocks.length === 2, show(crafted))
check('text that looks like a tag is escaped when it becomes HTML',
  docToHtml(crafted).includes('&lt;b&gt;not a tag&lt;/b&gt;') && !docToHtml(crafted).includes('<b>'),
  docToHtml(crafted))
check('a link becomes an anchor with an escaped address',
  docToHtml({ blocks: [{ type: 'p', runs: [{ text: 'x', href: 'https://a.com/?q="1"' }] }] }) === '<div>x</div>',
  'a quote in a URL is refused rather than escaped into the attribute')
check('safe links are http(s) and mailto only',
  safeHref('mailto:jane@acme.com') && safeHref('HTTPS://x.io') && !safeHref('javascript:x')
  && !safeHref('//evil.com') && !safeHref('vbscript:x'))
check('blank lines at either end are dropped',
  normalizeDoc({ blocks: [{ type: 'p', runs: [] }, { type: 'p', runs: [{ text: 'x' }] }, { type: 'p', runs: [{ text: ' ' }] }] })
    .blocks.length === 1)

// ---- the plain-text version ----
const doc = { blocks: [
  { type: 'p', runs: [{ text: 'See ' }, { text: 'the guide', href: 'https://x.io/guide' }] },
  { type: 'ol', items: [[{ text: 'Open it' }], [{ text: 'Read it' }]] },
  { type: 'ul', items: [[{ text: 'mail us', href: 'mailto:help@x.io' }]] },
] }
check('plain text keeps a link\'s address beside its words, and numbers and bullets',
  docToText(doc) === 'See the guide (https://x.io/guide)\n1. Open it\n2. Read it\n• mail us (help@x.io)',
  docToText(doc))
check('a template\'s lines become paragraphs', docFromText('a\n\nb').blocks.length === 3)
check('a box of blank lines is empty', isEmptyDoc(read('<div><br></div><div> </div>')))

// ---- the signature an email goes out with ----
check('with none saved, an email is signed with the sender\'s name',
  docToText(signatureDoc({ full_name: 'Ada Lovelace' })) === '— Ada Lovelace')
check('an empty saved signature counts as none',
  docToText(signatureDoc({ full_name: 'Ada', email_signature: { blocks: [{ type: 'p', runs: [] }] } })) === '— Ada')
check('a saved one is used as it is',
  docToText(signatureDoc({ full_name: 'Ada', email_signature: { blocks: [{ type: 'p', runs: [{ text: 'Ada · Support' }] }] } }))
    === 'Ada · Support')

done()
