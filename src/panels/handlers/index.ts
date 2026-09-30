import type { HandlerMap } from "../router"
import { courseDetailsHandlers } from "./courseDetails"
import { exerciseHandlers } from "./exercise"
import { miscHandlers } from "./misc"

/** Every webview message's handler, except `ready`, which belongs to the webview's transport. */
export const messageHandlers: Omit<HandlerMap, "ready"> = {
  ...courseDetailsHandlers,
  ...exerciseHandlers,
  ...miscHandlers,
}
