/**
 * Empties a list the UI shows while `body` runs, then always fills it back in.
 *
 * The lists are cleared before the download they describe starts, so the student sees the
 * work begin. `restore` runs from a `finally`, so a `body` that fails or throws cannot leave
 * them looking at an empty list and conclude there is nothing left to download.
 *
 * @param restore receives `body`'s value, or `undefined` if it threw.
 */
export async function withOptimisticList<T>(
  clear: () => void,
  body: () => Promise<T>,
  restore: (outcome: T | undefined) => void,
): Promise<T> {
  clear()
  let outcome: T | undefined
  try {
    outcome = await body()
    return outcome
  } finally {
    restore(outcome)
  }
}
