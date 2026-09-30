import { Logger } from "./logger"

/**
 * Parses a timestamp as a backend spells it into a date, or `null` if it cannot be parsed.
 */
export function parseDate(dateAsString: string): Date | null {
  const date = new Date(Date.parse(dateAsString))
  if (!isRealDate(date)) {
    Logger.warn(`Unparseable timestamp from the backend: ${dateAsString}`)
    return null
  }
  return date
}

function isRealDate(date: Date | null): date is Date {
  return date !== null && Number.isFinite(date.getTime())
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const RELATIVE_HINT_LIMIT_MS = 7 * DAY_MS

// Building an Intl formatter costs far more than formatting with one, and the Courses view
// formats several dates per row.
const dateTimeFormats = new Map<string | undefined, Intl.DateTimeFormat>()
const relativeTimeFormats = new Map<string | undefined, Intl.RelativeTimeFormat>()

/**
 * Renders a date and time for a student in their display language, e.g. "Oct 2, 2026, 3:00 PM".
 *
 * @param locale a BCP 47 tag such as `vscode.env.language`; `undefined` uses the runtime's.
 * @returns the empty string for a date that cannot be rendered.
 */
export function formatDateTime(date: Date, locale: string | undefined): string {
  if (!isRealDate(date)) {
    return ""
  }
  let format = dateTimeFormats.get(locale)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" })
    dateTimeFormats.set(locale, format)
  }
  return format.format(date)
}

/**
 * Renders a deadline as {@link formatDateTime} does, plus a hint such as "(in 3 days)" when it
 * is within a week of `now`.
 */
export function formatDeadline(date: Date, now: Date, locale: string | undefined): string {
  if (!isRealDate(date)) {
    return ""
  }
  const absolute = formatDateTime(date, locale)
  const untilMs = date.getTime() - now.getTime()
  if (Math.abs(untilMs) > RELATIVE_HINT_LIMIT_MS) {
    return absolute
  }
  let relative = relativeTimeFormats.get(locale)
  if (!relative) {
    relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
    relativeTimeFormats.set(locale, relative)
  }
  const hint =
    Math.abs(untilMs) >= DAY_MS
      ? relative.format(Math.round(untilMs / DAY_MS), "day")
      : Math.abs(untilMs) >= HOUR_MS
        ? relative.format(Math.round(untilMs / HOUR_MS), "hour")
        : relative.format(Math.round(untilMs / MINUTE_MS), "minute")
  return `${absolute} (${hint})`
}

/**
 * Finds the next date after initial date, or null if can't find any.
 */
export function findNextDateAfter(after: Date, dates: (Date | null)[]): Date | null {
  const pickNext = (currentDate: Date | null, candidate: Date | null): Date | null => {
    if (!isRealDate(candidate) || after >= candidate) {
      return currentDate
    }
    if (!currentDate) {
      return candidate
    }
    return candidate < currentDate ? candidate : currentDate
  }

  return dates.reduce((acc, date) => pickNext(acc, date), null)
}
