import type { HandlerMap } from "../router"
import { addCourseHandlers } from "./addCourse"
import { courseDetailsHandlers } from "./courseDetails"
import { exerciseHandlers } from "./exercise"
import { loginHandlers } from "./login"
import { miscHandlers } from "./misc"

/** Every webview message's handler, except `ready`, which belongs to the webview's transport. */
export const messageHandlers: Omit<HandlerMap, "ready"> = {
  ...addCourseHandlers,
  ...courseDetailsHandlers,
  ...exerciseHandlers,
  ...loginHandlers,
  ...miscHandlers,
}
