import type { CourseDetailsPanel, ExerciseSubmissionPanel, TargetPanel } from "../../shared/lib"
import type { FailureSink } from "../api/withOperation"
import type { PanelHost } from "./router"
import { toWebviewError } from "./webviewError"

/** A screen that lists the failures of what it started. */
export type FailureScreen = TargetPanel<CourseDetailsPanel> | TargetPanel<ExerciseSubmissionPanel>

// Random, so a failure of this extension host is not taken for one dismissed before a reload.
let nextSerial = Math.floor(Math.random() * 2 ** 30) + 1

/** `screen`, as long as `host` shows it, as the {@link FailureSink} of what it started. */
export function screenFailureSink(host: PanelHost, screen: FailureScreen): FailureSink {
  const target = { id: screen.id, type: screen.type }
  return {
    isVisible: () => host.isVisible && host.route?.id === target.id,
    show: (headline, error, tone) => {
      host.post({
        type: "operationFailed",
        target,
        failure: {
          serial: nextSerial++,
          tone,
          ...(error && tone === "error" ? { title: headline } : {}),
          error: error ? toWebviewError(error) : { message: headline },
        },
      })
    },
  }
}
