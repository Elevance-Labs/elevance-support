// Companies are a list so that one customer is one row in every report: the
// name is what people read, the code is what links carry and renames survive.
import { reporter } from './setup.js'
import {
  activeCompanies, companyName, companyOptions, findCompany,
} from '../src/lib/companies.js'
import { COMPANIES } from './mockSupabase.js'

const { check, done } = reporter()

// ---- resolving whatever a link or a form gave us ----
check('a code resolves',        findCompany(COMPANIES, 'wupi')?.name === "Wilbert's U-Pull-It")
check('a code is case blind',   findCompany(COMPANIES, 'WUPI')?.name === "Wilbert's U-Pull-It")
check('surrounding space is cut', findCompany(COMPANIES, ' acme ')?.code === 'acme')
check('a name resolves too',    findCompany(COMPANIES, "Wilbert's U-Pull-It")?.code === 'wupi')
check('a name is case blind',   findCompany(COMPANIES, 'acme')?.code === 'acme')
check('an unknown value is null', findCompany(COMPANIES, 'Wilberts UPullIt') === null)
check('empty is null',          findCompany(COMPANIES, '') === null)
check('null is safe',           findCompany(COMPANIES, null) === null)
check('no list is safe',        findCompany(undefined, 'wupi') === null)

// A stale link must not silently blank the field.
check('an unknown value keeps its own text',
  companyName(COMPANIES, 'Old Free Text Ltd') === 'Old Free Text Ltd')
check('a code becomes its display name',
  companyName(COMPANIES, 'wupi') === "Wilbert's U-Pull-It")

// ---- what a form may offer ----
const active = activeCompanies(COMPANIES).map((c) => c.code)
check('inactive companies are not offered', !active.includes('former'), active.join(', '))
check('active ones are', active.includes('wupi') && active.includes('acme'), active.join(', '))

// ---- what a filter may offer ----
const rows = [
  { company: 'Acme' },
  { company: 'Old Free Text Ltd' },   // logged before the list existed
  { company: null },
]
const opts = companyOptions(COMPANIES, rows)
check('filter offers the configured companies', opts.includes("Wilbert's U-Pull-It"), opts.join(', '))
check('filter still reaches an old free-text company',
  opts.includes('Old Free Text Ltd'), opts.join(', '))
check('a company on no ticket is still offered', opts.includes('Acme'), opts.join(', '))
check('no duplicates', new Set(opts).size === opts.length, opts.join(', '))
check('nulls are skipped', !opts.includes(null) && !opts.includes(''), opts.join(', '))
check('sorted for a menu', [...opts].sort((a, b) => a.localeCompare(b)).join('|') === opts.join('|'),
  opts.join(', '))

done()
