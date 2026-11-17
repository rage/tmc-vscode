import * as vscode from "vscode"

import type { CourseIdentifier, LocalCourseData } from "../../shared/lib"
import {
  aiAssistanceSentence,
  aiPolicyRule,
  CourseIdentifier as CourseIdentifierNs,
  LocalCourseData as LocalCourseDataNs,
} from "../../shared/lib"
import { isAiAllowed } from "../api/aiRestriction"

/**
 * The AI-policy changes a refresh found, per course, until the student dismisses the course
 * home's notice of them: the workspace follows a new policy silently, so it must leave a trace.
 * In memory, so a new window starts without one.
 */
class RecentPolicyChanges {
  private readonly _byCourse = new Map<string, string>()
  private readonly _changed = new vscode.EventEmitter<void>()

  /** Fires after {@link add} or {@link dismiss}. */
  public readonly onDidChange = this._changed.event

  /** What changed, as a sentence; `undefined` when nothing did or it was dismissed. */
  public get(courseId: CourseIdentifier): string | undefined {
    return this._byCourse.get(CourseIdentifierNs.key(courseId))
  }

  /** @param sentence The new policy and what it does to AI assistance; replaces an earlier one. */
  public add(courseId: CourseIdentifier, sentence: string): void {
    this._byCourse.set(CourseIdentifierNs.key(courseId), sentence)
    this._changed.fire()
  }

  /**
   * Records that `course`, as stored now, changed its AI policy.
   *
   * @returns The sentence recorded; `undefined` for a tmc.mooc.fi course, which has no policy.
   */
  public addChangeOf(course: LocalCourseData): string | undefined {
    if (course.kind !== "mooc") {
      return undefined
    }
    const sentence = [aiPolicyRule(course.data.aiPolicy), aiAssistanceSentence(isAiAllowed(course))]
      .filter((part) => part !== undefined)
      .join(" ")
    this.add(LocalCourseDataNs.getCourseId(course), sentence)
    return sentence
  }

  public dismiss(courseId: CourseIdentifier): void {
    if (this._byCourse.delete(CourseIdentifierNs.key(courseId))) {
      this._changed.fire()
    }
  }
}

export const recentPolicyChanges = new RecentPolicyChanges()
