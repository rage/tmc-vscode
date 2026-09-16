import { once } from "node:events"
import { finished } from "node:stream/promises"
import * as path from "path"

import * as fs from "fs-extra"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import type { ExtensionContext } from "vscode"

import type { FeedbackQuestion } from "../actions/types"
import { ConnectionError } from "../errors"
import type { SubmissionFeedbackQuestion } from "../shared/langsSchema"
import { BaseError } from "../shared/shared"
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
 * is an `Err`, so a truncated file is never handed back as a complete one.
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

    // Created outside the try so the catch can always release the fd.
    const writeStream = fs.createWriteStream(filePath)
    let downloaded = 0
    const sizeString = response.headers.get("content-length")
    const size = sizeString ? Math.trunc(Number(sizeString)) : 0
    try {
      if (!response.body) {
        throw new Error("Unexpected null response body")
      }

      restartStallTimer()
      for await (const chunk of response.body) {
        restartStallTimer()
        downloaded += chunk.length
        if (size > 0) {
          options?.onProgress?.(Math.round((downloaded / size) * 100))
        }
        // write() returns false when the internal buffer is full; wait for
        // "drain" so large downloads don't grow memory unbounded.
        if (!writeStream.write(chunk)) {
          await once(writeStream, "drain")
        }
      }

      // Wait until everything is flushed and the fd is closed, so callers
      // always see a complete file with no handle left open.
      writeStream.end()
      await finished(writeStream)
    } catch (error) {
      // Destroy on error so we never leak an open handle.
      writeStream.destroy()
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

export function formatSizeInBytes(size: number, precision = 3): string {
  let suffix = "B"
  let cSize = size
  const targetPrecision = Math.min(size === 0 ? 1 : Math.floor(Math.log10(size) + 1), 21, precision)

  for (const s of ["kB", "MB", "GB", "TB", "EB"]) {
    if (Number(cSize.toPrecision(targetPrecision)) >= 1000) {
      cSize /= 1000
      suffix = s
    } else {
      break
    }
  }

  return `${cSize.toPrecision(targetPrecision)} ${suffix}`
}

/**
 * Return bootstrap striped, animated progress bar div as string
 * @param percentDone How much done of the progress
 */
export function getProgressBar(percentDone: number): string {
  return `<div class="progress">
        <div
            class="progress-bar progress-bar-striped progress-bar-animated"
            role="progressbar"
            aria-valuenow="${percentDone}"
            aria-valuemin="0"
            aria-valuemax="100"
            style="width: ${percentDone}%"
        ></div>
    </div>`
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

export function parseTestResultsText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("`", "&#96;")
}

/**
 * Tries to remove old data if extension restarted within 10 minutes of moving TMC Data and
 * receiving error that some data could not be removed and has to be removed manually.
 * @param oldDataObject
 */
export async function removeOldData(oldDataObject: {
  path: string
  timestamp: number
}): Promise<Result<string, Error>> {
  if (oldDataObject.timestamp + 10 * 60 * 1000 > Date.now()) {
    try {
      fs.removeSync(oldDataObject.path)
    } catch (_err) {
      return new Err(new Error(`Still failed to remove data from ${oldDataObject.path}`))
    }
    return new Ok(`Removed successfully from ${oldDataObject.path}`)
  }
  return new Ok(`Time exceeded, will not remove data from ${oldDataObject.path}`)
}

export function cliFolder(context: ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "cli")
}
