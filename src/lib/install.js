/**
 * Installing the app (a PWA): which device and browser this is, whether the
 * page is already running as the installed app, and how to install it here.
 *
 * Only Chrome, Edge and Samsung Internet (desktop and Android) let a page ask
 * to install itself, through `beforeinstallprompt` (see `pwa.ts`). Everywhere
 * else, and on those once their prompt is spent, the person does it from the
 * browser's own menus, and `installGuide` says how.
 */

/**
 * @typedef {'ios' | 'android' | 'mac' | 'windows' | 'other'} Os
 * @typedef {'safari' | 'chrome' | 'edge' | 'firefox' | 'samsung' | 'opera' | 'in-app' | 'other'} Browser
 * @typedef {object} Device
 * @property {Os} os
 * @property {Browser} browser
 * @property {boolean} mobile A phone or tablet: the app goes on the home screen rather than in a window.
 * @typedef {object} InstallGuide
 * @property {string} title
 * @property {string[]} steps What to do, in order. Empty when this browser cannot install the app.
 * @property {string} [note] A caveat (an OS version, another browser to use).
 */

// Apps that open links in their own built-in browser. On iOS a page there
// usually has no "Safari/" token at all (checked below).
const IN_APP = /FBAN|FBAV|Instagram|LinkedInApp|Line\/|GSA\/|Snapchat|Twitter|Slack|; wv\)/

/**
 * The OS and browser, from the user agent. `maxTouchPoints` tells an iPad
 * (which says it is a Mac) from a Mac.
 */
/** @returns {Device} */
export function detectDevice(ua, maxTouchPoints = 0) {
  const os =
    /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1) ? 'ios'
    : /Android/.test(ua) ? 'android'
    : /Windows/.test(ua) ? 'windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'mac'
    : 'other'

  const browser =
    IN_APP.test(ua) ? 'in-app'
    : /EdgiOS|EdgA\/|Edg\//.test(ua) ? 'edge'
    : /SamsungBrowser/.test(ua) ? 'samsung'
    : /OPR\/|OPiOS|OPT\//.test(ua) ? 'opera'
    : /FxiOS|Firefox\//.test(ua) ? 'firefox'
    : /CriOS|Chrome\/|Chromium\//.test(ua) ? 'chrome'
    : /Safari\//.test(ua) ? 'safari'
    // An iOS web view without the Safari token is another app's browser.
    : os === 'ios' ? 'in-app'
    : 'other'

  return { os, browser, mobile: os === 'ios' || os === 'android' }
}

/** The display modes of an installed app; a browser tab is `browser`. */
export const APP_DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay']

/**
 * Whether the page is running as the installed app, not in a browser tab.
 * `navigator.standalone` is iOS's own flag for a home-screen app.
 */
export function isStandalone(matches, iosStandalone) {
  return iosStandalone === true || APP_DISPLAY_MODES.some((mode) => matches(`(display-mode: ${mode})`))
}

/** What the install button says. */
export const installLabel = (device) => (device.os === 'ios' ? 'Add to Home Screen' : 'Install app')

const SAFARI_IOS = [
  'Tap the Share button (the square with an arrow pointing up). On newer iPhones it may be under the ⋯ button beside the address.',
  'Scroll down and tap “Add to Home Screen”. If it is not listed, tap “Edit Actions…” and add it.',
  'Keep “Open as Web App” turned on, then tap “Add”.',
]

const CHROME_ANDROID = [
  'Tap the ⋮ menu at the top right.',
  'Tap “Add to Home screen” or “Install app”.',
  'Tap “Install”.',
]

const ELSEWHERE = 'This browser cannot install web apps. Open this page in Chrome or Edge (or Safari on a Mac) and install it from there.'

/** How to install the app on this device, by hand. */
/** @returns {InstallGuide} */
export function installGuide(device, appName) {
  const { os, browser } = device
  const home = `Add ${appName} to your Home Screen`
  const desktop = `Install ${appName}`

  if (os === 'ios') {
    if (browser === 'safari') return { title: home, steps: SAFARI_IOS }
    if (browser === 'chrome' || browser === 'edge') {
      return {
        title: home,
        steps: [
          'Tap the Share button in the address bar.',
          'Tap “Add to Home Screen” (scroll down, or tap “More”, to find it).',
          'Tap “Add”.',
        ],
        note: 'Needs iOS 16.4 or later. On an older iPhone, open this page in Safari instead.',
      }
    }
    return {
      title: home,
      steps: [
        browser === 'in-app'
          ? 'This page is open inside another app. Open it in Safari first: tap ⋯ (or the compass) and choose “Open in Safari”.'
          : 'Open this page in Safari: copy the address and paste it into Safari.',
        ...SAFARI_IOS,
      ],
    }
  }

  if (os === 'android') {
    if (browser === 'samsung') {
      return { title: home, steps: ['Tap the ≡ menu at the bottom.', 'Tap “Add page to”, then “Home screen”.', 'Tap “Add”.'] }
    }
    if (browser === 'edge') {
      return { title: home, steps: ['Tap the ⋯ menu at the bottom.', 'Tap “Add to phone”.', 'Tap “Install”.'] }
    }
    if (browser === 'firefox') {
      return { title: home, steps: ['Tap the ⋮ menu.', 'Tap “Add app to Home screen” (or “Install”).', 'Tap “Add”.'] }
    }
    if (browser === 'chrome') return { title: home, steps: CHROME_ANDROID }
    return {
      title: home,
      steps: [
        browser === 'in-app'
          ? 'This page is open inside another app. Tap its ⋮ menu and choose “Open in Chrome” (or “Open in browser”).'
          : 'Open this page in Chrome.',
        ...CHROME_ANDROID,
      ],
    }
  }

  // A computer.
  if (browser === 'chrome') {
    return {
      title: desktop,
      steps: [
        'Click the install icon at the right end of the address bar (a screen with an arrow), or open the ⋮ menu.',
        'In the menu, choose “Cast, save, and share”, then “Install page as app…”.',
        'Click “Install”.',
      ],
    }
  }
  if (browser === 'edge') {
    return {
      title: desktop,
      steps: ['Click the ⋯ menu at the top right.', 'Choose “Apps”, then “Install this site as an app”.', 'Click “Install”.'],
    }
  }
  if (browser === 'safari' && os === 'mac') {
    return {
      title: desktop,
      steps: ['In the menu bar, choose File, then “Add to Dock…” (or use the Share button).', 'Click “Add”.'],
      note: 'Needs macOS Sonoma (14) or later.',
    }
  }
  return { title: desktop, steps: [], note: ELSEWHERE }
}
