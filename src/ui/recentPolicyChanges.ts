import * as vscode from "vscode"

import type { CourseAiPolicy } from "../../shared/generated/langs"
import type { CourseIdentifier, LocalCourseData } from "../../shared/lib"
import {
  aiAssistanceSentence,
  aiPolicyRule,
  CourseIdentifier as CourseIdentifierNs,
  LocalCourseData as LocalCourseDataNs,
} from "../../shared/lib"
import { isAiAllowed } from "../api/aiRestriction"

interface PolicyChange {
  policy: CourseAiPolicy
  sentence: string
}

/**
 * The AI-policy changes a refresh found, per course, until the student dismisses the course
 * home's notice of them: the workspace follows a new policy silently, so it must leave a trace.
 * In memory, so a new window starts without one.
 */
class RecentPolicyChanges {
  private readonly _byCourse = new Map<string, PolicyChange>()
  private readonly _changed = new vscode.EventEmitter<void>()

  /** Fires after {@link addChangeOf} or {@link dismiss}. */
  public readonly onDidChange = this._changed.event

  /**
   * What changed in `course`, as a sentence; `undefined` when nothing did, it was dismissed, or
   * the course, as stored now, no longer has the policy the change was to.
   */
  public get(course: LocalCourseData): string | undefined {
    const change = this._byCourse.get(CourseIdentifierNs.key(LocalCourseDataNs.getCourseId(course)))
    return course.kind === "mooc" && change?.policy === course.data.aiPolicy
      ? change.sentence
      : undefined
  }

  /**
   * Records that `course`, as stored now, changed its AI policy, replacing an earlier change.
   *
   * @returns The sentence recorded; `undefined` for a tmc.mooc.fi course, which has no policy,
   * and for a change to no policy, which says nothing although it keeps AI assistance off.
   */
  public addChangeOf(course: LocalCourseData): string | undefined {
    const courseId = LocalCourseDataNs.getCourseId(course)
    if (course.kind !== "mooc") {
      return undefined
    }
    const rule = aiPolicyRule(course.data.aiPolicy)
    if (rule === undefined) {
      this.dismiss(courseId)
      return undefined
    }
    const sentence = `${rule} ${aiAssistanceSentence(isAiAllowed(course))}`
    this._byCourse.set(CourseIdentifierNs.key(courseId), {
      policy: course.data.aiPolicy,
      sentence,
    })
    this._changed.fire()
    return sentence
  }

  public dismiss(courseId: CourseIdentifier): void {
    if (this._byCourse.delete(CourseIdentifierNs.key(courseId))) {
      this._changed.fire()
    }
  }
}

export const recentPolicyChanges = new RecentPolicyChanges()
