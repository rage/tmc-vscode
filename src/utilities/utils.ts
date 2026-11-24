import { pipeline } from "node:stream/promises"
import * as path from "path"

import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type { ExtensionContext } from "vscode"

import type { SubmissionFeedbackQuestion } from "../../shared/langsSchema"
import type { FeedbackQuestion } from "../../shared/lib"
import { BaseError } from "../../shared/lib"
import { EXTENSION_ID } from "../config/constants"
import { ConnectionError } from "../errors"
import { Logger } from "./logger"

/** Budget between two consecutive chunks. Matches tmc-langs' own HTTP timeout. */
const DEFAULT_STALL_TIMEOUT_MS = 30 * 1000

export interface DownloadOptions {
  /** Reports the percentage downloaded (0-100). Silent unless the response declares its length. */
  onProgress?: (downloadedPct: number) => void
  /** Aborts the download; the call then resolves to an `Err`. */
  signal?: AbortSignal
  /** Budget for the whole download. Unset by default: a slow link that keeps sending is fine. */
  totalTimeoutMs?: number
  /**
   * Continues a partial file at `filePath` with a Range request instead of starting over. A
   * server that ignores the range sends the whole body, which then replaces the partial file.
   */
  resume?: boolean
  /** Defaults to thirty seconds. A server that sends headers and then goes silent trips this. */
  stallTimeoutMs?: number
}

/** Whether `child` is `parent` itself or somewhere inside it. `pathModule` is for testing only. */
export function isPathInside(
  parent: string,
  child: string,
  pathModule: path.PlatformPath = path,
): boolean {
  const relative = pathModule.relative(parent, child)
  // Paths on different Windows drives come back absolute
  return (
    !pathModule.isAbsolute(relative) &&
    relative !== ".." &&
    !relative.startsWith(".." + pathModule.sep)
  )
}

/**
 * Whether `a` and `b` are the same path by the platform's case and separator rules.
 * `pathModule` is for testing only.
 */
export function isSamePath(a: string, b: string, pathModule: path.PlatformPath = path): boolean {
  return pathModule.relative(a, b) === ""
}

/**
 * Downloads `url` to `filePath`, overwriting any existing file.
 *
 * Never hangs: bounded by a per-chunk budget, an optional total one and the caller's signal. A body
 * shorter than its declared `Content-Length`, or a failed write such as a full disk, is an
 * `Err`, so a truncated file is never returned as complete.
 *
 * @param filePath Absolute path to the output file
 */
export async function downloadFile(
  url: string,
  filePath: string,
  options?: DownloadOptions,
): Promise<Result<void, Error>> {
  try {
    fs.mkdirSync(path.resolve(filePath, ".."), { recursive: true })
  } catch (error) {
    return new Err(new BaseError(error, "Failed to create download directory"))
  }

  const stallTimeoutMs = options?.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
  // A `for await` over a silent body never yields, so the watchdog must abort the request.
  const stallController = new AbortController()
  const signals = [stallController.signal]
  if (options?.totalTimeoutMs !== undefined) {
    signals.push(AbortSignal.timeout(options.totalTimeoutMs))
  }
  if (options?.signal) {
    signals.push(options.signal)
  }
  const signal = AbortSignal.any(signals)

  let resumeFrom = 0
  if (options?.resume) {
    try {
      resumeFrom = fs.statSync(filePath).size
    } catch {
      // No partial file: start from the beginning.
    }
  }

  let stallTimer: NodeJS.Timeout | undefined
  const restartStallTimer = (): void => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => {
      stallController.abort(new Error(`No data received from ${url} in ${stallTimeoutMs} ms`))
    }, stallTimeoutMs)
  }

  try {
    let response: Response
    try {
      restartStallTimer()
      // The host's fetch, not a bundled client: VS Code patches it for proxies, and undici
      // needs a newer Node than the oldest supported VS Code's Electron.
      response = await fetch(url, {
        method: "get",
        signal,
        ...(resumeFrom > 0 ? { headers: { Range: `bytes=${resumeFrom}-` } } : {}),
      })
    } catch (error) {
      return new Err(new ConnectionError(signal.aborted ? signal.reason : error))
    }

    if (resumeFrom > 0 && response.status === 416) {
      // The partial file is not a prefix of what the server has; the next attempt starts over.
      fs.rmSync(filePath, { force: true })
      return new Err(new Error(`${url} refused to resume the download at byte ${resumeFrom}`))
    }
    const isResumed =
      resumeFrom > 0 &&
      response.status === 206 &&
      response.headers.get("content-range")?.startsWith(`bytes ${resumeFrom}-`) === true
    if (!isResumed) {
      resumeFrom = 0
    }

    if (!response.ok) {
      let cause: string | undefined
      try {
        cause = await response.text()
      } catch (_error) {
        // ignore error in reading response, not important
      }

      return new Err(new Error("Request failed: " + response.statusText, { cause }))
    }

    const body = response.body
    if (!body) {
      return new Err(new Error("Unexpected null response body"))
    }
    let downloaded = resumeFrom
    // `fetch` decodes a compressed body, and `Content-Length` counts the bytes before that.
    const isEncoded = (response.headers.get("content-encoding") ?? "identity") !== "identity"
    const sizeString = response.headers.get("content-length")
    const size = sizeString && !isEncoded ? resumeFrom + Math.trunc(Number(sizeString)) : 0
    try {
      restartStallTimer()
      // `pipeline` fails on a write error such as a full disk; a loop awaiting "drain" would hang.
      await pipeline(
        body,
        async function* (chunks: AsyncIterable<Uint8Array>) {
          for await (const chunk of chunks) {
            restartStallTimer()
            downloaded += chunk.length
            if (size > 0) {
              options?.onProgress?.(Math.round((downloaded / size) * 100))
            }
            yield chunk
          }
        },
        fs.createWriteStream(filePath, { flags: isResumed ? "a" : "w" }),
      )
    } catch (error) {
      if (signal.aborted) {
        return new Err(new ConnectionError(signal.reason, `Download from ${url} was aborted`))
      }
      return new Err(new BaseError(error, "Writing to file failed"))
    }

    if (size > 0 && downloaded !== size) {
      return new Err(
        new Error(`Download from ${url} ended after ${downloaded} of ${size} declared bytes`),
      )
    }

    return Ok.EMPTY
  } finally {
    clearTimeout(stallTimer)
  }
}

/** Resolves after `millis` milliseconds. */
export function sleep(millis: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, millis)
  })
}

/**
 * Like `Promise.all(items.map(task))`, with at most `limit` tasks running at once. Results
 * keep the order of `items`; the first rejection rejects the whole, as with `Promise.all`.
 */
export async function mapConcurrently<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export { countOf } from "../../shared/lib"

export function parseFeedbackQuestion(questions: SubmissionFeedbackQuestion[]): FeedbackQuestion[] {
  const feedbackQuestions: FeedbackQuestion[] = []
  questions.forEach((x) => {
    if (x.kind === "Text") {
      feedbackQuestions.push({
        id: x.id,
        kind: "text",
        question: x.question,
      })
    } else if (x.kind.IntRange) {
      feedbackQuestions.push({
        id: x.id,
        kind: "intrange",
        lower: x.kind.IntRange.lower,
        question: x.question,
        upper: x.kind.IntRange.upper,
      })
    } else {
      Logger.info("Unexpected feedback question type:", x.kind)
    }
  })
  return feedbackQuestions
}

/** Where earlier versions kept the CLI. */
export function legacyCliFolder(context: ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "cli")
}

/**
 * Where the CLI is installed. On Windows `globalStorage` is in the roaming profile, which would
 * copy the 50 MB binary at every logon and logoff, so it goes to the local one instead.
 */
export function cliFolder(context: ExtensionContext): string {
  const { APPDATA, LOCALAPPDATA } = process.env
  if (
    process.platform === "win32" &&
    APPDATA &&
    LOCALAPPDATA &&
    isPathInside(APPDATA, context.globalStorageUri.fsPath, path.win32)
  ) {
    return path.join(LOCALAPPDATA, EXTENSION_ID, "cli")
  }
  return legacyCliFolder(context)
}

/** Runs tasks one at a time, each once every earlier one has settled. */
export class SerialQueue {
  private _tail: Promise<unknown> = Promise.resolve()

  /** Settles as `task` does; a rejection does not stop the tasks queued after it. */
  public run<T>(task: () => T | Thenable<T>): Promise<T> {
    const result = this._tail.then(task)
    this._tail = result.catch(() => undefined)
    return result
  }
}
