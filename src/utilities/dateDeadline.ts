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

/**
 * Returns a trimmed string presentation of a date, or the empty string for a date that
 * cannot be rendered.
 */
export function dateToString(date: Date): string {
  if (!isRealDate(date)) {
    return ""
  }
  return date.toString().split("(", 1)[0] ?? ""
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const RELATIVE_HINT_LIMIT_MS = 7 * DAY_MS

/**
 * Renders a deadline for a student in their display language, e.g. "Oct 2, 2026, 3:00 PM
 * (in 3 days)"; the relative hint appears only within a week of `now`.
 *
 * @param locale a BCP 47 tag such as `vscode.env.language`; `undefined` uses the runtime's.
 * @returns the empty string for a date that cannot be rendered.
 */
export function formatDeadline(date: Date, now: Date, locale: string | undefined): string {
  if (!isRealDate(date)) {
    return ""
  }
  const absolute = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
  const untilMs = date.getTime() - now.getTime()
  if (Math.abs(untilMs) > RELATIVE_HINT_LIMIT_MS) {
    return absolute
  }
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
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

export interface Deadline {
  /**Date of deadline */
  date: Date | null
  /**Whether this deadline is yet to be met. */
  active: boolean
}

/**
 * Resolves a future deadline if there is one and returns a verbal explanation of results.
 *
 * @param locale the display language the deadline is rendered in, as for {@link formatDeadline}.
 */
export function parseNextDeadlineAfter(
  after: Date,
  deadlines: Deadline[],
  locale?: string,
): string {
  const validDeadlines = deadlines.filter((x) => isRealDate(x.date))
  if (validDeadlines.length === 0) {
    return "No deadline"
  }

  const next = findNextDateAfter(
    after,
    validDeadlines.map((x) => x.date),
  )

  if (next) {
    return `Next deadline: ${formatDeadline(next, after, locale)}`
  }

  return "All deadlines have expired"
}
