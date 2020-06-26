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

export interface Deadline {
    /**Date of deadline */
    date: Date | null;
    /**Whether this deadline is yet to be met. */
    active: boolean;
}

/**
 * Resolves a future deadline if there is one and returns a verbal explanation of results.
 */
export function parseNextDeadlineAfter(after: Date, deadlines: Deadline[]): string {
    const validDeadlines = deadlines.filter((x) => x.date !== null);

    if (validDeadlines.length === 0) {
        return "No deadline";
    }

    const next = findNextDateAfter(
        after,
        validDeadlines.map((x) => x.date),
    );
    if (next) {
        return `Next deadline: ${dateToString(next)}`;
    }

    if (validDeadlines.some((x) => x.active)) {
        return "All deadlines have expired";
    }

    return "Next deadline: Not available";
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

/**
 * Make date pathable. Removes ":"" and replace with "-" and removes GMT.
 */
export function dateInPath(date: string): string {
    const fixedDate = date.replace(/:/g, "-");
    return fixedDate.split(" GMT")[0];
}
