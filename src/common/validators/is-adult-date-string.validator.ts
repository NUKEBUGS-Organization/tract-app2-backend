import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator'

const MIN_AGE = 18
const MAX_AGE = 120

function fullYearsSince(dob: Date, now: Date): number {
  let age = now.getUTCFullYear() - dob.getUTCFullYear()
  const monthDelta = now.getUTCMonth() - dob.getUTCMonth()
  if (monthDelta < 0 || (monthDelta === 0 && now.getUTCDate() < dob.getUTCDate())) {
    age--
  }
  return age
}

/**
 * Accepts an ISO date string that is a plausible adult birthdate:
 * a real, non-future date whose implied age is between 18 and 120.
 *
 * `@IsDateString()` alone let `3000-01-01` and a 10-year-old's birthdate
 * through to account creation on both the register and Google-complete paths.
 */
export function IsAdultDateString(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isAdultDateString',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || value.trim() === '') return false
          const parsed = new Date(value)
          if (Number.isNaN(parsed.getTime())) return false
          const now = new Date()
          if (parsed.getTime() > now.getTime()) return false
          const age = fullYearsSince(parsed, now)
          return age >= MIN_AGE && age <= MAX_AGE
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be a valid past date and the account holder must be at least ${MIN_AGE} years old`
        },
      },
    })
  }
}
