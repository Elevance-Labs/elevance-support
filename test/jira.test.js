// Pulling a ticket key out of whatever someone put in the Jira field — most
// often a URL pasted straight from the browser.
import { reporter } from './setup.js'
import { jiraKey } from '../src/lib/jira.js'

const { check, done } = reporter()

// ---- plain keys ----
check('a plain key is kept',      jiraKey('ENG-1234') === 'ENG-1234')
check('lower case is raised',     jiraKey('eng-1234') === 'ENG-1234')
check('surrounding space is cut', jiraKey('  ENG-1234  ') === 'ENG-1234')
check('a numeric project part',   jiraKey('ENG2-7') === 'ENG2-7')

// ---- pasted URLs ----
check('browse link',
  jiraKey('https://acme.atlassian.net/browse/ENG-1234') === 'ENG-1234')
check('browse link with a query',
  jiraKey('https://acme.atlassian.net/browse/ENG-1234?filter=-1') === 'ENG-1234')
check('browse link with a fragment',
  jiraKey('https://acme.atlassian.net/browse/ENG-1234#comment-99') === 'ENG-1234')
check('trailing slash',
  jiraKey('https://acme.atlassian.net/browse/ENG-1234/') === 'ENG-1234')

// A board URL names the project in the path and the open ticket in the query.
check('board link picks the selected issue, not the board',
  jiraKey('https://acme.atlassian.net/jira/software/projects/ENG/boards/12?selectedIssue=ENG-1234')
  === 'ENG-1234')
check('issue-navigator link',
  jiraKey('https://acme.atlassian.net/jira/software/c/projects/ENG/issues/ENG-1234') === 'ENG-1234')
check('a query that names no ticket leaves the path alone',
  jiraKey('https://acme.atlassian.net/browse/ENG-1234?oldIssueView=true') === 'ENG-1234')

// ---- what must not be lost ----
check('unrecognised text is returned trimmed', jiraKey('  see Slack  ') === 'see Slack')
check('empty stays empty',  jiraKey('') === '')
check('null is safe',       jiraKey(null) === '')
check('undefined is safe',  jiraKey() === '')

done()
