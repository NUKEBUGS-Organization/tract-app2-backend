import { FlagType } from './schemas/message.schema'

// Phone number patterns
const PHONE_PATTERNS = [
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
  /\(\d{3}\)\s?\d{3}[-.\s]?\d{4}/,
  /\+\d{1,3}[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/,
  /\b\d{10,11}\b/,
]

// Email patterns
const EMAIL_PATTERNS = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  // Obfuscated: "user at gmail dot com"
  /\b\w+\s+at\s+\w+\s+dot\s+\w+\b/i,
  /\b\w+\[at\]\w+\b/i,
]

// External link patterns
const LINK_PATTERNS = [
  /https?:\/\/[^\s]+/i,
  /www\.[a-z0-9-]+\.[a-z]{2,}/i,
  /\b(bit\.ly|tinyurl|t\.co|goo\.gl)\/\S+/i,
  // Obfuscated: "website dot com"
  /\b\w+\s+dot\s+(com|net|org|io|co)\b/i,
]

export interface FilterResult {
  isBlocked: boolean
  flagType: FlagType | null
  blockedReason: string | null
  sanitized: string
}

export function filterMessage(content: string): FilterResult {
  // Check phone numbers
  for (const pattern of PHONE_PATTERNS) {
    if (pattern.test(content)) {
      return {
        isBlocked: true,
        flagType: FlagType.PHONE_NUMBER,
        blockedReason: 'Phone number detected',
        sanitized: content.replace(pattern, '[BLOCKED]'),
      }
    }
  }

  // Check email addresses
  for (const pattern of EMAIL_PATTERNS) {
    if (pattern.test(content)) {
      return {
        isBlocked: true,
        flagType: FlagType.EMAIL_ADDRESS,
        blockedReason: 'Email address detected',
        sanitized: content.replace(pattern, '[BLOCKED]'),
      }
    }
  }

  // Check external links
  for (const pattern of LINK_PATTERNS) {
    if (pattern.test(content)) {
      return {
        isBlocked: true,
        flagType: FlagType.EXTERNAL_LINK,
        blockedReason: 'External link detected',
        sanitized: content.replace(pattern, '[BLOCKED]'),
      }
    }
  }

  return {
    isBlocked: false,
    flagType: null,
    blockedReason: null,
    sanitized: content,
  }
}
