import { FlagType } from './schemas/message.schema'

export interface FilterResult {
  isBlocked: boolean
  flagType: FlagType | null
  blockedReason: string | null
  sanitized: string
}

// ── Known TLDs we treat a "word.tld" token as an external link ──────────────
// Kept to an allow-list so real-estate prose ("St. Paul", "sq. ft", "a.m.")
// is not mistaken for a domain.
const LINK_TLDS = [
  'com', 'net', 'org', 'io', 'co', 'me', 'app', 'dev', 'gg', 'to', 'tv',
  'us', 'info', 'biz', 'xyz', 'site', 'online', 'link', 'live', 'chat',
]
const TLD_ALT = LINK_TLDS.join('|')

const NUMBER_WORDS =
  '(?:zero|one|two|three|four|five|six|seven|eight|nine|oh|niner)'

// ── Detection patterns (run against a normalised copy of the message) ───────
const PHONE_PATTERNS: RegExp[] = [
  // 10–11 digits, optionally separated by space / dot / dash between any digit.
  /(?<![\w])(?:\d[\s.\-]?){10,11}(?![\d])/g,
  /\+\d{1,3}[\s.\-]?(?:\d[\s.\-]?){9,11}/g,
  // (555) 123-4567
  /\(\d{3}\)\s?\d{3}[\s.\-]?\d{4}/g,
  // 7-digit local with an explicit dot/dash separator (not a plain range).
  /(?<![\d])\d{3}[.\-]\d{4}(?![\d])/g,
  // Spelled-out: a run of 7+ number-words.
  new RegExp(`\\b(?:${NUMBER_WORDS}[\\s.\\-]+){6,}${NUMBER_WORDS}\\b`, 'gi'),
]

const EMAIL_PATTERNS: RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  // TLD separated by comma / middle-dot instead of a period.
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+[,·][A-Za-z]{2,}/g,
  // "user at gmail dot com" style (normalisation turns (at)/[at] into " at ").
  new RegExp(`\\b[\\w.+-]+\\s+at\\s+[\\w-]+\\s+dot\\s+(?:${TLD_ALT})\\b`, 'gi'),
]

const LINK_PATTERNS: RegExp[] = [
  /https?:\/\/[^\s]+/gi,
  /\bwww\.[a-z0-9-]+\.[a-z]{2,}\S*/gi,
  // Bare "word.tld" or "word.tld/path" — allow-listed TLDs only.
  // Label may be a single char to catch short link domains (t.me, x.com).
  new RegExp(`\\b[a-z0-9-]{1,}\\.(?:${TLD_ALT})(?:\\/\\S*)?\\b`, 'gi'),
  // "site dot com" (normalisation keeps the literal word "dot").
  new RegExp(`\\b[a-z0-9-]{2,}\\s+dot\\s+(?:${TLD_ALT})\\b`, 'gi'),
  // Social handle: @name (3+ chars), not an email local-part.
  /(?<![\w@./])@[a-z0-9._]{3,30}\b/gi,
]

/** Fold obfuscation into a canonical form before matching. */
function normalise(input: string): string {
  let s = input.normalize('NFKC') // fullwidth / math digits / ﹫ / ． → ASCII
  s = s.replace(/h[x*]{2}ps?:\/\//gi, (m) => (m.toLowerCase().includes('s://') ? 'https://' : 'http://')) // defang
  // [.] (.) [dot] (dot) {dot}  →  . / the word "dot"
  s = s.replace(/[[({]\s*\.\s*[\])}]/g, '.')
  s = s.replace(/[[({]\s*dot\s*[\])}]/gi, ' dot ')
  s = s.replace(/[[({]\s*at\s*[\])}]/gi, ' at ')
  return s
}

/** Collapse whitespace so spaced-out contact strings still match the email rule. */
function despace(input: string): string {
  return input.replace(/[ \t]+/g, '')
}

function scan(
  text: string,
  patterns: RegExp[],
  flagType: FlagType,
  reason: string,
): { hit: boolean; ranges: Array<{ start: number; end: number }>; flagType: FlagType; reason: string } {
  const ranges: Array<{ start: number; end: number }> = []
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(text)) !== null) {
      if (m[0].length === 0) {
        pattern.lastIndex++
        continue
      }
      ranges.push({ start: m.index, end: m.index + m[0].length })
    }
  }
  return { hit: ranges.length > 0, ranges, flagType, reason }
}

export function filterMessage(content: string): FilterResult {
  const normalised = normalise(content)
  const collapsed = despace(normalised)

  // Positional scans run against `normalised`, so their match ranges line up
  // with the string we redact.
  const positional = [
    scan(normalised, PHONE_PATTERNS, FlagType.PHONE_NUMBER, 'Phone number detected'),
    scan(normalised, EMAIL_PATTERNS, FlagType.EMAIL_ADDRESS, 'Email address detected'),
    scan(normalised, LINK_PATTERNS, FlagType.EXTERNAL_LINK, 'External link detected'),
  ]
  // Detection-only: the whitespace-collapsed copy catches "b o b @ g m a i l . c o m"
  // but its indices don't map back to `normalised`, so it only flips isBlocked.
  const collapsedEmailHit = scan(
    collapsed,
    EMAIL_PATTERNS,
    FlagType.EMAIL_ADDRESS,
    'Email address detected',
  ).hit

  const anyHit = positional.some((r) => r.hit) || collapsedEmailHit
  if (!anyHit) {
    return { isBlocked: false, flagType: null, blockedReason: null, sanitized: content }
  }

  // Redact every matched span (across all categories) from the normalised text.
  const spans = positional
    .flatMap((r) => r.ranges)
    .sort((a, b) => a.start - b.start)
  let sanitized: string
  if (spans.length > 0) {
    sanitized = ''
    let cursor = 0
    for (const { start, end } of spans) {
      if (start < cursor) continue // overlapping match already covered
      sanitized += normalised.slice(cursor, start) + '[BLOCKED]'
      cursor = end
    }
    sanitized += normalised.slice(cursor)
  } else {
    // Only the collapsed-copy heuristic fired — we can't locate the span.
    sanitized = '[message blocked: contact information]'
  }

  const first = positional.find((r) => r.hit)
  return {
    isBlocked: true,
    flagType: first?.flagType ?? FlagType.EMAIL_ADDRESS,
    blockedReason: first?.reason ?? 'Email address detected',
    sanitized,
  }
}
