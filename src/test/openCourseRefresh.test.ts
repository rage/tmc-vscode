import { vi } from "vitest"
import * as vscode from "vscode"

import type { CourseIdentifier } from "../../shared/lib"
import {
  FOCUS_REFRESH_INTERVAL,
  OPEN_COURSE_FOCUS_REFRESH_INTERVAL,
  OPEN_COURSE_POLL_INTERVAL,
} from "../config/constants"
import { OpenCourseRefresh } from "../openCourseRefresh"
import { idOfMoocCourse } from "./fixtures/identifiers"

type WindowStateListener = (state: vscode.WindowState) => void

suite("OpenCourseRefresh", function () {
  const course = idOfMoocCourse("open-course")
  let isFocused: boolean
  let openCourse: CourseIdentifier | undefined
  let windowStateListeners: WindowStateListener[]
  let refresh: ReturnType<typeof vi.fn<(courseId: CourseIdentifier) => void>>
  let openCourseRefresh: OpenCourseRefresh

  function focus(): void {
    isFocused = true
    windowStateListeners.forEach((listener) => listener({ focused: true, active: true }))
  }

  beforeEach(function () {
    vi.useFakeTimers()
    isFocused = true
    openCourse = course
    windowStateListeners = []
    Object.defineProperty(vscode.window, "state", {
      get: () => ({ focused: isFocused, active: isFocused }),
      configurable: true,
    })
    vi.spyOn(vscode.window, "onDidChangeWindowState").mockImplementation(
      (listener: WindowStateListener) => {
        windowStateListeners.push(listener)
        return {
          dispose: () => windowStateListeners.splice(windowStateListeners.indexOf(listener), 1),
        }
      },
    )
    refresh = vi.fn()
    openCourseRefresh = new OpenCourseRefresh({ openCourse: () => openCourse, refresh })
  })

  afterEach(function () {
    openCourseRefresh.dispose()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test("checks the open course sooner than the full refresh does", function () {
    expect(OPEN_COURSE_FOCUS_REFRESH_INTERVAL).toBeLessThan(FOCUS_REFRESH_INTERVAL)
  })

  test("checks the open course when the window gets focus back after a while", function () {
    vi.advanceTimersByTime(OPEN_COURSE_FOCUS_REFRESH_INTERVAL - 1)
    focus()
    expect(refresh).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    focus()

    expect(refresh).toHaveBeenCalledExactlyOnceWith(course)
  })

  test("checks the open course periodically while the window has focus", function () {
    vi.advanceTimersByTime(OPEN_COURSE_POLL_INTERVAL)

    expect(refresh).toHaveBeenCalledExactlyOnceWith(course)
  })

  test("asks nothing while the window is in the background", function () {
    isFocused = false

    vi.advanceTimersByTime(3 * OPEN_COURSE_POLL_INTERVAL)

    expect(refresh).not.toHaveBeenCalled()
  })

  test("asks nothing without an open course", function () {
    openCourse = undefined

    vi.advanceTimersByTime(OPEN_COURSE_POLL_INTERVAL)
    focus()

    expect(refresh).not.toHaveBeenCalled()
  })

  test("waits again after a full refresh, which covered the open course", function () {
    vi.advanceTimersByTime(OPEN_COURSE_FOCUS_REFRESH_INTERVAL)
    openCourseRefresh.noteRefreshed()
    focus()

    expect(refresh).not.toHaveBeenCalled()
  })
})
