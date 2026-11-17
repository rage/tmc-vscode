import { randomUUID } from "crypto"

import type { ErrorDetails } from "../../shared/lib"
import { BaseError } from "../../shared/lib"
import { presentationFor } from "../errors"
import { redactSecrets } from "../utilities/logger"

const KEPT = 20

// A cause chain can be cyclic.
const MAX_CAUSES = 8

/**
 * The failures reported lately, for their Show Details screen: a notification or an error notice
 * names one by id. In memory, so a window reload clears them; the screen then says so.
 */
class ErrorDetailsRegistry {
  private readonly _byId = new Map<string, ErrorDetails>()

  /**
   * Keeps `error` as reported with `summary`, forgetting the oldest beyond the latest few.
   *
   * @returns The id {@link get} takes; unique across window reloads, so a stale one finds nothing.
   */
  public record(summary: string, error: Error): string {
    const id = randomUUID()
    this._byId.set(id, {
      summary,
      actions: presentationFor(error).actions,
      causeChain: describeCauseChain(error),
      occurredAt: new Date().toISOString(),
    })
    for (const oldest of this._byId.keys()) {
      if (this._byId.size <= KEPT) {
        break
      }
      this._byId.delete(oldest)
    }
    return id
  }

  public get(id: string): ErrorDetails | undefined {
    const details = this._byId.get(id)
    if (details) {
      this._byId.delete(id)
      this._byId.set(id, details)
    }
    return details
  }
}

/** `error` and each cause, outermost first, with each one's own diagnostics. */
function describeCauseChain(error: Error): string {
  const links: string[] = []
  let current: unknown = error
  while (current !== undefined && current !== "" && links.length < MAX_CAUSES) {
    if (!(current instanceof Error)) {
      links.push(String(current))
      break
    }
    const details = current instanceof BaseError && current.details ? `\n${current.details}` : ""
    links.push(`${current.name}: ${current.message}${details}`)
    current = current.cause
  }
  return redactSecrets(links.join("\n\nCaused by: "))
}

export const errorDetails = new ErrorDetailsRegistry()
