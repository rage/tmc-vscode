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
  partition,
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

/** A stored exercise and the stored course holding it. */
export interface StoredExercise {
  course: LocalCourseData
  exercise: LocalCourseExercise
}

/** The course holding the exercise with id `exerciseId`, and that exercise. */
function findExercise<Course extends { exercises: { id: unknown }[] }>(
  courses: Map<unknown, Course>,
  exerciseId: Course["exercises"][number]["id"],
): { course: Course; exercise: Course["exercises"][number] } | undefined {
  for (const course of courses.values()) {
    const exercise = course.exercises.find((x) => x.id === exerciseId)
    if (exercise) {
      return { course, exercise }
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

      for (const course of this.getCourses()) {
        for (const exercise of LocalCourseData.getExercises(course)) {
          this._setPassed(LocalCourseExercise.getId(exercise), exercise.data.passed)
        }
      }
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
   * Looks up a stored exercise, and its course, by id.
   *
   * The returned records are the stored ones, not copies. Errs when no stored course holds
   * the exercise, e.g. for a folder left behind by a removed course.
   */
  public getExercise(id: ExerciseIdentifier): Result<StoredExercise, Error> {
    const found = match(
      id,
      (tmc) => {
        const stored = findExercise(this._tmcCourses, tmc.tmcExerciseId)
        return (
          stored && { course: makeTmcKind(stored.course), exercise: makeTmcKind(stored.exercise) }
        )
      },
      (mooc) => {
        const stored = findExercise(this._moocCourses, mooc.moocExerciseId)
        return (
          stored && { course: makeMoocKind(stored.course), exercise: makeMoocKind(stored.exercise) }
        )
      },
    )
    return found
      ? Ok(found)
      : Err(new Error(`No stored ${id.kind} exercise ${ExerciseIdentifier.toString(id)}.`))
  }

  /**
   * Records a single exercise as passed, in memory and in storage.
   *
   * Errs when the exercise is not in the catalogue, which after a passing
   * submission means the catalogue is out of step with what was submitted.
   */
  public async setExerciseAsPassed(id: ExerciseIdentifier): Promise<Result<void, Error>> {
    const stored = this.getExercise(id)
    if (stored.err) {
      return stored
    }
    stored.val.exercise.data.passed = true
    this._setPassed(id, true)
    return this._updatePersistentData()
  }

  /**
   * Records a mooc exercise's standing and points as a grading reported them, in memory and in
   * storage. Unlike {@link setExerciseAsPassed} it can also clear `passed`, as the backend decides.
   *
   * Errs when the catalogue holds no mooc exercise with this id.
   */
  public async setMoocExerciseStanding(
    id: ExerciseIdentifier,
    standing: MoocStoredStanding,
    awardedPoints: number,
  ): Promise<Result<void, Error>> {
    const stored = this.getExercise(id)
    if (stored.err) {
      return stored
    }
    const { exercise } = stored.val
    if (exercise.kind !== "mooc") {
      return Err(new Error(`Exercise ${ExerciseIdentifier.toString(id)} is not a mooc exercise.`))
    }
    exercise.data.passed = standing.passed
    exercise.data.outOfTries = standing.outOfTries
    exercise.data.awardedPoints = awardedPoints
    this._setPassed(id, standing.passed)
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
      this._setPassed(LocalCourseExercise.getId(x), x.data.passed),
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
    const newExercises = LocalCourseData.getNewExercises(courseData)
    Logger.info(`Clearing new exercises`)
    if (exercisesToClear !== undefined) {
      // A plain `difference` compares the id objects by reference and subtracts nothing.
      const unSuccessfullyDownloaded = _.differenceBy(
        newExercises,
        exercisesToClear,
        ExerciseIdentifier.key,
      )
      const remaining = partition(unSuccessfullyDownloaded)
      match(
        courseData,
        (tmc) => {
          tmc.newExercises = remaining.tmc.map((id) => id.tmcExerciseId)
        },
        (mooc) => {
          mooc.newExercises = remaining.mooc.map((id) => id.moocExerciseId)
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
