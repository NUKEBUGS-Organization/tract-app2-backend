/**
 * Canonicalise a phone number before dedup/storage.
 *
 * The DTO regex accepts both `+15125550123` and `15125550123`; without
 * normalising, those hit the unique index as two different strings and the
 * "account with this phone already exists" check is trivially bypassed by
 * toggling the leading `+`. We reduce to digits and re-add a single `+`.
 */
export function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '')
  return digits ? `+${digits}` : ''
}
