import { z } from "zod"

/** An `Error` carrying the fields Node attaches to a failed system call. */
export interface ErrnoException extends Error {
  errno?: number | undefined
  code?: string | undefined
  path?: string | undefined
  syscall?: string | undefined
}

// only the optional fields; the caller has already established that `err` is an `Error`
const errnoExceptionFieldsSchema = z.object({
  errno: z.number().optional(),
  code: z.string().optional(),
  path: z.string().optional(),
  syscall: z.string().optional(),
})

function isErrnoException(err: Error): err is ErrnoException {
  return errnoExceptionFieldsSchema.safeParse(err).success
}

/**
 * Describes a thrown value that is neither a string nor an `Error`.
 *
 * Never throws: it runs inside an error constructor, where a second failure would mask
 * the one being reported.
 */
function describeThrown(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    // a circular structure or a bigint makes JSON.stringify throw
    return "<unserializable>"
  }
}

export class BaseError extends Error {
  public override readonly name: string = "Base Error"
  public details?: string | undefined
  public override cause?: ErrnoException | string
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
    let cause: ErrnoException | string = causeParam || ""

    let errno: number | undefined = undefined
    let code: string | undefined = undefined
    let path: string | undefined = undefined
    let syscall: string | undefined = undefined

    if (typeof err === "string") {
      message = err
    } else if (err instanceof Error) {
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
        if (err.cause instanceof Error && isErrnoException(err.cause)) {
          cause = err.cause
        } else {
          cause = err.cause.toString()
        }
      }
    } else {
      // callers often hit this with `unknown` from catch blocks; anything that
      // isn't a string or Error falls through to a generic message
      message = `Unexpected error ${describeThrown(err)} (${typeof err})`
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
