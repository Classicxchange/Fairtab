/** Where people reach Fairtab support. One place to change it. */
export const SUPPORT_EMAIL = 'contact@fairtab.online'

export function supportMailto(subject = 'Fairtab support'): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`
}
