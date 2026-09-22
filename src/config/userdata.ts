import * as _ from "lodash"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type { BackendKind, CourseIdentifier, LocalCourseExercise } from "../shared/shared"
import {
  assertUnreachable,
  ExerciseIdentifier,
  makeMoocKind,
  makeTmcKind,
  match,
  LocalCourseData,
} from "../shared/shared"
import type Storage from "../storage"
import type {
  MoocLocalCourseData,
  MoocLocalCourseExercise,
  TmcLocalCourseData,
  TmcLocalCourseExercise,
} from "../storage/data"
import { Logger } from "../utilities/logger"

/**
 * Builds the primitive key under which an exercise's passed-state is tracked.
 *
 * The key is backend-qualified so that a tmc exercise and a mooc exercise whose
 * ids stringify identically (e.g. tmc `1` and mooc `"1"`) don't collide.
 */
function passedExerciseKey(id: ExerciseIdentifier): string {
  return `${id.kind}:${ExerciseIdentifier.toString(id)}`
}

export class UserData {
  private _tmcCourses: Map<number, TmcLocalCourseData>
  // keyed by course id, not slug
  private _moocCourses: Map<string, MoocLocalCourseData>
  // keyed by a backend-qualified string (see `passedExerciseKey`), never by the
  // ExerciseIdentifier object itself — a `Set` of objects only ever matches on
  // reference identity, so membership would silently never hit.
  private _passedExercises = new Set<string>()
  /** Tail of the serialized write chain; see {@link _updatePersistentData}. */
  private _pendingWrite: Promise<Result<void, Error>> = Promise.resolve(Ok.EMPTY)
  private _storage: Storage
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

  public getTmcCourse(id: number): Readonly<TmcLocalCourseData> {
    const course = this._tmcCourses.get(id)
    return course as TmcLocalCourseData
  }

  public getTmcCourseByName(name: string): Readonly<TmcLocalCourseData> | undefined {
    return this.getTmcCourses().find((x) => x.name === name)
  }

  /**
   * Looks up an exercise by course slug and exercise name **within one backend**,
   * returning it tagged with that backend.
   *
   * As with `getCourseBySlug`, the backend is required rather than inferred.
   * Every caller comes from a `WorkspaceExercise`, which already records which
   * backend the exercise on disk belongs to, so there is nothing to guess — and
   * guessing was actively wrong: the previous name-only version scanned tmc
   * courses first and returned as soon as a *course* slug matched, so a mooc
   * course sharing its slug with a tmc course could never be reached.
   */
  public getExerciseByName(
    backend: BackendKind,
    courseSlug: string,
    exerciseName: string,
  ): Readonly<LocalCourseExercise> | undefined {
    switch (backend) {
      case "tmc": {
        const exercise = this.getTmcExerciseByName(courseSlug, exerciseName)
        return exercise ? makeTmcKind(exercise) : undefined
      }
      case "mooc": {
        const exercise = this.getMoocExerciseByName(courseSlug, exerciseName)
        return exercise ? makeMoocKind(exercise) : undefined
      }
      default: {
        assertUnreachable(backend)
      }
    }
  }

  public getTmcExerciseByName(
    courseSlug: string,
    exerciseName: string,
  ): Readonly<TmcLocalCourseExercise> | undefined {
    for (const course of this._tmcCourses.values()) {
      if (course.name === courseSlug) {
        const exercise = course.exercises.find((x) => x.name === exerciseName)
        if (exercise) {
          return exercise
        }
        // Keep scanning: a matching course slug is not proof the exercise lives
        // there, and slugs are not guaranteed unique across stored entries.
      }
    }
    return undefined
  }

  public getMoocExerciseByName(
    courseSlug: string,
    exerciseName: string,
  ): Readonly<MoocLocalCourseExercise> | undefined {
    for (const course of this._moocCourses.values()) {
      if (course.name === courseSlug) {
        const exercise = course.exercises.find((x) => x.name === exerciseName)
        if (exercise) {
          return exercise
        }
        // Keep scanning: a matching course slug is not proof the exercise lives
        // there, and slugs are not guaranteed unique across stored entries.
      }
    }
    return undefined
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

  public async addCourse(data: LocalCourseData): Promise<Result<void, Error>> {
    switch (data.kind) {
      case "tmc": {
        const course = data
        if (this._tmcCourses.has(course.data.id)) {
          return Err(new Error(`Course ${course.data.name} has already been added`))
        }
        Logger.info(`Adding course ${course.data.name} to My Courses`)
        this._tmcCourses.set(course.data.id, course.data)
        break
      }
      case "mooc": {
        const course = data
        if (this._moocCourses.has(course.data.id)) {
          return Err(new Error(`Course ${course.data.name} has already been added`))
        }
        Logger.info(`Adding course ${course.data.name} to My Courses`)
        this._moocCourses.set(course.data.id, course.data)
        break
      }
      default: {
        assertUnreachable(data)
      }
    }
    return this._updatePersistentData()
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
    return this._updatePersistentData()
  }

  public async updateCourse(data: LocalCourseData): Promise<Result<void, Error>> {
    switch (data.kind) {
      case "tmc": {
        const course = data
        if (!this._tmcCourses.has(course.data.id)) {
          return Err(new Error(`No tmc course with id ${course.data.id} to update`))
        }
        this._tmcCourses.set(course.data.id, course.data)
        break
      }
      case "mooc": {
        const course = data
        if (!this._moocCourses.has(course.data.id)) {
          return Err(new Error(`No mooc course with instance id ${course.data.id} to update`))
        }
        this._moocCourses.set(course.data.id, course.data)
        break
      }
      default: {
        assertUnreachable(data)
      }
    }
    return this._updatePersistentData()
  }

  public async updateExercises(
    courseId: CourseIdentifier,
    exercises: LocalCourseExercise[],
  ): Promise<Result<void, Error>> {
    const courseResult = this.getCourse(courseId)
    if (courseResult.err) {
      return courseResult
    }
    const courseData = courseResult.val
    const courseExercises = LocalCourseData.getExercises(courseData)
    const exerciseIds = exercises.map((exercise) => exercise.data.id)
    // Filter out "new" exercises that no longer were in the API, and then append new data
    courseData.data.newExercises = match(
      courseData,
      (tmc) =>
        tmc.newExercises
          .filter((exerciseId) => exerciseIds.includes(exerciseId))
          .concat(
            exerciseIds
              .filter((eid) => typeof eid === "number")
              .filter((newExerciseId) => !courseExercises.some((e) => e.data.id === newExerciseId)),
          ),
      (mooc) =>
        mooc.newExercises
          .filter((exerciseId) => exerciseIds.includes(exerciseId))
          .concat(
            exerciseIds
              .filter((eid) => typeof eid === "string")
              .filter((newExerciseId) => !courseExercises.some((e) => e.data.id === newExerciseId)),
          ),
    )
    if (courseData.data.newExercises.length > 0) {
      Logger.info(
        `Found ${courseData.data.newExercises.length} new exercises for ${LocalCourseData.getNewExercises(courseData)}`,
      )
    }
    exercises.forEach((x) => this._setPassed(ExerciseIdentifier.from(x.data.id), x.data.passed))
    match(
      courseData,
      (tmcCourse) => {
        tmcCourse.exercises = exercises
          .map((e) =>
            match(
              e,
              (tmc) => tmc,
              () => undefined,
            ),
          )
          .filter((e) => e !== undefined)
      },
      (moocCourse) => {
        moocCourse.exercises = exercises
          .map((e) =>
            match(
              e,
              () => undefined,
              (mooc) => mooc,
            ),
          )
          .filter((e) => e !== undefined)
      },
    )
    // `courseData.data` is the same object held by the backing map (getCourse
    // wraps the stored reference), so the mutations above are already in place;
    // persisting is all that's left. Calling addCourse here would err, since
    // the course already exists.
    return this._updatePersistentData()
  }

  public getPassed(exerciseId: ExerciseIdentifier): boolean {
    return this._passedExercises.has(passedExerciseKey(exerciseId))
  }

  /** The only writer of `_passedExercises`, so the set cannot drift from the stored flags. */
  private _setPassed(exerciseId: ExerciseIdentifier, passed: boolean): void {
    const key = passedExerciseKey(exerciseId)
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
      // `ExerciseIdentifier`s are tagged-union objects, so a plain `difference`
      // compares them by reference and never subtracts anything — diff by their
      // string form instead.
      const unSuccessfullyDownloaded = _.differenceBy(
        newExercises,
        exercisesToClear,
        ExerciseIdentifier.toString,
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
    return this._updatePersistentData()
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
      return new Err(new Error(`Course data missing for ${courseId}`))
    }
    Logger.info(`Notifying user for course again at ${new Date(dateInMillis).toString()}`)
    courseData.notifyAfter = dateInMillis
    return this._updatePersistentData()
  }

  /**
   * Tries to set all storage data to undefined.
   */
  public async wipeDataFromStorage(): Promise<Result<void, Error>> {
    try {
      await this._storage.wipeStorage()
      return Ok.EMPTY
    } catch (e) {
      return Err(e instanceof Error ? e : new Error(String(e)))
    }
  }

  /**
   * Writes the whole catalogue back to storage.
   *
   * The in-memory maps are already mutated by the time this runs, so an `Err`
   * means the two copies have diverged and the caller must tell the user —
   * dropping it silently reverts their action at the next restart.
   *
   * Every write rewrites the entire catalogue, so concurrent callers are chained
   * onto one another rather than run in parallel; without that, two overlapping
   * background refreshes each persist their own snapshot and the later write
   * silently drops the earlier one's changes.
   */
  private async _updatePersistentData(): Promise<Result<void, Error>> {
    const snapshot = {
      courses: Array.from(this._tmcCourses.values()),
      mooc_courses: Array.from(this._moocCourses.values()),
    }
    const write = this._pendingWrite.then(async (): Promise<Result<void, Error>> => {
      try {
        await this._storage.updateUserData(snapshot)
        return Ok.EMPTY
      } catch (e) {
        return Err(e instanceof Error ? e : new Error(String(e)))
      }
    })
    this._pendingWrite = write
    return write
  }
}
