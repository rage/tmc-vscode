import type { z } from "zod"

/** One stored value brought up to the current storage version. */
export interface MigratedData<T> {
  data: T | undefined
  /**
   * Keys whose contents `data` — or the migration's side effects — now fully
   * represents. A key left out survives, and since the chain prefers the
   * oldest key present, the next activation replays that stale snapshot over
   * the migrated value. Leave a key out only when the migration could not
   * carry its contents forward and deleting it would lose them.
   */
  supersededKeys: string[]
  /** Key `data` is written to, or `undefined` when the migration persists nothing. */
  destinationKey: string | undefined
}

/** Keys safe to delete once every migration's `data` has been persisted. */
export function obsoleteKeys(migrations: MigratedData<unknown>[]): string[] {
  // A key one migration is finished with may still be where another one writes.
  const destinations = new Set(migrations.map((migration) => migration.destinationKey))
  const obsolete = new Set<string>()
  for (const { supersededKeys } of migrations) {
    for (const key of supersededKeys) {
      if (!destinations.has(key)) {
        obsolete.add(key)
      }
    }
  }
  return [...obsolete]
}

export default function validateData<T>(data: unknown, schema: z.ZodType<T>): T | undefined {
  if (!data) {
    return undefined
  }

  if (!schema.safeParse(data).success) {
    throw new Error(`Data type mismatch: ${JSON.stringify(data)}`)
  }

  // Return the original value, not zod's parsed copy: zod strips unknown
  // keys, but persisted data may carry extra keys from a newer extension
  // version that must be preserved.
  return data as T
}
