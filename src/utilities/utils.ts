import { pipeline } from "node:stream/promises"
import * as path from "path"

import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type { ExtensionContext } from "vscode"

import type { SubmissionFeedbackQuestion } from "../../shared/langsSchema"
import type { FeedbackQuestion } from "../../shared/lib"
import { BaseError } from "../../shared/lib"
import { ConnectionError } from "../errors"
import { Logger } from "./logger"

/** Budget for a whole download, from request to last byte. */
const DEFAULT_TOTAL_TIMEOUT_MS = 10 * 60 * 1000

/** Budget between two consecutive chunks. Matches tmc-langs' own HTTP timeout. */
const DEFAULT_STALL_TIMEOUT_MS = 30 * 1000

export interface DownloadOptions {
  /** Reports the percentage downloaded (0-100). Silent unless the response declares its length. */
  onProgress?: (downloadedPct: number) => void
  /** Aborts the download; the call then resolves to an `Err`. */
  signal?: AbortSignal
  /** Defaults to ten minutes. */
  totalTimeoutMs?: number
  /** Defaults to thirty seconds. A server that sends headers and then goes silent trips this. */
  stallTimeoutMs?: number
}

/**
 * Downloads data from given url to the specified file. If file exists, its content will be
 * overwritten.
 *
 * Never hangs: the request is bounded by both a total and a per-chunk budget, and by
 * the caller's own signal. A body that stops short of the `Content-Length` it declared
 * is an `Err`, so a truncated file is never handed back as a complete one. A failed write,
 * such as a full disk, is an `Err` too.
 *
 * @param url Url to data
 * @param filePath Absolute path to the desired output file
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
  // A `for await` over a silent body never yields again, so the stall watchdog has to
  // abort the request itself rather than just break out of the loop.
  const stallController = new AbortController()
  const signals = [
    stallController.signal,
    AbortSignal.timeout(options?.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS),
  ]
  if (options?.signal) {
    signals.push(options.signal)
  }
  const signal = AbortSignal.any(signals)

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
      // The extension host's fetch, never a bundled HTTP client: VS Code patches this
      // one for proxy handling, and undici needs a newer Node than the Electron in the
      // oldest VS Code `engines.vscode` allows.
      response = await fetch(url, { method: "get", signal })
    } catch (error) {
      return new Err(new ConnectionError(signal.aborted ? signal.reason : error))
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
    let downloaded = 0
    // `fetch` decodes a compressed body, and `Content-Length` counts the bytes before that.
    const isEncoded = (response.headers.get("content-encoding") ?? "identity") !== "identity"
    const sizeString = response.headers.get("content-length")
    const size = sizeString && !isEncoded ? Math.trunc(Number(sizeString)) : 0
    try {
      restartStallTimer()
      // `pipeline` rather than a write loop: it fails on a write error, such as a full disk,
      // where a loop waiting for "drain" would hang.
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
        fs.createWriteStream(filePath),
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

/**
 * Await this to pause execution for an amount of time
 * @param millis
 */
export function sleep(millis: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, millis)
  })
}

/** `count` and `noun`, with an "s" unless `count` is 1, e.g. "3 new exercises". */
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

export function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

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

export function cliFolder(context: ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "cli")
}
