// Written by 4.x, which this version must not break: it reads these keys but never deletes
// `user-data-v3` or writes it, so upgrading to 4.x again finds its data intact.

export const USER_DATA_KEY = "user-data-v3";

/**
 * Fingerprint of the `user-data-v3` value last imported into `user-data-v1`. Without it every
 * start would replace the courses changed here with the same 4.x snapshot.
 */
export const IMPORTED_USER_DATA_FINGERPRINT_KEY = "user-data-v3-imported";

/**
 * User data as 4.x stores it. `courses` holds tmc courses in the v2 shape plus fields this
 * version drops; `mooc_courses` holds courses.mooc.fi courses, which this version ignores.
 */
export interface UserData {
    courses: unknown[];
    mooc_courses?: unknown[];
}
