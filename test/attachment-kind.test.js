// How an attachment is shown: which ones the in-page viewer opens, and how
// big it reads.
import { reporter } from './setup.js'
import { attachmentKind, formatBytes, isViewable } from '../src/lib/attachments'

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

done()
