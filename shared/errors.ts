import * as util from "node:util"

import { z } from "zod"

// checks the optional fields of `NodeJS.ErrnoException`;
// the `Error` part is expected to have been checked already
// (with `util.types.isNativeError`)
const errnoExceptionFieldsSchema = z.object({
  errno: z.number().optional(),
  code: z.string().optional(),
  path: z.string().optional(),
  syscall: z.string().optional(),
})

function isErrnoException(err: Error): err is NodeJS.ErrnoException {
  return errnoExceptionFieldsSchema.safeParse(err).success
}

export class BaseError extends Error {
  public override readonly name: string = "Base Error"
  public details?: string | undefined
  public override cause?: NodeJS.ErrnoException | string
  public override stack?: string

  // possible fields from ErrnoException
  public errno?: number | undefined
  public code?: string | undefined
  public path?: string | undefined
  public syscall?: string | undefined

  public constructor(err?: unknown, details?: string)

  public constructor(err: unknown, details?: string, causeParam?: string) {
    let message = ""
    let stack = ""
    let cause: NodeJS.ErrnoException | string = causeParam || ""

    let errno: number | undefined = undefined
    let code: string | undefined = undefined
    let path: string | undefined = undefined
    let syscall: string | undefined = undefined

    if (typeof err === "string") {
      message = err
    } else if (util.types.isNativeError(err)) {
      message = err.message
      if (err.stack) {
        stack = err.stack
      }

      if (isErrnoException(err)) {
        errno = err.errno
        code = err.code
        path = err.path
        syscall = err.syscall
      }

      if (err.cause) {
        if (util.types.isNativeError(err.cause) && isErrnoException(err.cause)) {
          cause = err.cause
        } else {
          cause = err.cause.toString()
        }
      }
    } else {
      // callers often hit this with `unknown` from catch blocks; anything that
      // isn't a string or Error falls through to a generic message
      message = `Unexpected error ${err} (${typeof err})`
    }

    super(message)
    this.details = details
    if (stack) {
      this.stack = stack
    }
    if (cause) {
      this.cause = cause
    }

    this.errno = errno
    this.code = code
    this.path = path
    this.syscall = syscall
  }

  public override toString(): string {
    let errorMessage = ""
    if (this.errno) {
      errorMessage += `[${this.errno}] `
    }
    if (this.code) {
      errorMessage += `(${this.code}) `
    }
    if (this.syscall) {
      errorMessage += `\`${this.syscall}\` `
    }
    if (this.path) {
      errorMessage += `@${this.path} `
    }
    errorMessage += `${this.name}: ${this.message}.`
    if (this.details) {
      errorMessage += ` ${this.details}.`
    }
    if (this.cause) {
      errorMessage += ` Caused by: ${this.cause}.`
    }
    return errorMessage
  }
}
