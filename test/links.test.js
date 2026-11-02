// Links between tickets: one undirected pair, read from either end, and what
// the picker offers next.
import { reporter } from './setup.js'
import {
  escapeLike, linkPair, MAX_LINK_SUGGESTIONS, otherEnd, parseTicketQuery, rankCandidates,
} from '../src/lib/links.js'

const { check, done } = reporter()

// ---- the pair ----
const A = '0b6c1a8e-0000-4000-8000-000000000001'
const B = 'f3a2d9c4-0000-4000-8000-000000000002'
check('a pair is kept smaller id first',
  JSON.stringify(linkPair(A, B)) === JSON.stringify({ issue_a: A, issue_b: B }))
check('linking from the other ticket is the same row',
  JSON.stringify(linkPair(B, A)) === JSON.stringify(linkPair(A, B)))
check('the far end, seen from the first',  otherEnd(linkPair(A, B), A) === B)
check('the far end, seen from the second', otherEnd(linkPair(A, B), B) === A)

// ---- what the search box is asking for ----
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
check('a reference names one ticket',  same(parseTicketQuery('ACME-42'), { key: 'ACME', number: 42 }))
check('a reference ignores case',      same(parseTicketQuery(' acme-7 '), { key: 'ACME', number: 7 }))
check('a bare number, any project',    same(parseTicketQuery('42'), { number: 42 }))
check('a #number, any project',        same(parseTicketQuery('#42'), { number: 42 }))
check('anything else is a title',      same(parseTicketQuery('export spins'), { title: 'export spins' }))
check('a key that is too long is a title',
  same(parseTicketQuery('ACMEX-4'), { title: 'ACMEX-4' }))
check('an empty box asks for nothing', parseTicketQuery('  ') === null)

check('% and _ are typed characters, not wildcards',
  escapeLike('50%_off\\') === '50\\%\\_off\\\\')

// ---- what the picker offers ----
const self = { id: 's', company: 'Acme', company_code: 'acme' }
const rows = [
  { id: 's',   company: 'Acme',   company_code: 'acme',   submitted_date: '2026-10-05' },
  { id: 'old', company: 'Acme',   company_code: 'acme',   submitted_date: '2026-09-01' },
  { id: 'new', company: 'Globex', company_code: 'globex', submitted_date: '2026-10-30' },
  { id: 'mid', company: 'Acme',   company_code: 'acme',   submitted_date: '2026-10-01' },
  { id: 'lnk', company: 'Acme',   company_code: 'acme',   submitted_date: '2026-10-02' },
]
const offered = rankCandidates(rows, self, ['lnk']).map((r) => r.id)
check('never the ticket itself', !offered.includes('s'), offered.join())
check('never one already linked', !offered.includes('lnk'), offered.join())
check('same company first, then newest',
  same(offered, ['mid', 'old', 'new']), offered.join())
check('a ticket with no company ranks by date alone',
  same(rankCandidates(rows, { id: 's' }).map((r) => r.id), ['new', 'lnk', 'mid', 'old']))
check('the picker is capped',
  rankCandidates(Array.from({ length: 50 }, (_, i) => ({ id: `t${i}` })), self).length
    === MAX_LINK_SUGGESTIONS)

done()
