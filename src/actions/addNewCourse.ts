import type { Result } from "ts-results"

import type { MoocExam } from "../../shared/langsSchema"
import type { CourseIdentifier } from "../../shared/lib"
import { LocalCourseData, makeMoocKind, makeTmcKind, match } from "../../shared/lib"
import { Logger } from "../utilities"
import { toStoredMoocExam } from "../utilities/apiData"
import { refreshLocalExercises } from "./refreshLocalExercises"
import type { ReadyActionContext } from "./types"
import { fetchStoredCourse } from "./updateCourse"

/**
 * Adds a new course to user's courses and shows it in the Courses view.
 *
 * @param organizationSlug The tmc organization the course was picked from;
 *   ignored for a mooc course, which carries its own.
 */
export async function addNewCourse(
  actionContext: ReadyActionContext,
  organizationSlug: string,
  course: CourseIdentifier,
): Promise<Result<void, Error>> {
  const { langs, userData, workspaceManager } = actionContext.startup
  Logger.info("Adding new course")

  const fetched = await fetchStoredCourse(
    langs,
    match(
      course,
      (tmc) => makeTmcKind({ courseId: tmc.courseId, organization: organizationSlug }),
      (mooc) => makeMoocKind({ courseId: mooc.moocCourseId }),
    ),
  )
  if (fetched.err) {
    return fetched
  }

  const addResult = await userData.addCourse(fetched.val)
  if (addResult.err) {
    return addResult
  }
  await workspaceManager.createWorkspaceFile(
    LocalCourseData.getCourseName(fetched.val),
    fetched.val.kind,
  )
  return refreshLocalExercises(actionContext)
}

/**
 * Adds a started courses.mooc.fi exam like a course of its exercises, which can be submitted
 * until the exam's answers close.
 */
export async function addMoocExam(
  actionContext: ReadyActionContext,
  exam: MoocExam,
): Promise<Result<void, Error>> {
  const { langs, userData, workspaceManager } = actionContext.startup
  Logger.info("Adding an exam")
  const slides = await langs.getMoocExamExercises(exam.id)
  if (slides.err) {
    return slides
  }
  const stored = toStoredMoocExam(
    {
      id: exam.id,
      name: examSlug(exam),
      title: exam.name,
      organization: "",
      examAnswerableUntil: exam.answerable_until,
    },
    slides.val,
  )
  const added = await userData.addCourse(makeMoocKind(stored))
  if (added.err) {
    return added
  }
  await workspaceManager.createWorkspaceFile(stored.name, "mooc")
  return refreshLocalExercises(actionContext)
}

/** A workspace name for `exam`, unique by its id. */
function examSlug(exam: MoocExam): string {
  const words = exam.name
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "")
  return `${words || "exam"}-${exam.id.slice(0, 8)}`
}
