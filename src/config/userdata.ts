import * as _ from "lodash"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import * as vscode from "vscode"

import type { BackendKind } from "../shared/shared"
import {
  assertUnreachable,
  CourseIdentifier,
  ExerciseIdentifier,
  LocalCourseExercise,
  makeMoocKind,
  makeTmcKind,
  match,
  LocalCourseData,
  toError,
} from "../shared/shared"
import type Storage from "../storage"
import type { MoocLocalCourseData, TmcLocalCourseData } from "../storage/data"
import type { MoocStoredStanding } from "../utilities/apiData"
import { Logger } from "../utilities/logger"

interface StoredCourse<Id> {
  exercises: { id: Id }[]
  newExercises: Id[]
}

/**
 * Puts `refreshed` in `courses` in place of the course stored under `id`, carrying over which
 * exercises are new. Returns whether a course was stored there.
 */
function replaceIn<Id, Course extends StoredCourse<Id>>(
  courses: Map<Id, Course>,
  id: Id,
  refreshed: Course,
): boolean {
  const stored = courses.get(id)
  if (!stored) {
    return false
  }
  const refreshedIds = new Set(refreshed.exercises.map((exercise) => exercise.id))
  const storedIds = new Set(stored.exercises.map((exercise) => exercise.id))
  refreshed.newExercises = _.uniq([
    ...stored.newExercises.filter((exerciseId) => refreshedIds.has(exerciseId)),
    ...[...refreshedIds].filter((exerciseId) => !storedIds.has(exerciseId)),
  ])
  courses.set(id, refreshed)
  return true
}

/**
 * The exercise named `exerciseName` in a course with slug `courseSlug`. Searches every such
 * course: stored slugs are not guaranteed unique, and the first match need not hold the
 * exercise.
 */
function findExerciseByName<Exercise extends { name: string }>(
  courses: Map<unknown, { name: string; exercises: Exercise[] }>,
  courseSlug: string,
  exerciseName: string,
): Exercise | undefined {
  for (const course of courses.values()) {
    if (course.name === courseSlug) {
      const exercise = course.exercises.find((x) => x.name === exerciseName)
      if (exercise) {
        return exercise
      }
    }
  }
  return undefined
}

export class UserData {
  private _tmcCourses: Map<number, TmcLocalCourseData>
  // keyed by course id, not slug
  private _moocCourses: Map<string, MoocLocalCourseData>
  // keyed by `ExerciseIdentifier.key`: a `Set` of id objects matches on reference only
  private _passedExercises = new Set<string>()
  /** Tail of the serialized write chain; see {@link _enqueueWrite}. */
  private _pendingWrite: Promise<Result<void, Error>> = Promise.resolve(Ok.EMPTY)
  private _storage: Storage
  private readonly _coursesChanged = new vscode.EventEmitter<CourseIdentifier | undefined>()

  /**
   * Fires after any change to the stored courses, as soon as memory holds it: before it is
   * persisted, and even when persisting then fails. Carries the changed course, or
   * `undefined` when any course may have changed.
   */
  public readonly onDidChangeCourses = this._coursesChanged.event

  public constructor(storage: Storage) {
    const persistentData = storage.getUserData()
    if (persistentData) {
      this._tmcCourses = new Map(persistentData.courses.map((x) => [x.id, x]))
      this._moocCourses = new Map(persistentData.mooc_courses.map((x) => [x.id, x]))

      persistentData.courses.forEach((x) =>
        x.exercises.forEach((y) => this._setPassed(ExerciseIdentifier.from(y.id), y.passed)),
      )
      persistentData.mooc_courses.forEach((x) =>
        x.exercises.forEach((y) => this._setPassed(ExerciseIdentifier.from(y.id), y.passed)),
      )
    } else {
      this._tmcCourses = new Map()
      this._moocCourses = new Map()
    }
    this._storage = storage
  }

  public getCourses(): LocalCourseData[] {
    const tmc = this.getTmcCourses().map<LocalCourseData>((x) => makeTmcKind(x))
    const mooc = this.getMoocCourses().map<LocalCourseData>((x) => makeMoocKind(x))
    return tmc.concat(mooc)
  }

  public getTmcCourses(): TmcLocalCourseData[] {
    return Array.from(this._tmcCourses.values())
  }

  public getMoocCourses(): MoocLocalCourseData[] {
    return Array.from(this._moocCourses.values())
  }

  /**
   * Looks up a stored course by its identifier.
   *
   * Errs when the course is unknown, which is reachable: identifiers arrive from
   * webview messages and from workspaces on disk, so they outlive a course the
   * user has removed.
   */
  public getCourse(id: CourseIdentifier): Result<LocalCourseData, Error> {
    switch (id.kind) {
      case "tmc": {
        const course = this._tmcCourses.get(id.data.courseId)
        return course
          ? Ok(makeTmcKind(course))
          : Err(new Error(`No tmc course with id ${id.data.courseId}`))
      }
      case "mooc": {
        const course = this._moocCourses.get(id.data.instanceId)
        return course
          ? Ok(makeMoocKind(course))
          : Err(new Error(`No mooc course with instance id ${id.data.instanceId}`))
      }
      default: {
        assertUnreachable(id)
      }
    }
  }

  /**
   * Looks up a course by its slug **within one backend**.
   *
   * Slugs are only unique per backend: the legacy TMC server and
   * `courses.mooc.fi` can each have a course called e.g. `python-programming`.
   * The backend is therefore a required argument. A name-only lookup would have
   * to pick a scan order, and whichever backend came first would silently
   * shadow the other backend's course of the same slug.
   */
  public getCourseBySlug(backend: BackendKind, slug: string): Result<LocalCourseData, Error> {
    switch (backend) {
      case "tmc": {
        for (const course of this._tmcCourses.values()) {
          if (course.name === slug) {
            return Ok(makeTmcKind(course))
          }
        }
        break
      }
      case "mooc": {
        for (const course of this._moocCourses.values()) {
          if (course.name === slug) {
            return Ok(makeMoocKind(course))
          }
        }
        break
      }
      default: {
        assertUnreachable(backend)
      }
    }
    return Err(new Error(`No ${backend} course with slug ${slug}`))
  }

  /**
   * Looks up an exercise by course slug and exercise name **within one backend**,
   * returning it tagged with that backend.
   *
   * As with `getCourseBySlug`, the backend is required rather than inferred: a
   * mooc course can share its slug with a tmc course. Every caller comes from a
   * `WorkspaceExercise`, which already records the backend.
   */
  public getExerciseByName(
    backend: BackendKind,
    courseSlug: string,
    exerciseName: string,
  ): LocalCourseExercise | undefined {
    switch (backend) {
      case "tmc": {
        const exercise = findExerciseByName(this._tmcCourses, courseSlug, exerciseName)
        return exercise && makeTmcKind(exercise)
      }
      case "mooc": {
        const exercise = findExerciseByName(this._moocCourses, courseSlug, exerciseName)
        return exercise && makeMoocKind(exercise)
      }
      default: {
        assertUnreachable(backend)
      }
    }
  }

  /**
   * Records a single exercise as passed, in memory and in storage.
   *
   * Errs when the named exercise is not in the catalogue, which after a passing
   * submission means the catalogue is out of step with what was submitted.
   */
  public async setExerciseAsPassed(
    backend: BackendKind,
    courseSlug: string,
    exerciseName: string,
  ): Promise<Result<void, Error>> {
    const exercise = this.getExerciseByName(backend, courseSlug, exerciseName)
    if (!exercise) {
      return Err(
        new Error(`No ${backend} exercise ${courseSlug}/${exerciseName} to record as passed`),
      )
    }
    // `getExerciseByName` hands back the stored record, not a copy, so writing
    // through it is what updates the catalogue.
    exercise.data.passed = true
    this._setPassed(ExerciseIdentifier.from(exercise.data.id), true)
    return this._updatePersistentData()
  }

  /**
   * Records a mooc exercise's standing and points as a grading reported them, in memory and in
   * storage. Unlike {@link setExerciseAsPassed} it can also clear `passed`, as the backend decides.
   *
   * Errs when the named exercise is not in the catalogue.
   */
  public async setMoocExerciseStanding(
    courseSlug: string,
    exerciseName: string,
    standing: MoocStoredStanding,
    awardedPoints: number,
  ): Promise<Result<void, Error>> {
    const exercise = findExerciseByName(this._moocCourses, courseSlug, exerciseName)
    if (!exercise) {
      return Err(
        new Error(`No mooc exercise ${courseSlug}/${exerciseName} to record a grading for`),
      )
    }
    // The stored record, not a copy, so writing through it updates the catalogue.
    exercise.passed = standing.passed
    exercise.outOfTries = standing.outOfTries
    exercise.awardedPoints = awardedPoints
    this._setPassed(ExerciseIdentifier.from(exercise.id), standing.passed)
    return this._updatePersistentData()
  }

  public async addCourse(data: LocalCourseData): Promise<Result<void, Error>> {
    switch (data.kind) {
      case "tmc": {
        const course = data
        if (this._tmcCourses.has(course.data.id)) {
          return Err(new Error(`Course ${course.data.name} has already been added`))
        }
        Logger.info(`Adding course ${course.data.name} to the stored courses`)
        this._tmcCourses.set(course.data.id, course.data)
        break
      }
      case "mooc": {
        const course = data
        if (this._moocCourses.has(course.data.id)) {
          return Err(new Error(`Course ${course.data.name} has already been added`))
        }
        Logger.info(`Adding course ${course.data.name} to the stored courses`)
        this._moocCourses.set(course.data.id, course.data)
        break
      }
      default: {
        assertUnreachable(data)
      }
    }
    LocalCourseData.getExercises(data).forEach((x) =>
      this._setPassed(ExerciseIdentifier.from(x.data.id), x.data.passed),
    )
    return this._updatePersistentData(LocalCourseData.getCourseId(data))
  }

  public async deleteCourse(id: CourseIdentifier): Promise<Result<void, Error>> {
    match(
      id,
      (tmc) => {
        this._tmcCourses.delete(tmc.courseId)
      },
      (mooc) => {
        this._moocCourses.delete(mooc.instanceId)
      },
    )
    return this._updatePersistentData(id)
  }

  /**
   * Replaces a stored course, exercises included, with a refreshed copy in one write.
   *
   * Exercises the stored copy lacks are recorded as new, and new exercises the refreshed
   * copy no longer lists are dropped; the refreshed copy's own `newExercises` is ignored.
   * Errs when the course is not stored.
   */
  public async replaceCourse(course: LocalCourseData): Promise<Result<void, Error>> {
    const courseId = LocalCourseData.getCourseId(course)
    const replaced = match(
      course,
      (tmc) => replaceIn(this._tmcCourses, tmc.id, tmc),
      (mooc) => replaceIn(this._moocCourses, mooc.id, mooc),
    )
    if (!replaced) {
      return Err(new Error(`No course ${CourseIdentifier.toString(courseId)} to replace`))
    }
    if (course.data.newExercises.length > 0) {
      Logger.info(`${course.data.name} has ${course.data.newExercises.length} new exercises`)
    }
    LocalCourseData.getExercises(course).forEach((x) =>
      this._setPassed(LocalCourseExercise.getId(x), x.data.passed),
    )
    return this._updatePersistentData(courseId)
  }

  public getPassed(exerciseId: ExerciseIdentifier): boolean {
    return this._passedExercises.has(ExerciseIdentifier.key(exerciseId))
  }

  /** The only writer of `_passedExercises`, so the set cannot drift from the stored flags. */
  private _setPassed(exerciseId: ExerciseIdentifier, passed: boolean): void {
    const key = ExerciseIdentifier.key(exerciseId)
    if (passed) {
      this._passedExercises.add(key)
    } else {
      this._passedExercises.delete(key)
    }
  }

  /**
   * Clears the list of new exercises for a given course.
   *
   * If given a list of exercise ids clears these from the course.newExercises array
   *
   * @param courseId
   * @param exercisesToClear Number list of exercises to clear.
   */
  public async clearFromNewExercises(
    courseId: CourseIdentifier,
    exercisesToClear?: ExerciseIdentifier[],
  ): Promise<Result<void, Error>> {
    const courseResult = this.getCourse(courseId)
    if (courseResult.err) {
      return courseResult
    }
    const courseData = courseResult.val
    const newExercises = courseData.data.newExercises.map(ExerciseIdentifier.from)
    Logger.info(`Clearing new exercises`)
    if (exercisesToClear !== undefined) {
      // A plain `difference` compares the id objects by reference and subtracts nothing.
      const unSuccessfullyDownloaded = _.differenceBy(
        newExercises,
        exercisesToClear,
        ExerciseIdentifier.key,
      )
      // Write the remainder back to the course's own backend-typed array,
      // always — including down to an empty list when everything was cleared.
      match(
        courseData,
        (tmc) => {
          tmc.newExercises = unSuccessfullyDownloaded
            .map((id) =>
              match(
                id,
                (t) => t.tmcExerciseId,
                () => undefined,
              ),
            )
            .filter((id) => id !== undefined)
        },
        (mooc) => {
          mooc.newExercises = unSuccessfullyDownloaded
            .map((id) =>
              match(
                id,
                () => undefined,
                (m) => m.moocExerciseId,
              ),
            )
            .filter((id) => id !== undefined)
        },
      )
      if (unSuccessfullyDownloaded.length === 0) {
        courseData.data.notifyAfter = 0
      }
    } else {
      courseData.data.newExercises = []
      courseData.data.notifyAfter = 0
    }
    return this._updatePersistentData(courseId)
  }

  /**
   * Throttles the new-exercise notification for a course until `dateInMillis`.
   *
   * Only the toast is suppressed; the course data refresh ignores this.
   *
   * @param dateInMillis Epoch milliseconds before which not to notify again.
   */
  public async setNewExerciseNotifyAfter(
    courseId: CourseIdentifier,
    dateInMillis: number,
  ): Promise<Result<void, Error>> {
    const courseData = match(
      courseId,
      (tmc) => this._tmcCourses.get(tmc.courseId),
      (mooc) => this._moocCourses.get(mooc.instanceId),
    )
    if (!courseData) {
      return new Err(new Error(`Course data missing for ${CourseIdentifier.toString(courseId)}`))
    }
    Logger.info(`Notifying user for course again at ${new Date(dateInMillis).toString()}`)
    courseData.notifyAfter = dateInMillis
    return this._updatePersistentData(courseId)
  }

  /**
   * Forgets every course, in memory and in storage.
   *
   * Runs after any write already queued, so none of them can put the wiped data back.
   */
  public async wipeDataFromStorage(): Promise<Result<void, Error>> {
    this._tmcCourses.clear()
    this._moocCourses.clear()
    this._passedExercises.clear()
    this._coursesChanged.fire(undefined)
    return this._enqueueWrite(() => this._storage.wipeStorage())
  }

  /**
   * Announces the change the in-memory maps hold, and writes the whole catalogue back to
   * storage.
   *
   * The in-memory maps are already mutated by the time this runs, so an `Err`
   * means the two copies have diverged and the caller must tell the user —
   * dropping it silently reverts their action at the next restart.
   */
  private async _updatePersistentData(
    changedCourse?: CourseIdentifier,
  ): Promise<Result<void, Error>> {
    this._coursesChanged.fire(changedCourse)
    const snapshot = {
      courses: Array.from(this._tmcCourses.values()),
      mooc_courses: Array.from(this._moocCourses.values()),
    }
    return this._enqueueWrite(() => this._storage.updateUserData(snapshot))
  }

  /**
   * Runs `write` after every storage write queued before it. Each write replaces the whole
   * catalogue, so two overlapping ones would otherwise let the later drop the earlier's
   * changes.
   */
  private _enqueueWrite(write: () => Promise<void>): Promise<Result<void, Error>> {
    const queued = this._pendingWrite.then(async (): Promise<Result<void, Error>> => {
      try {
        await write()
        return Ok.EMPTY
      } catch (e) {
        return Err(toError(e))
      }
    })
    this._pendingWrite = queued
    return queued
  }
}

/**
 * The stored course and exercise a downloaded exercise belongs to.
 *
 * @returns `Err` when the course or the exercise is not stored, e.g. a folder left behind
 * by a removed course.
 */
export function findStoredExercise(
  userData: Pick<UserData, "getCourseBySlug">,
  exercise: { backend: BackendKind; courseSlug: string; exerciseSlug: string },
): Result<{ course: LocalCourseData; exercise: LocalCourseExercise }, Error> {
  const course = userData.getCourseBySlug(exercise.backend, exercise.courseSlug)
  if (course.err) {
    return course
  }
  const stored = LocalCourseData.getExercises(course.val).find(
    (x) => LocalCourseExercise.getSlug(x) === exercise.exerciseSlug,
  )
  return stored
    ? Ok({ course: course.val, exercise: stored })
    : Err(
        new Error(`ID for exercise ${exercise.courseSlug}/${exercise.exerciseSlug} was not found.`),
      )
}
