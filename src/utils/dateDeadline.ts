import { Exercise } from "../api/types";

/**
 * Creates a date object from string
 * @param deadline Deadline as string from API
 */
export function parseDate(dateAsString: string): Date {
    const inMillis = Date.parse(dateAsString);
    const date = new Date(inMillis);
    return date;
}

/**
 * Returns a trimmed string presentation of a date.
 */
export function dateToString(date: Date): string {
    return date.toString().split("(", 1)[0];
}

/**
 * Finds the next date after initial date, or null if can't find any.
 */
export function findNextDateAfter(after: Date, dates: Array<Date | null>): Date | null {
    const nextDate = (currentDate: Date | null, nextDate: Date | null): Date | null => {
        if (!nextDate || after >= nextDate) {
            return currentDate;
        }
        if (!currentDate) {
            return nextDate;
        }
        return nextDate < currentDate ? nextDate : currentDate;
    };

    return dates.reduce(nextDate, null);
}
/**
 * compares two dates and returns 1, if first date arg is later tha second date arg. Otherwise return -1
 * @param a first date arg
 * @param b second date arg
 */
export function compareDates(a: Date, b: Date): number {
    if (a > b) {
        return 1;
    } else {
        return -1;
    }
}

/**
 * Selects proper deadline from soft and hard deadline
 * @returns Soft deadline and/or Hard deadline for exercise
 */
export function chooseDeadline(ex: Exercise): { date: Date | null; isHard: boolean } {
    const softDeadline = ex.soft_deadline ? parseDate(ex.soft_deadline) : null;
    const hardDeadline = ex.deadline ? parseDate(ex.deadline) : null;
    const next = findNextDateAfter(new Date(), [softDeadline, hardDeadline]);
    return { date: next, isHard: next === hardDeadline };
}
