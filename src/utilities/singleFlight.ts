import type { Result } from "ts-results"
import { Err } from "ts-results"

import { BottleneckError } from "../errors"
import { Logger } from "./logger"

// one shared map, so e.g. submitting and pasting the same exercise collide on one key
const inFlightKeys = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Claims `key`, or returns false if another operation holds it. Callers that claim it
 * must release it exactly once. `maxHoldMs` force-releases the key after that delay
 * regardless, so a CLI call whose promise never settles can't wedge the key forever.
 */
export function acquireSingleFlight(key: string, maxHoldMs: number): boolean {
  if (inFlightKeys.has(key)) {
    return false
  }
  const backstop = setTimeout(() => inFlightKeys.delete(key), maxHoldMs)
  inFlightKeys.set(key, backstop)
  return true
}

export function releaseSingleFlight(key: string): void {
  const backstop = inFlightKeys.get(key)
  if (backstop !== undefined) {
    clearTimeout(backstop)
  }
  inFlightKeys.delete(key)
}

export interface SingleFlightOptions {
  /** Operations sharing a key reject each other; see {@link acquireSingleFlight}. */
  key: string
  maxHoldMs: number
  busyMessage: string
  /** Called with `busyMessage` on rejection, so this module needs no `ActionContext`. */
  onBusy: (message: string) => void
}

/**
 * Runs `body` holding `options.key`, rejecting rather than queueing when another
 * operation already holds it.
 *
 * A rejection both calls `onBusy` and comes back as a [`BottleneckError`], so a
 * caller that only forwards the result still reports it exactly once.
 */
export async function runSingleFlight<T>(
  options: SingleFlightOptions,
  body: () => Promise<Result<T, Error>>,
): Promise<Result<T, Error>> {
  const { key, maxHoldMs, busyMessage, onBusy } = options
  if (!acquireSingleFlight(key, maxHoldMs)) {
    Logger.warn(`Rejected ${key}, already in flight`)
    onBusy(busyMessage)
    return Err(new BottleneckError(busyMessage))
  }
  try {
    return await body()
  } finally {
    releaseSingleFlight(key)
  }
}
