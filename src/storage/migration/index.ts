import type { z } from "zod"

export interface MigratedData<T> {
  data: T | undefined
  obsoleteKeys: string[]
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
