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

  // Return the original value rather than zod's parsed copy: zod strips
  // unknown keys when parsing, but persisted data may contain extra keys
  // written by a newer extension version and those must be preserved
  // (the typia type guard this replaces also passed the original through).
  return data as T
}
