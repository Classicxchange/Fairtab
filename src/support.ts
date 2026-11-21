/** Where people reach Fairtab support. One place to change it. */
export const SUPPORT_EMAIL = 'contact@fairtab.online'

export function supportMailto(subject = 'Fairtab support'): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
}

/** Opens a new message in Gmail on the web, for people with no email app set up on their device. */
export function gmailCompose(subject = 'Fairtab support'): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(SUPPORT_EMAIL)}&su=${encodeURIComponent(subject)}`
}
