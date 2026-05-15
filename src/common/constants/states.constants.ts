export const APP2_STATES = [
  { code: 'TX', name: 'Texas' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NY', name: 'New York' },
  { code: 'MD', name: 'Maryland' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'PA', name: 'Pennsylvania' },
] as const

export const APP2_STATE_CODES = APP2_STATES.map((s) => s.code)

export type App2StateCode = (typeof APP2_STATES)[number]['code']
