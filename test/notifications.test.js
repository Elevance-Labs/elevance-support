/**
 * The rules behind notifications, mentions and device push — pure functions,
 * no rendering: what each notification says and where it leads, who an
 * "@" may mean, how a mention lives in the rich text document, and what this
 * browser can do about push.
 */
import { setupDom, reporter } from './setup.js'
setupDom()
const {
  notificationSentence, notificationPath, excerpt, unreadCount, unreadForIssue, badgeCount, watcherIds,
  NOTIFICATION_KINDS,
} = await import('../src/lib/notifications.js')
const { mentionQuery, matchPeople, mentionText, mentionablePeople } = await import('../src/lib/mentions.js')
const {
  normalizeDoc, docToHtml, docFromHtml, docToText, mentionedIds, stripMentions, toStored,
} = await import('../src/lib/richText.js')
const { pushStatus, pushStatusText, pushPrompt, SNOOZE_MS, vapidKeyBytes, subscriptionKeys, deviceLabel } = await import('../src/lib/push.js')
const { FIXTURES } = await import('./mockSupabase.js')

const { check, done } = reporter()

// ---------- what a notification says ----------
check('assigned, by someone', notificationSentence({ kind: 'assigned' }, 'Ada') === 'Ada assigned you')
check('assigned by nobody (the rota, the form)', notificationSentence({ kind: 'assigned' }, null) === 'Assigned to you')
check('mentioned', notificationSentence({ kind: 'mentioned' }, 'Grace') === 'Grace mentioned you')
check('commented', notificationSentence({ kind: 'commented' }, 'Grace') === 'Grace commented')
check('a status change names the new status',
  notificationSentence({ kind: 'status_changed', detail: 'Closed' }, 'Kay') === 'Kay moved it to Closed')
check('a customer reply names the sender',
  notificationSentence({ kind: 'email_received', detail: 'Jane' }, null) === 'Jane replied by email')
check('an actor who has since gone reads as "Someone"',
  notificationSentence({ kind: 'commented' }, null) === 'Someone commented')
check('every kind the database allows has words of its own',
  NOTIFICATION_KINDS.every((k) => notificationSentence({ kind: k, detail: 'x' }, 'A') !== 'Something changed'))

check('a short comment is quoted whole', excerpt('  Can you\n check?  ') === 'Can you check?')
const long = 'word '.repeat(60)
check('a long one is cut on a word, with an ellipsis',
  excerpt(long, 50).endsWith('word…') && excerpt(long, 50).length <= 51, excerpt(long, 50))

// ---------- where it leads ----------
check('to the ticket on the Issues page, with its project',
  notificationPath(FIXTURES.notifications[0]) === 'issues?issue=issue-1&project=proj-1')
check('a test leads nowhere in particular', notificationPath({ kind: 'test' }) === null)

// ---------- counting ----------
check('two of Ada\'s three are unread', unreadCount(FIXTURES.notifications) === 2)
check('both about ACME-42', JSON.stringify(unreadForIssue(FIXTURES.notifications, 'issue-1')) === '["n1","n2"]')
check('none unread about BILL-1', unreadForIssue(FIXTURES.notifications, 'issue-2').length === 0)
check('the icon badge stops at 99, and never goes negative',
  badgeCount(250) === 99 && badgeCount(-3) === 0 && badgeCount(undefined) === 0)
check('an unwatch is a row saying so, not a watcher',
  JSON.stringify(watcherIds(FIXTURES.issue_watchers)) === '["user-1","user-2"]')

// ---------- typing a mention ----------
check('"@gra" at the start is a mention', mentionQuery('@gra')?.query === 'gra')
check('after a space too, with where its "@" is',
  JSON.stringify(mentionQuery('ping @ada')) === JSON.stringify({ query: 'ada', at: 5 }))
check('up to two words of a name', mentionQuery('hi @ada lov')?.query === 'ada lov')
check('a bare "@" offers everyone', mentionQuery('hi @')?.query === '')
check('an email address is not a mention', mentionQuery('mail jane@acme') === null)
check('three words in, it is just text', mentionQuery('@ada said that') === null)
check('accented names', mentionQuery('@José')?.query === 'José')

const people = FIXTURES.profiles
check('names that start with it come first',
  matchPeople(people, 'k')[0]?.id === 'user-3')
check('a surname matches', matchPeople(people, 'hop').map((p) => p.id).join() === 'user-2')
check('so does the email for a nameless account', matchPeople(people, 'grace')[0]?.id === 'user-2')
check('nobody matches nonsense', matchPeople(people, 'zzz').length === 0)
check('the mention text is the shown name', mentionText(people[1]) === '@Grace Hopper')

const roster = [...people,
  { id: 'user-4', full_name: 'Outside', role: 'member', is_active: true },
  { id: 'user-5', full_name: 'Boss', role: 'admin', is_active: true },
  { id: 'user-6', full_name: 'Left', role: 'admin', is_active: false }]
const offered = mentionablePeople(roster, ['user-1', 'user-2', 'user-3'], 'user-2').map((p) => p.id)
check('offers the project\'s members and every admin', offered.includes('user-3') && offered.includes('user-5'))
check('not someone outside the project', !offered.includes('user-4'))
check('not a disabled account, not yourself', !offered.includes('user-6') && !offered.includes('user-2'))

// ---------- a mention in the document ----------
const doc = normalizeDoc({ blocks: [
  { type: 'p', runs: [{ text: '@Ada Lovelace', mention: 'user-1' }, { text: ' and ' },
    { text: '@Kay', mention: 'user-3', href: 'https://x.example' }] },
  { type: 'ul', items: [[{ text: '@Ada Lovelace', mention: 'user-1' }], [{ text: '@x', mention: '"><img onerror=1>' }]] },
] })
check('a mention survives normalising', doc.blocks[0].runs[0].mention === 'user-1')
check('a mention is never also a link', !doc.blocks[0].runs[2].href)
check('an id that could be markup is dropped, the text kept',
  !doc.blocks[1].items[1][0].mention && doc.blocks[1].items[1][0].text === '@x')
check('mentionedIds: each person once, in order, lists included',
  JSON.stringify(mentionedIds(doc)) === '["user-1","user-3"]')
const twice = normalizeDoc({ blocks: [{ type: 'p', runs: [
  { text: '@Ada', mention: 'user-1' }, { text: '@Ada', mention: 'user-1' }] }] })
check('two mentions side by side stay two', twice.blocks[0].runs.length === 2)

const html = docToHtml(doc)
check('in the editor, a mention is one uneditable span',
  html.includes('<span data-mention="user-1" contenteditable="false">@Ada Lovelace</span>'), html)
const back = docFromHtml(html)
check('and reads back as the same mention',
  JSON.stringify(mentionedIds(back)) === '["user-1","user-3"]' && back.blocks[0].runs[0].text === '@Ada Lovelace')
check('a span with anything else on it is just text',
  mentionedIds(docFromHtml('<span data-mention="a b">@A</span>')).length === 0)
check('plain text keeps the name', docToText(doc).startsWith('@Ada Lovelace and @Kay'))
check('stored, the document keeps its mentions for the database to read',
  JSON.stringify(mentionedIds(toStored(doc).body_doc)) === '["user-1","user-3"]')
const stripped = stripMentions(doc)
check('stripping turns mentions back into text', mentionedIds(stripped).length === 0
  && stripped.blocks[0].runs.map((r) => r.text).join('') === '@Ada Lovelace and @Kay')

// ---------- what this browser can do ----------
const base = {
  vapidKey: 'BPk', hasWorker: true, hasPush: true, hasNotification: true, permission: 'default',
  device: { os: 'android', browser: 'chrome' }, standalone: false, subscribed: false,
}
check('no VAPID key: not set up', pushStatus({ ...base, vapidKey: '' }) === 'unconfigured')
check('ready to turn on', pushStatus(base) === 'off')
check('on: subscribed, permission granted, and registered to you on the server',
  pushStatus({ ...base, subscribed: true, registered: true, permission: 'granted' }) === 'on')
check('a subscription without permission is not on',
  pushStatus({ ...base, subscribed: true, registered: true, permission: 'default' }) === 'off')
check('a subscription the server no longer has is not on',
  pushStatus({ ...base, subscribed: true, registered: false, permission: 'granted' }) === 'off')
check('refused: blocked', pushStatus({ ...base, permission: 'denied' }) === 'blocked')
check('iPhone in Safari: install first, whatever it reports',
  pushStatus({ ...base, device: { os: 'ios', browser: 'safari' }, hasPush: false }) === 'install-first')
check('iPhone from the Home Screen: ready',
  pushStatus({ ...base, device: { os: 'ios', browser: 'safari' }, standalone: true }) === 'off')
check('no Push API: unsupported', pushStatus({ ...base, hasPush: false }) === 'unsupported')
check('no service worker (development): not set up', pushStatus({ ...base, hasWorker: false }) === 'unconfigured')
// ---------- what the dropdown says ----------
const now = Date.UTC(2026, 10, 12)
check('on: nothing to say', pushPrompt('on', { now }) === null)
check('loading, unsupported, not set up: nothing to say',
  ['loading', 'unsupported', 'unconfigured'].every((st) => pushPrompt(st, { now }) === null))
const off = pushPrompt('off', { now })
check('off: says so, and offers to turn on', off?.kind === 'off' && off.canEnable && off.severity === 'info')
check('blocked: says so, how to allow, nothing to click',
  pushPrompt('blocked', { now, device: { os: 'android' } })?.text.includes('padlock')
  && !pushPrompt('blocked', { now }).canEnable)
check('install first: says so', pushPrompt('install-first', { now })?.kind === 'install-first')
check('"Not now" keeps it quiet for a week', pushPrompt('off', { now, snoozedUntil: now + 1 }) === null
  && pushPrompt('off', { now: now + SNOOZE_MS, snoozedUntil: now + SNOOZE_MS - 1 })?.kind === 'off'
  && SNOOZE_MS === 7 * 86_400_000)
const stoppedOff = pushPrompt('off', { now, wasOn: true, snoozedUntil: now + SNOOZE_MS })
check('a device that had them and stopped says so, louder, whatever was snoozed',
  stoppedOff?.kind === 'stopped' && stoppedOff.severity === 'warning' && stoppedOff.canEnable)
const stoppedBlocked = pushPrompt('blocked', { now, wasOn: true, device: { os: 'mac' } })
check('stopped because blocked: says how to allow, cannot just turn on',
  stoppedBlocked?.kind === 'stopped' && !stoppedBlocked.canEnable && stoppedBlocked.text.includes('System Settings'))

check('blocked on a Mac points at System Settings',
  pushStatusText('blocked', { os: 'mac' }).includes('System Settings'))
check('blocked elsewhere points at the site settings',
  pushStatusText('blocked', { os: 'windows' }).includes('padlock'))

const key = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'
const bytes = vapidKeyBytes(key)
check('a VAPID key decodes to an uncompressed P-256 point', bytes.length === 65 && bytes[0] === 4)
check('a subscription gives its endpoint and keys', JSON.stringify(subscriptionKeys({
  toJSON: () => ({ endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' } }),
})) === JSON.stringify({ endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' }))
check('an incomplete one gives nothing', subscriptionKeys({ endpoint: 'https://x' }) === null)
check('devices are named for people', deviceLabel({ os: 'android', browser: 'chrome' }) === 'Chrome on Android'
  && deviceLabel({ os: 'ios', browser: 'safari' }, true) === 'Home Screen app on iPhone or iPad'
  && deviceLabel({ os: 'other', browser: 'other' }) === 'This device')

done()
