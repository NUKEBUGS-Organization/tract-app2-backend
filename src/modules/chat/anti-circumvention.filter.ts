import { FlagType } from './schemas/message.schema'

export interface FilterResult {
  isBlocked: boolean
  flagType: FlagType | null
  blockedReason: string | null
  sanitized: string
}

// Limit bare domains to known endings so "St. Paul" and "sq. ft" remain prose.
const TLDS = 'com|net|org|io|co|me|app|dev|gg|to|tv|us|info|biz|xyz|site|online|link|live|chat'
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

function normalise(input: string): string {
  return input.normalize('NFKC')
    .replace(/\p{Cf}/gu, '') // Zero-width and directional formatting must not hide contacts.
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[\u06f0-\u06f9]/g, (c) => String(c.charCodeAt(0) - 0x6f0))
    .replace(/[[({]\s*\.\s*[\])}]/g, '.')
    .replace(/\b(?:dot)\b/gi, '.')
    .replace(/[[({]\s*at\s*[\])}]/gi, '@')
    .replace(/\bat\b(?=\s+[a-z0-9._-]+\s*\.)/gi, '@')
    .replace(/h[x*]{2}ps?:\/\//gi, 'https://')
}

function containsPhone(text: string): boolean {
  // These conventional business formats are not phone numbers. Mask whole tokens
  // before scanning so adjacent currency amounts cannot be joined into a phone.
  const numbers = text
    .replace(/(?<![\p{L}\p{N}])[$£€]\s*(?:\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{1,2}|\d{4,9})(?!\d)/gu, ' amount ')
    .replace(/\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})\b/g, ' date ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' time ')
    .replace(/\b(?:zero|one|two|three|four|five|six|seven|eight|nine|oh|niner)\b/gi,
      (word) => word.toLowerCase() === 'oh' ? '0' : word.toLowerCase() === 'niner' ? '9' : String(NUMBER_WORDS.indexOf(word.toLowerCase())))
  // All punctuation/symbols (including emoji), whitespace, and parentheses can
  // separate digits. Letters remain boundaries; we never join an entire message.
  const runs: string[] = numbers.match(/(?<![\p{L}\p{N}])\d(?:[\p{P}\p{S}\s]*\d)*(?![\p{L}\p{N}])/gu) ?? []
  return runs.some((run) => {
    const length = run.replace(/\D/g, '').length
    return length >= 10 || (length === 7 && /^\d{3}[.\-]\d{4}$/.test(run))
  })
}

export function filterMessage(content: string): FilterResult {
  const text = normalise(content)
  // A detection-only copy handles arbitrary separators within names and domains.
  // Keep dots/@, which carry contact meaning; preserve original text on success.
  const emailText = text.replace(/[^\p{L}\p{N}@.]/gu, '')
  const spacedTlds = TLDS.split('|').map((tld) => tld.split('').join('\\.*')).join('|')
  const email = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(emailText)
    || new RegExp(`[a-z0-9.]+@[a-z0-9.]+\\.(?:${spacedTlds})(?![a-z])`, 'i').test(emailText)
  const phone = containsPhone(text)
  const link = /https?:\/\/\S+|\bwww\.[a-z0-9.-]+/i.test(text)
    || new RegExp(`\\b[a-z0-9-]+\\s*\\.\\s*(?:${TLDS})\\b`, 'i').test(text)
    || /(?<![\w@./])@[a-z0-9._]{3,30}\b/i.test(text)

  const flagType = email ? FlagType.EMAIL_ADDRESS : phone ? FlagType.PHONE_NUMBER : link ? FlagType.EXTERNAL_LINK : null
  if (!flagType) return { isBlocked: false, flagType: null, blockedReason: null, sanitized: content }
  return {
    isBlocked: true,
    flagType,
    blockedReason: email ? 'Email address detected' : phone ? 'Phone number detected' : 'External link detected',
    // Block the entire message: transformed offsets cannot safely redact the
    // original and partial redaction can expose another obfuscated contact.
    sanitized: '[message blocked: contact information]',
  }
}
