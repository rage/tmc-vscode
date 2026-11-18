import { Logger } from "./logger"

/** Parses a backend timestamp into a date, or `null` if it cannot be parsed. */
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

// Building an Intl formatter costs far more than formatting with one; the Courses view
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

const timestampFormats = new Map<string, Intl.DateTimeFormat>()

/**
 * Renders a moment to the second, to tell apart saves minutes apart: the time alone on `now`'s
 * day, else with the date. {@link formatDateTime} is for deadlines.
 */
export function formatTimestamp(date: Date, now: Date, locale: string | undefined): string {
  if (!isRealDate(date)) {
    return ""
  }
  const isToday = date.toDateString() === now.toDateString()
  const key = `${locale ?? ""}|${isToday}`
  let format = timestampFormats.get(key)
  if (!format) {
    format = new Intl.DateTimeFormat(
      locale,
      isToday ? { timeStyle: "medium" } : { dateStyle: "medium", timeStyle: "medium" },
    )
    timestampFormats.set(key, format)
  }
  return format.format(date)
}

const dateFormats = new Map<string | undefined, Intl.DateTimeFormat>()

/** Renders the day of a date alone, e.g. "Oct 2, 2026". */
function formatDate(date: Date, locale: string | undefined): string {
  let format = dateFormats.get(locale)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { dateStyle: "medium" })
    dateFormats.set(locale, format)
  }
  return format.format(date)
}

/** {@link formatRelativeTime} within a week of `now`; further off, a date reads better. */
export function formatNearRelativeTime(
  date: Date,
  now: Date,
  locale: string | undefined,
): string | undefined {
  return Math.abs(date.getTime() - now.getTime()) > RELATIVE_HINT_LIMIT_MS
    ? undefined
    : formatRelativeTime(date, now, locale)
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
  const near = formatNearRelativeTime(date, now, locale)
  return near === undefined ? absolute : `${absolute} (${near})`
}

/**
 * A deadline in few words, for where space is short: "in 3 days" within a week of `now`, its
 * date otherwise. {@link formatDeadline} has the time too.
 */
export function formatDeadlineBriefly(date: Date, now: Date, locale: string | undefined): string {
  if (!isRealDate(date)) {
    return ""
  }
  return formatNearRelativeTime(date, now, locale) ?? formatDate(date, locale)
}

/** How far `date` is from `now`, e.g. "in 3 days" or "2 hours ago", in days at most. */
function formatRelativeTime(date: Date, now: Date, locale: string | undefined): string {
  let relative = relativeTimeFormats.get(locale)
  if (!relative) {
    relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
    relativeTimeFormats.set(locale, relative)
  }
  const untilMs = date.getTime() - now.getTime()
  if (Math.abs(untilMs) >= DAY_MS) {
    return relative.format(Math.round(untilMs / DAY_MS), "day")
  }
  if (Math.abs(untilMs) >= HOUR_MS) {
    return relative.format(Math.round(untilMs / HOUR_MS), "hour")
  }
  return relative.format(Math.round(untilMs / MINUTE_MS), "minute")
}

/** The earliest of `dates` after `after`, or null if none is. */
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
