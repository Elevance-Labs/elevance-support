// What the comment box and the email box share: the send chord, and how that
// chord is named.

/**
 * Ctrl+Enter posts, and so does Cmd+Enter.
 *
 * Both are accepted rather than picking one per platform: a Mac user reaches
 * for Cmd, everyone else for Ctrl, and honouring both means the shortcut is
 * never the wrong one. The platform is only consulted to *name* the key in the
 * hint next to the button.
 *
 * `isComposing` guards an IME: mid-composition Enter commits the candidate word
 * and must not also post the comment.
 */
export const isSubmitChord = (e) =>
  e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent?.isComposing

export const MOD_KEY_LABEL =
  typeof navigator !== 'undefined' &&
  /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '')
    ? '⌘' : 'Ctrl'
