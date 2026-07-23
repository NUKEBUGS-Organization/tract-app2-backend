/** Parse comma-separated CORS allowlist; trim and strip trailing slashes. */
export function parseCorsOrigins(
  envValue: string | undefined,
  envName: string,
): string[] {
  const raw = envValue?.trim()
  if (!raw) {
    throw new Error(
      `${envName} is required (comma-separated origin allowlist, e.g. https://seller.tractcorp.com,https://buyer.tractcorp.com)`,
    )
  }

  const origins = raw
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean)

  if (!origins.length) {
    throw new Error(`${envName} must list at least one origin`)
  }

  return origins
}
