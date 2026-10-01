// How an attachment is shown: which ones the in-page viewer opens, and how
// big it reads.
import { reporter } from './setup.js'
import {
  acceptFiles, attachmentKind, formatBytes, isViewable, MAX_FILES, pastedName,
} from '../src/lib/attachments'

const { check, done } = reporter()

check('a PNG is an image', attachmentKind('image/png') === 'image')
check('an MP4 is a video', attachmentKind('video/mp4') === 'video')
check('a PDF is a pdf', attachmentKind('application/pdf') === 'pdf')
check('an unknown type is a file', attachmentKind('application/zip') === 'file')
check('a missing type is a file', attachmentKind(null) === 'file')

check('images open in the viewer', isViewable('image/jpeg'))
check('videos open in the viewer', isViewable('video/webm'))
check('PDFs do not — they open in a tab', !isViewable('application/pdf'))

check('bytes stay bytes', formatBytes(512) === '512 B')
check('kilobytes get one decimal', formatBytes(1536) === '1.5 KB', formatBytes(1536))
check('megabytes round once past ten', formatBytes(25 * 1024 * 1024) === '25 MB', formatBytes(25 * 1024 * 1024))
check('an unknown size is null', formatBytes(null) === null && formatBytes(undefined) === null)

// ---- what may be attached: one gate for the request form and the comment box ----
const file = (name, type, size = 1000) => ({ name, type, size })
const MB = 1024 * 1024

let r = acceptFiles([], [file('a.png', 'image/png'), file('b.pdf', 'application/pdf')])
check('images and PDFs are accepted', r.files.length === 2 && r.error === '', JSON.stringify(r))
r = acceptFiles([], [file('x.zip', 'application/zip'), file('ok.png', 'image/png')])
check('an unsupported type is skipped, the rest kept', r.files.length === 1 && /x\.zip/.test(r.error), JSON.stringify(r))
r = acceptFiles([], [file('big.png', 'image/png', 11 * MB)])
check('an image over 10MB is refused', r.files.length === 0 && /10MB/.test(r.error), r.error)
r = acceptFiles([], [file('rec.mp4', 'video/mp4', 29 * MB)])
check('a video may be up to 30MB', r.files.length === 1, r.error)
r = acceptFiles([], [file('long.mp4', 'video/mp4', 31 * MB)])
check('but not past it', r.files.length === 0 && /30MB/.test(r.error), r.error)
const full = Array.from({ length: MAX_FILES }, (_, i) => file(`${i}.png`, 'image/png'))
r = acceptFiles(full, [file('one-more.png', 'image/png')])
check(`no more than ${MAX_FILES} files`, r.files.length === MAX_FILES && /at most/.test(r.error), r.error)
check('the list passed in is not changed', full.length === MAX_FILES)

const at = new Date('2026-10-01T09:08:07.123Z')
check('a pasted screenshot is named by the moment it was pasted',
  pastedName(file('image.png', 'image/png'), at) === 'pasted-20261001T090807123.png',
  pastedName(file('image.png', 'image/png'), at))
check('a nameless paste takes its extension from its type',
  pastedName(file('', 'image/webp'), at).endsWith('.webp'))

done()
