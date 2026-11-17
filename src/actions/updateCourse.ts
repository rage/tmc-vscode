import type { Result } from "ts-results"
import { Ok } from "ts-results"

import type { BackendKind, CourseAccessLoss, CourseIdentifier, Enum } from "../../shared/lib"
import { backendName, LocalCourseData, makeMoocKind, makeTmcKind, match } from "../../shared/lib"
import type Langs from "../api/langs"
import type { OperationWarning, Warned } from "../api/withOperation"
import {
  ConnectionError,
  ForbiddenError,
  InsufficientScopeError,
  NotFoundError,
  ServerError,
  TmcLoginNotAcceptedError,
} from "../errors"
import type { MoocLocalCourseData, TmcLocalCourseData } from "../storage/data"
import { downloadFailures } from "../ui/downloadFailures"
import { Logger } from "../utilities"
import { toStoredMoocCourse, toStoredTmcCourse } from "../utilities/apiData"
import { recordCourseAccessLoss } from "./courseAccess"
import type { ReadyActionContext } from "./types"

/**
 * A course to fetch. `previous` is the stored course a refresh replaces, whose user-side
 * fields carry over; an add has none. A tmc course's data does not name the organization
 * it was picked from, so the caller does.
 */
export type CourseSource = Enum<
  { courseId: number; organization: string; previous?: TmcLocalCourseData | undefined },
  { courseId: string; previous?: MoocLocalCourseData | undefined }
>

/** Fetches a course from its backend, in the form it is stored in. */
export async function fetchStoredCourse(
  langs: Langs,
  source: CourseSource,
  options?: { forceRefresh?: boolean },
): Promise<Result<LocalCourseData, Error>> {
  return match(
    source,
    async (tmc) =>
      (await langs.getTmcCourseData(tmc.courseId, options)).map((data) =>
        makeTmcKind(toStoredTmcCourse(data, tmc.organization, tmc.previous)),
      ),
    async (mooc) =>
      (await langs.getMoocCourseData(mooc.courseId, options)).map((data) =>
        makeMoocKind(toStoredMoocCourse(data, mooc.previous)),
      ),
  )
}

/**
 * The warning that `backend` refuses the user's session, or none until it serves them again.
 *
 * `updateCourse` runs once per course and from a half-hourly background poll, so an
 * unguarded warning would repeat for every course on every refresh.
 */
function sessionRefusalWarnings(
  { authState }: ReadyActionContext,
  backend: BackendKind,
  error: Error,
): OperationWarning[] {
  if (authState.sessionRefusalsReported.has(backend)) {
    return []
  }
  authState.sessionRefusalsReported.add(backend)
  return [{ headline: "Failed to update course data.", error }]
}

/** A course whose AI-use policy a refresh found changed. */
export interface AiPolicyChange {
  /** The course as stored now, with its new policy. */
  course: LocalCourseData
}

/** What {@link updateCourse} did. */
export interface CourseUpdate extends Warned {
  /** Whether the backend's data was received and stored. */
  isUpdated: boolean
  aiPolicyChange?: AiPolicyChange
}

/**
 * The ids of the courses.mooc.fi courses the student is enrolled on, as the backend lists them,
 * or why they could not be listed. The course's own data does not tell: it is served to anyone
 * who may view the course.
 */
export type MoocEnrollments = Result<ReadonlySet<string>, Error>

/** Lists the student's courses.mooc.fi enrollments for {@link updateCourse}. */
export async function fetchMoocEnrollments(langs: Langs): Promise<MoocEnrollments> {
  const enrolled = await langs.getEnrolledMoocCourses()
  if (enrolled.err) {
    Logger.warn("Failed to list the courses the student is enrolled on.", enrolled.val)
  }
  return enrolled.map((courses) => new Set(courses.map((course) => course.id)))
}

/**
 * Updates the given course by re-fetching all data from the server. Handles authorization and
 * connection errors as successful operations where the data was not actually updated.
 *
 * A backend that refuses the course itself, or no longer has it, marks it with its access loss
 * (see `recordCourseAccessLoss`); one that serves it again clears the mark.
 *
 * Local exercises are **not** rescanned; the caller runs `refreshLocalExercises` once it has
 * updated every course it means to, so a rescan does not repeat per course.
 *
 * @param courseId ID of the course to update.
 * @param moocEnrollments The student's enrollments, when a caller updating several courses has
 * listed them once; a mooc course's update lists them itself otherwise.
 */
export async function updateCourse(
  actionContext: ReadyActionContext,
  courseId: CourseIdentifier,
  moocEnrollments?: MoocEnrollments,
): Promise<Result<CourseUpdate, Error>> {
  const { exerciseDecorationProvider, langs, userData, workspaceManager } = actionContext.startup
  Logger.info("Updating course")

  const storedCourse = userData.getCourse(courseId)
  if (storedCourse.err) {
    return storedCourse
  }
  const courseData = storedCourse.val
  const [updateResult, enrollments] = await Promise.all([
    fetchStoredCourse(
      langs,
      match(
        courseData,
        (tmc) => makeTmcKind({ courseId: tmc.id, organization: tmc.organization, previous: tmc }),
        (mooc) => makeMoocKind({ courseId: mooc.id, previous: mooc }),
      ),
      { forceRefresh: true },
    ),
    courseData.kind === "mooc"
      ? (moocEnrollments ?? fetchMoocEnrollments(langs))
      : Promise.resolve(undefined),
  ])
  if (updateResult.err) {
    const error = updateResult.val
    const accessLoss = accessLossOf(error, enrollments)
    if (accessLoss) {
      actionContext.coursesTree.setBackendReachable(courseId.kind, true)
      const recorded = await recordCourseAccessLoss(actionContext, courseData, accessLoss)
      return recorded.err ? recorded : Ok({ isUpdated: false, warnings: [] })
    }
    if (error instanceof InsufficientScopeError || error instanceof TmcLoginNotAcceptedError) {
      // Says nothing about the course, so nothing stored about it is touched.
      Logger.warn(`${backendName(courseId.kind)} refused the session.`, error)
      return Ok({
        isUpdated: false,
        warnings: sessionRefusalWarnings(actionContext, courseId.kind, error),
      })
    }
    if (error instanceof ConnectionError || error instanceof ServerError) {
      Logger.warn(`Failed to fetch data from ${backendName(courseId.kind)}, data not updated.`)
      actionContext.coursesTree.setBackendReachable(courseId.kind, false)
      return Ok({ isUpdated: false, warnings: [] })
    }
    return updateResult
  }

  actionContext.coursesTree.setBackendReachable(courseId.kind, true)
  // A refusal reported before has ended, so the next one is worth telling the user about.
  actionContext.authState.sessionRefusalsReported.delete(courseId.kind)

  const course = updateResult.val
  if (LocalCourseData.getAccessLoss(courseData) !== undefined) {
    Logger.info(`${LocalCourseData.getCourseName(course)}: access restored`)
  }
  if (course.kind === "mooc" && courseData.kind === "mooc") {
    // An enrollment list that could not be fetched leaves the last answer standing.
    const isNotEnrolled = enrollments?.ok
      ? !enrollments.val.has(course.data.id)
      : courseData.data.notEnrolled === true
    if (isNotEnrolled) {
      course.data.notEnrolled = true
    }
  }

  const stored = await userData.replaceCourse(course)
  if (stored.err) {
    return stored
  }
  // A download refused while their chapter was closed would succeed now.
  downloadFailures.forget(
    courseData.kind === "mooc"
      ? (courseData.data.closedChapters ?? [])
          .flatMap((chapter) => chapter.exercises)
          .map((exercise) => makeMoocKind({ moocExerciseId: exercise.id }))
      : [],
  )
  const isAiPolicyChanged =
    course.kind === "mooc" &&
    courseData.kind === "mooc" &&
    course.data.aiPolicy !== courseData.data.aiPolicy
  const courseName = LocalCourseData.getCourseName(course)
  if (
    courseName === workspaceManager.activeCourse &&
    course.kind === workspaceManager.activeCourseBackend
  ) {
    exerciseDecorationProvider.updateDecorationsForExercises(
      ...workspaceManager.getExercisesByCourseSlug(course.kind, courseName),
    )
  }

  return Ok({
    isUpdated: true,
    warnings: [],
    ...(isAiPolicyChanged ? { aiPolicyChange: { course } } : {}),
  })
}

/**
 * What a failed course fetch, or a course an update check could not check, says of the student's
 * access to the course, if anything. A mooc 403 is the course's only when the same session could
 * list the student's courses: tmc-langs reports every courses.mooc.fi 403 as an insufficient scope.
 */
export function accessLossOf(
  error: Error,
  moocEnrollments: MoocEnrollments | undefined,
): CourseAccessLoss["reason"] | undefined {
  if (error instanceof NotFoundError) {
    return "notFound"
  }
  if (error instanceof ForbiddenError) {
    return "forbidden"
  }
  if (error instanceof InsufficientScopeError && moocEnrollments?.ok) {
    return "forbidden"
  }
  return undefined
}
