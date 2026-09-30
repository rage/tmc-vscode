import type { Result } from "ts-results"
import { Err } from "ts-results"

import type { MoocDeviceLogin } from "../shared/langsSchema"
import type { ReadyActionContext } from "./types"

/** A running `mooc login`. */
export interface MoocLoginProcess {
  /** Settles once the CLI has the code; never, if the login ends before that. */
  deviceCode: Promise<MoocDeviceLogin>
  /** How the login ended; an interrupted login ends in an `Err`. Never rejects. */
  result: Promise<Result<void, Error>>
  /** Kills the process. Nothing is saved until the login is approved, so this is always safe. */
  interrupt: () => void
}

/** Starts the courses.mooc.fi device-flow login; the CLI stores the credentials it gets. */
export function startMoocLogin(actionContext: ReadyActionContext): MoocLoginProcess {
  const deviceCode = Promise.withResolvers<MoocDeviceLogin>()
  const { result, interrupt } = actionContext.startup.langs.authenticateMooc(deviceCode.resolve)
  return {
    deviceCode: deviceCode.promise,
    result: result.catch((error: unknown) =>
      Err(error instanceof Error ? error : new Error(String(error))),
    ),
    interrupt,
  }
}
