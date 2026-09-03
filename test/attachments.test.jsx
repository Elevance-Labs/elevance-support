// What a request may carry: a screenshot pasted straight into the description,
// a screen recording up to 30MB, and nothing else.
import { setupDom, reporter } from './setup.js'
const dom = setupDom('http://localhost/embed/ACME/form')

const { createRoot } = await import('react-dom/client')
const { act } = await import('react')
const { MemoryRouter, Routes, Route } = await import('react-router-dom')
const { ThemeProvider } = await import('@mui/material')
const { theme } = await import('../src/theme')
const { ConfigProvider } = await import('../src/context/ConfigContext')
const EmbedForm = (await import('../src/pages/EmbedForm')).default

const { check, done } = reporter()
const D = dom.window.document

async function mount() {
  D.body.innerHTML = ''
  const el = D.createElement('div')
  D.body.appendChild(el)
  await act(async () => {
    createRoot(el).render(
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={['/embed/ACME/form']}>
          <ConfigProvider withUsers={false}>
            <Routes><Route path="/embed/:key/form" element={<EmbedForm />} /></Routes>
          </ConfigProvider>
        </MemoryRouter>
      </ThemeProvider>)
  })
  await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
  return el
}

// A file of a given type and (pretended) size — the bytes themselves never matter.
const fakeFile = (name, type, size = 1000) => {
  const f = new dom.window.File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

const chips = () => [...D.querySelectorAll('.MuiChip-label')].map((c) => c.textContent)
const errorText = () => D.querySelector('.MuiAlert-message')?.textContent ?? ''

// Paste into the description, carrying whatever the clipboard holds.
async function paste(items) {
  const area = D.querySelector('textarea')
  const ev = new dom.window.Event('paste', { bubbles: true })
  ev.clipboardData = { items }
  await act(async () => { area.dispatchEvent(ev) })
}
const clipFile = (file) => ({ kind: 'file', type: file.type, getAsFile: () => file })
const clipText = () => ({ kind: 'string', type: 'text/plain', getAsFile: () => null })

// Pick files through the ordinary file input.
async function pick(files) {
  const input = D.querySelector('input[type="file"]')
  Object.defineProperty(input, 'files', { value: files, configurable: true })
  await act(async () => {
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
}

// 1. A pasted screenshot becomes an attachment
await mount()
check('no attachments to begin with', chips().length === 0, chips().join(', '))
await paste([clipFile(fakeFile('image.png', 'image/png'))])
check('pasting a screenshot attaches it', chips().length === 1, chips().join(', '))
check('the pasted file is renamed, not left as image.png',
  /^pasted-.*\.png$/.test(chips()[0] ?? ''), chips()[0])

// 2. Two pastes are two attachments, not one name twice
await paste([clipFile(fakeFile('image.png', 'image/png'))])
check('a second paste attaches separately', chips().length === 2, chips().join(', '))
check('the two pastes have distinct names', new Set(chips()).size === 2, chips().join(', '))

// 3. Pasting text is left to the browser
await mount()
await paste([clipText()])
check('pasting text attaches nothing', chips().length === 0, chips().join(', '))

// 4. Video is allowed, up to 30MB
await mount()
await pick([fakeFile('walkthrough.mp4', 'video/mp4', 25 * 1024 * 1024)])
check('a 25MB video is accepted', chips().length === 1, chips().join(', '))
check('no error for an accepted video', errorText() === '', errorText())

await mount()
await pick([fakeFile('long.mp4', 'video/mp4', 31 * 1024 * 1024)])
check('a 31MB video is refused', chips().length === 0, chips().join(', '))
check('and says the video limit', errorText().includes('30MB'), errorText())

// 5. An image still stops at 10MB, even though the bucket now takes 30
await mount()
await pick([fakeFile('huge.png', 'image/png', 11 * 1024 * 1024)])
check('an 11MB image is refused', chips().length === 0, chips().join(', '))
check('and says the image limit', errorText().includes('10MB'), errorText())

// 6. Anything else is still refused
await mount()
await pick([fakeFile('macro.exe', 'application/x-msdownload')])
check('an executable is refused', chips().length === 0, chips().join(', '))
check('and says what is allowed',
  /PDF, image or video/.test(errorText()), errorText())

done()
