import * as _ from "lodash"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"

import type { CourseIdentifier, LocalCourseExercise } from "../shared/shared"
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
  // maps instance ids to course data
  private _moocCourses: Map<string, MoocLocalCourseData>
  // keyed by a backend-qualified string (see `passedExerciseKey`), never by the
  // ExerciseIdentifier object itself — a `Set` of objects only ever matches on
  // reference identity, so membership would silently never hit.
  private _passedExercises = new Set<string>()
  private _storage: Storage
  public constructor(storage: Storage) {
    const persistentData = storage.getUserData()
    if (persistentData) {
      this._tmcCourses = new Map(persistentData.courses.map((x) => [x.id, x]))
      this._moocCourses = new Map(persistentData.mooc_courses.map((x) => [x.id, x]))

      persistentData.courses.forEach((x) =>
        x.exercises.forEach((y) => {
          if (y.passed) {
            this._passedExercises.add(passedExerciseKey(ExerciseIdentifier.from(y.id)))
          }
        }),
      )
      persistentData.mooc_courses.forEach((x) =>
        x.exercises.forEach((y) => {
          if (y.passed) {
            this._passedExercises.add(passedExerciseKey(ExerciseIdentifier.from(y.id)))
          }
        }),
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

  public getCourse(id: CourseIdentifier): LocalCourseData {
    switch (id.kind) {
      case "tmc": {
        const course = this._tmcCourses.get(id.data.courseId)
        if (!course) {
          throw new Error("nonexistent course")
        }
        return makeTmcKind(course)
      }
      case "mooc": {
        const course = this._moocCourses.get(id.data.instanceId)
        if (!course) {
          throw new Error("nonexistent course")
        }
        return makeMoocKind(course)
      }
      default: {
        assertUnreachable(id)
      }
    }
  }

  public getCourseBySlug(slug: string): LocalCourseData {
    for (const course of this._tmcCourses.values()) {
      if (course.name === slug) {
        return makeTmcKind(course)
      }
    }
    for (const course of this._moocCourses.values()) {
      if (course.name === slug) {
        return makeMoocKind(course)
      }
    }
    throw new Error("nonexistent course")
  }

  public getTmcCourse(id: number): Readonly<TmcLocalCourseData> {
    const course = this._tmcCourses.get(id)
    return course as TmcLocalCourseData
  }

  public getTmcCourseByName(name: string): Readonly<TmcLocalCourseData> | undefined {
    return this.getTmcCourses().find((x) => x.name === name)
  }

  public getExerciseByName(
    courseSlug: string,
    exerciseName: string,
  ): Readonly<LocalCourseExercise> | undefined {
    for (const course of this._tmcCourses.values()) {
      if (course.name === courseSlug) {
        const exercise = course.exercises.find((x) => x.name === exerciseName)
        return exercise ? makeTmcKind(exercise) : undefined
      }
    }
    for (const course of this._moocCourses.values()) {
      if (course.name === courseSlug) {
        const exercise = course.exercises.find((x) => x.name === exerciseName)
        return exercise ? makeMoocKind(exercise) : undefined
      }
    }
    return undefined
  }

  public getTmcExerciseByName(
    courseSlug: string,
    exerciseName: string,
  ): Readonly<TmcLocalCourseExercise> | undefined {
    for (const course of this._tmcCourses.values()) {
      if (course.name === courseSlug) {
        return course.exercises.find((x) => x.name === exerciseName)
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
        return course.exercises.find((x) => x.name === exerciseName)
      }
    }
    return undefined
  }

  public async setExerciseAsPassed(courseSlug: string, exerciseName: string): Promise<void> {
    for (const course of this._tmcCourses.values()) {
      if (course.name === courseSlug) {
        const exercise = course.exercises.find((x) => x.name === exerciseName)
        if (exercise) {
          exercise.passed = true
          await this._updatePersistentData()
          break
        }
      }
    }
  }

  public addCourse(data: LocalCourseData): void {
    switch (data.kind) {
      case "tmc": {
        const course = data
        if (this._tmcCourses.has(course.data.id)) {
          throw new Error("Trying to add an already existing course")
        }
        Logger.info(`Adding course ${course.data.name} to My Courses`)
        this._tmcCourses.set(course.data.id, course.data)
        break
      }
      case "mooc": {
        const course = data
        if (this._moocCourses.has(course.data.id)) {
          throw new Error("Trying to add an already existing course")
        }
        Logger.info(`Adding course ${course.data.name} to My Courses`)
        this._moocCourses.set(course.data.id, course.data)
        break
      }
      default: {
        assertUnreachable(data)
      }
    }
    this._updatePersistentData()
  }

  public addMoocCourse(data: MoocLocalCourseData): void {
    if (this._moocCourses.has(data.id)) {
      throw new Error("Trying to add an already existing course")
    }
    Logger.info(`Adding course ${data.name} to My Courses`)
    this._moocCourses.set(data.id, data)
    this._updatePersistentData()
  }

  public deleteCourse(id: CourseIdentifier): void {
    match(
      id,
      (tmc) => {
        this._tmcCourses.delete(tmc.courseId)
      },
      (mooc) => {
        this._moocCourses.delete(mooc.instanceId)
      },
    )
    this._updatePersistentData()
  }

  public async updateCourse(data: LocalCourseData): Promise<void> {
    switch (data.kind) {
      case "tmc": {
        const course = data
        if (!this._tmcCourses.has(course.data.id)) {
          throw new Error("Trying to fetch course that doesn't exist.")
        }
        this._tmcCourses.set(course.data.id, course.data)
        break
      }
      case "mooc": {
        const course = data
        if (!this._moocCourses.has(course.data.id)) {
          throw new Error("Trying to fetch course that doesn't exist.")
        }
        this._moocCourses.set(course.data.id, course.data)
        break
      }
      default: {
        assertUnreachable(data)
      }
    }
    await this._updatePersistentData()
  }

  public async updateExercises(
    courseId: CourseIdentifier,
    exercises: LocalCourseExercise[],
  ): Promise<Result<void, Error>> {
    const courseData = this.getCourse(courseId)
    if (!courseData) {
      return new Err(new Error(`Course data missing for ${courseId}`))
    }
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
    exercises.forEach((x) => {
      const key = passedExerciseKey(ExerciseIdentifier.from(x.data.id))
      return x.data.passed ? this._passedExercises.add(key) : this._passedExercises.delete(key)
    })
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
    // persisting is all that's left. Calling addCourse here would throw, since
    // the course already exists.
    await this._updatePersistentData()
    return Ok.EMPTY
  }

  public async updatePoints(
    courseId: number,
    awardedPoints: number,
    availablePoints: number,
  ): Promise<Result<void, Error>> {
    const courseData = this._tmcCourses.get(courseId)
    if (!courseData) {
      return new Err(new Error(`Course data missing for ${courseId}`))
    }
    courseData.awardedPoints = awardedPoints
    courseData.availablePoints = availablePoints
    this._tmcCourses.set(courseId, courseData)
    await this._updatePersistentData()
    return Ok.EMPTY
  }

  public getPassed(exerciseId: ExerciseIdentifier): boolean {
    return this._passedExercises.has(passedExerciseKey(exerciseId))
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
    let courseData = this.getCourse(courseId)
    if (!courseData) {
      return new Err(new Error(`Course data missing for ${courseId}`))
    }
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
    await this._updatePersistentData()
    return Ok.EMPTY
  }

  /**
   * Sets a timeout for when the user can be notified about the given course the next time.
   *
   * @param courseId ID of the course where the notification timeout is being set.
   * @param dateInMillis Next possible notification date, in milliseconds.
   */
  public async setNotifyDate(
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
    await this._updatePersistentData()
    return Ok.EMPTY
  }

  /**
   * Tries to set all storage data to undefined.
   */
  public async wipeDataFromStorage(): Promise<void> {
    return this._storage.wipeStorage()
  }

  private _updatePersistentData(): Promise<void> {
    return this._storage.updateUserData({
      courses: Array.from(this._tmcCourses.values()),
      mooc_courses: Array.from(this._moocCourses.values()),
    })
  }
}
