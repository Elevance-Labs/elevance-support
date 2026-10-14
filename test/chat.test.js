// Turning the Chat thread a ticket was announced in into a link that opens it.
import { reporter } from './setup.js'
import { chatThreadUrl } from '../src/lib/chat.js'

const { check, done } = reporter()

check('a thread name becomes a room link',
  chatThreadUrl('spaces/AAAAbC12dE/threads/xYz-987_q') === 'https://chat.google.com/room/AAAAbC12dE/xYz-987_q')
check('surrounding space is ignored',
  chatThreadUrl('  spaces/AAA/threads/BBB ') === 'https://chat.google.com/room/AAA/BBB')

// No thread recorded — an older ticket, or one whose announcement failed.
check('null has no link',      chatThreadUrl(null) === null)
check('undefined has no link', chatThreadUrl(undefined) === null)
check('empty has no link',     chatThreadUrl('') === null)

// Anything that is not a thread name is not turned into a link.
check('a message name is not a thread', chatThreadUrl('spaces/AAA/messages/BBB.BBB') === null)
check('a space alone is not a thread',  chatThreadUrl('spaces/AAA') === null)
check('a URL is not a thread name',     chatThreadUrl('https://evil.example/spaces/AAA/threads/BBB') === null)
check('extra segments are refused',     chatThreadUrl('spaces/AAA/threads/BBB/more') === null)

done()
