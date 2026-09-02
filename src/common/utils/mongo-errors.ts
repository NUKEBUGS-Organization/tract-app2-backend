/** MongoDB duplicate key (E11000). */
export function isMongoDuplicateKeyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as { code?: number }).code
  if (code === 11000) return true
  const msg = err instanceof Error ? err.message : String(err)
  return /E11000|duplicate key/i.test(msg)
}
