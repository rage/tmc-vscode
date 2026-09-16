import type { Exercise } from "../api/types"
import { Logger } from "./logger"

/**
 * Parses a timestamp as a backend spells it into a date.
 *
 * An unparseable string yields an `Invalid Date`, which is truthy and compares `false`
 * against every other date. Everything below rejects one rather than let it win a
 * comparison or reach the panel, so callers outside this module should do the same.
 */
export function parseDate(dateAsString: string): Date {
  const date = new Date(Date.parse(dateAsString))
  if (!isRealDate(date)) {
    Logger.warn(`Unparseable timestamp from the backend: ${dateAsString}`)
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
 */
export function parseNextDeadlineAfter(after: Date, deadlines: Deadline[]): string {
  const validDeadlines = deadlines.filter((x) => isRealDate(x.date))
  if (validDeadlines.length === 0) {
    return "No deadline"
  }

  const next = findNextDateAfter(
    after,
    validDeadlines.map((x) => x.date),
  )

  if (next) {
    return `Next deadline: ${dateToString(next)}`
  }

  return "All deadlines have expired"
}

/**
 * Compares two dates and returns 1, if first date later tha second date. Otherwise returns -1.
 * @param a first date arg
 * @param b second date arg
 */
export function compareDates(a: Date, b: Date): number {
  if (a > b) {
    return 1
  }
  return -1
}

/**
 * Selects proper deadline from soft and hard deadline
 * @returns Soft deadline and/or Hard deadline for exercise
 */
export function chooseDeadline(ex: Exercise): { date: Date | null; isHard: boolean } {
  const softDeadline = ex.soft_deadline ? parseDate(ex.soft_deadline) : null
  const hardDeadline = ex.deadline ? parseDate(ex.deadline) : null
  const next = findNextDateAfter(new Date(), [softDeadline, hardDeadline])
  return { date: next, isHard: next === hardDeadline }
}

/**
 * Make date pathable. Removes ":"" and replace with "-" and removes GMT.
 */
export function dateInPath(date: string): string {
  const fixedDate = date.replaceAll(":", "-")
  return fixedDate.split(" GMT")[0] ?? fixedDate
}
