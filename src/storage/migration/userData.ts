import { isEqual } from "lodash"
import type * as vscode from "vscode"
import { z } from "zod"

import type { MigratedData } from "."
import {
  LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
  LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER,
  LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER,
} from "../../config/constants"
import { StoredDataMigrationError } from "../../errors"
import { Logger } from "../../utilities/logger"
import * as data from "../data"

/** A stored course or exercise a migration left out, and why. */
export interface DroppedEntry {
  key: string
  /** Names the entry, e.g. `course 12 (python-course)` or `course 12, exercise 3`. */
  entry: string
  reason: string
}

/** A raw legacy value a migration left out, which rewriting `key` would otherwise lose. */
export type UnreadableValue = Pick<data.v3.UnreadableLegacyValue, "key" | "value">

/** The user data step of a migration run. */
export interface UserDataMigration extends MigratedData<data.v3.UserData> {
  /**
   * Whether `user-data-v1` or its record needs rewriting from the stored v3 even though `data` is
   * unset.
   */
  isLegacyMirrorStale: boolean
  dropped: DroppedEntry[]
  /** To keep before `user-data-v1` is rewritten; see {@link data.v3.UNREADABLE_LEGACY_DATA_KEY}. */
  unreadable: UnreadableValue[]
}

// Shapes every pre-4.0 version wrote: v0 (`userData`, before 2.0) and v1/v2 (`user-data-v1`).
// 0.1.0 could store a null description, versions before 0.9.0 lack the optional fields, and the
// material URL is missing when the server omitted it.
const legacyExerciseSchema = z.object({
  id: z.number(),
  passed: z.boolean(),
  name: z.string().optional(),
  deadline: z.string().nullish(),
  softDeadline: z.string().nullish(),
  availablePoints: z.number().optional(),
  awardedPoints: z.number().optional(),
})

const legacyCourseSchema = z.object({
  id: z.number(),
  name: z.string(),
  organization: z.string(),
  title: z.string().nullish(),
  description: z.string().nullish(),
  exercises: z.array(z.unknown()),
  availablePoints: z.number().optional(),
  awardedPoints: z.number().optional(),
  perhapsExamMode: z.boolean().optional(),
  newExercises: z.array(z.number()).optional(),
  notifyAfter: z.number().optional(),
  disabled: z.boolean().optional(),
  materialUrl: z.string().nullish(),
  material_url: z.string().nullish(),
})

const legacyUserDataSchema = z.object({ courses: z.array(z.unknown()) })

/** What the v0 `exerciseData` key knew of an exercise that v0 course data may lack. */
interface ExerciseFallback {
  name?: string | undefined
  deadline?: string | null | undefined
  softDeadline?: string | null | undefined
}

function describeCourse(raw: unknown, index: number): string {
  const course = z.object({ id: z.number(), name: z.string().optional() }).safeParse(raw)
  if (!course.success) {
    return `course at index ${index}`
  }
  return course.data.name
    ? `course ${course.data.id} (${course.data.name})`
    : `course ${course.data.id}`
}

/**
 * Reads one legacy course into the current shape, dropping only the exercises that cannot be
 * read; `undefined` when the course itself cannot be. Whatever it drops goes to `dropped`, with
 * the raw course in `unreadable`.
 */
function readLegacyCourse(
  raw: unknown,
  index: number,
  key: string,
  omitted: Pick<UserDataMigration, "dropped" | "unreadable">,
  exerciseFallbacks?: Map<number, ExerciseFallback>,
): data.v3.TmcLocalCourseData | undefined {
  const { dropped, unreadable } = omitted
  const parsed = legacyCourseSchema.safeParse(raw)
  if (!parsed.success) {
    dropped.push({ key, entry: describeCourse(raw, index), reason: z.prettifyError(parsed.error) })
    unreadable.push({ key, value: raw })
    return undefined
  }
  const course = parsed.data
  let isPartlyRead = false
  const exercises = course.exercises.flatMap<data.v3.TmcLocalCourseExercise>((rawExercise, i) => {
    const exercise = legacyExerciseSchema.safeParse(rawExercise)
    if (!exercise.success) {
      dropped.push({
        key,
        entry: `course ${course.id}, exercise at index ${i}`,
        reason: z.prettifyError(exercise.error),
      })
      isPartlyRead = true
      return []
    }
    const { id, passed, availablePoints, awardedPoints } = exercise.data
    const fallback = exerciseFallbacks?.get(id)
    return [
      {
        id,
        availablePoints: availablePoints ?? LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER,
        awardedPoints:
          awardedPoints ??
          (passed
            ? LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER
            : LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER),
        name: exercise.data.name ?? fallback?.name ?? id.toString(),
        deadline: exercise.data.deadline ?? fallback?.deadline ?? null,
        passed,
        softDeadline: exercise.data.softDeadline ?? fallback?.softDeadline ?? null,
      },
    ]
  })
  if (isPartlyRead) {
    unreadable.push({ key, value: raw })
  }
  return {
    id: course.id,
    name: course.name,
    title: course.title ?? course.name,
    description: course.description ?? "",
    organization: course.organization,
    exercises,
    availablePoints: course.availablePoints ?? 0,
    awardedPoints: course.awardedPoints ?? 0,
    perhapsExamMode: course.perhapsExamMode ?? false,
    newExercises: course.newExercises ?? [],
    notifyAfter: course.notifyAfter ?? 0,
    disabled: course.disabled ?? false,
    materialUrl: course.materialUrl ?? course.material_url ?? null,
  }
}

function v0ExerciseFallbacks(memento: vscode.Memento): Map<number, ExerciseFallback> {
  const exercises = z
    .array(z.looseObject({ id: z.number() }))
    .safeParse(memento.get(data.v0.EXERCISE_DATA_KEY))
  if (!exercises.success) {
    return new Map()
  }
  return new Map(
    exercises.data.map((exercise) => {
      const fallback = z
        .object({
          name: z.string().optional().catch(undefined),
          deadline: z.string().nullish().catch(undefined),
          softDeadline: z.string().nullish().catch(undefined),
        })
        .parse(exercise)
      return [exercise.id, fallback]
    }),
  )
}

function toLegacyCourse(course: data.v3.TmcLocalCourseData): data.v2.LocalCourseData {
  return {
    id: course.id,
    name: course.name,
    title: course.title,
    description: course.description,
    organization: course.organization,
    exercises: course.exercises.map((exercise) => ({
      id: exercise.id,
      availablePoints: exercise.availablePoints,
      awardedPoints: exercise.awardedPoints,
      name: exercise.name,
      deadline: exercise.deadline,
      passed: exercise.passed,
      softDeadline: exercise.softDeadline,
    })),
    availablePoints: course.availablePoints,
    awardedPoints: course.awardedPoints,
    perhapsExamMode: course.perhapsExamMode,
    newExercises: course.newExercises,
    notifyAfter: course.notifyAfter,
    disabled: course.disabled,
    materialUrl: course.materialUrl,
  }
}

/**
 * The tmc courses of `userData` in the shape 3.x reads from `user-data-v1`, so a downgrade
 * still shows them; `undefined`, which deletes the key, when there are none.
 */
function legacyUserDataOf(userData: data.v3.UserData): data.v2.UserData | undefined {
  return userData.courses.length > 0 ? { courses: userData.courses.map(toLegacyCourse) } : undefined
}

function legacyMirrorRecordOf(userData: data.v3.UserData | undefined): data.v3.LegacyMirrorRecord {
  return { courseIds: userData?.courses.map((course) => course.id) ?? [] }
}

/**
 * Rewrites `user-data-v1`, which 3.x reads after a downgrade, from the tmc courses of `userData`
 * unless it already holds them. Follow the v3 write with {@link writeLegacyMirrorRecord}.
 */
export async function writeLegacyMirror(
  memento: vscode.Memento,
  userData: data.v3.UserData | undefined,
): Promise<void> {
  const mirror = userData && legacyUserDataOf(userData)
  if (!isEqual(memento.get(data.v1.USER_DATA_KEY), mirror)) {
    await memento.update(data.v1.USER_DATA_KEY, mirror)
  }
}

/**
 * Records which tmc courses {@link writeLegacyMirror} mirrored, which the merge needs to tell a
 * course an older version removed from one the mirror never held.
 *
 * Write it after v3: until v3 has the change, a course the mirror lost must still count as mirrored.
 */
export async function writeLegacyMirrorRecord(
  memento: vscode.Memento,
  userData: data.v3.UserData | undefined,
): Promise<void> {
  const record = legacyMirrorRecordOf(userData)
  if (!isEqual(memento.get(data.v3.LEGACY_MIRROR_RECORD_KEY), record)) {
    await memento.update(data.v3.LEGACY_MIRROR_RECORD_KEY, record)
  }
}

/**
 * Applies what an older version changed in `user-data-v1` since this version last mirrored
 * `current` there; `undefined` when `user-data-v1` is unreadable as a whole.
 *
 * A tmc course whose stored copy differs from its mirror takes the stored fields, keeping the
 * ones v1 cannot express (and, per exercise id, the exercise's); one only there was added. One
 * missing there was removed, but only if `mirrored` holds its id: otherwise the mirror may never
 * have held it. `current` stays authoritative for everything else: mooc courses and unchanged tmc
 * courses. A course v1 holds but cannot read is left as `current` has it, and an entry without a
 * readable id stops any removal, since it may be any course.
 */
function mergeLegacyChanges(
  current: data.v3.UserData,
  rawLegacy: unknown,
  mirrored: ReadonlySet<number> | undefined,
  omitted: Pick<UserDataMigration, "dropped" | "unreadable">,
): data.v3.UserData | undefined {
  const key = data.v1.USER_DATA_KEY
  const legacy = legacyUserDataSchema.safeParse(rawLegacy)
  if (!legacy.success) {
    omitted.dropped.push({ key, entry: "every course", reason: z.prettifyError(legacy.error) })
    omitted.unreadable.push({ key, value: rawLegacy })
    return undefined
  }
  const readable = new Map<number, { raw: unknown; course: data.v3.TmcLocalCourseData }>()
  const unreadableIds = new Set<number>()
  let canRemove = true
  legacy.data.courses.forEach((raw, index) => {
    const course = readLegacyCourse(raw, index, key, omitted)
    if (course) {
      readable.set(course.id, { raw, course })
      return
    }
    const id = z.object({ id: z.number() }).safeParse(raw)
    if (id.success) {
      unreadableIds.add(id.data.id)
    } else {
      canRemove = false
    }
  })

  const courses = current.courses.flatMap<data.v3.TmcLocalCourseData>((course) => {
    const stored = readable.get(course.id)
    if (!stored) {
      if (unreadableIds.has(course.id) || !canRemove || !mirrored?.has(course.id)) {
        return [course]
      }
      Logger.info(`Removed course ${course.name}, which an older version removed.`)
      return []
    }
    if (isEqual(stored.raw, toLegacyCourse(course))) {
      return [course]
    }
    Logger.info(`Took the changes an older version made to course ${course.name}.`)
    const currentExercises = new Map(course.exercises.map((x) => [x.id, x]))
    return [
      {
        ...course,
        ...stored.course,
        exercises: stored.course.exercises.map((exercise) => ({
          ...currentExercises.get(exercise.id),
          ...exercise,
        })),
      },
    ]
  })
  const currentIds = new Set(current.courses.map((course) => course.id))
  for (const { course } of readable.values()) {
    if (!currentIds.has(course.id)) {
      Logger.info(`Added course ${course.name}, which an older version added.`)
      courses.push(course)
    }
  }
  return { ...current, courses }
}

/**
 * Brings user data up to v3 and keeps `user-data-v1` in step for a downgrade to 3.x.
 *
 * Reads only; the caller writes. With no v3 stored, the oldest legacy key holding data is the
 * source, read course by course. With v3 stored, a legacy key never replaces it: changes an
 * older version made to `user-data-v1` are merged in (see {@link mergeLegacyChanges}), and a
 * v0 key is ignored.
 *
 * @throws {StoredDataMigrationError} when the source holds courses but none can be read.
 */
export default function migrateUserDataToLatest(memento: vscode.Memento): UserDataMigration {
  const omitted: Pick<UserDataMigration, "dropped" | "unreadable"> = { dropped: [], unreadable: [] }
  const rawCurrent = memento.get<unknown>(data.v3.USER_DATA_KEY)
  const rawLegacy = memento.get<unknown>(data.v1.USER_DATA_KEY) ?? undefined

  if (rawCurrent !== undefined) {
    const current = data.v3.userDataSchema.safeParse(rawCurrent)
    if (!current.success) {
      // Reading v3 reports it; merging into it would hide that.
      return { ...unchanged(), ...omitted }
    }
    if (memento.get(data.v0.USER_DATA_KEY) !== undefined) {
      Logger.warn(`Ignored "${data.v0.USER_DATA_KEY}": "${data.v3.USER_DATA_KEY}" is newer.`)
    }
    // The stored value, not zod's copy, keeps fields a newer version added.
    const currentData = rawCurrent as data.v3.UserData
    const record = data.v3.legacyMirrorRecordSchema.safeParse(
      memento.get(data.v3.LEGACY_MIRROR_RECORD_KEY),
    )
    const mirrored = record.success ? new Set(record.data.courseIds) : undefined
    const mirror = legacyUserDataOf(currentData)
    // This version deletes the mirror itself when it has no tmc course, so only a missing mirror
    // recorded with courses was wiped by an older version.
    if (isEqual(rawLegacy, mirror) || (rawLegacy === undefined && !mirrored?.size)) {
      const isRecordStale =
        !record.success || !isEqual(record.data, legacyMirrorRecordOf(currentData))
      return {
        ...unchanged(),
        isLegacyMirrorStale: !isEqual(rawLegacy, mirror) || isRecordStale,
        ...omitted,
      }
    }
    const merged = mergeLegacyChanges(currentData, rawLegacy ?? { courses: [] }, mirrored, omitted)
    return {
      data: merged,
      supersededKeys: [],
      destinationKey: data.v3.USER_DATA_KEY,
      isLegacyMirrorStale: merged === undefined,
      ...omitted,
    }
  }

  const rawV0 = memento.get<unknown>(data.v0.USER_DATA_KEY) ?? undefined
  const [key, raw] =
    rawV0 !== undefined ? [data.v0.USER_DATA_KEY, rawV0] : [data.v1.USER_DATA_KEY, rawLegacy]
  if (raw === undefined) {
    return { ...unchanged(), ...omitted }
  }
  const legacy = legacyUserDataSchema.safeParse(raw)
  if (!legacy.success) {
    throw new StoredDataMigrationError(
      `The courses stored under "${key}" could not be read: ${z.prettifyError(legacy.error)}`,
    )
  }
  const fallbacks = key === data.v0.USER_DATA_KEY ? v0ExerciseFallbacks(memento) : undefined
  const courses = legacy.data.courses.flatMap((course, index) => {
    const read = readLegacyCourse(course, index, key, omitted, fallbacks)
    return read ? [read] : []
  })
  if (legacy.data.courses.length > 0 && courses.length === 0) {
    throw new StoredDataMigrationError(
      `None of the ${legacy.data.courses.length} courses stored under "${key}" could be read: ` +
        omitted.dropped.map(({ entry, reason }) => `${entry}: ${reason}`).join("; "),
    )
  }
  return {
    data: { courses, mooc_courses: [] },
    supersededKeys: key === data.v0.USER_DATA_KEY ? [key] : [],
    destinationKey: data.v3.USER_DATA_KEY,
    isLegacyMirrorStale: false,
    ...omitted,
  }
}

function unchanged(): Omit<UserDataMigration, "dropped" | "unreadable"> {
  return {
    data: undefined,
    supersededKeys: [],
    destinationKey: data.v3.USER_DATA_KEY,
    isLegacyMirrorStale: false,
  }
}
