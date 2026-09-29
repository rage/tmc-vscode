import { promises as fs } from "fs"
import * as path from "path"

/**
 * The folders tmc-langs reports exercise files relative to: Maven's and Ant's source and
 * test roots, then the exercise itself.
 */
const SOURCE_ROOTS = [
  path.join("src", "main", "java"),
  path.join("src", "test", "java"),
  "src",
  "test",
  ".",
]

/**
 * The absolute path of an exercise file that tmc-langs named relative to one of the
 * exercise's source roots, or `undefined` when no root holds it.
 */
export async function findSourceFile(
  exercisePath: string,
  relativePath: string,
): Promise<string | undefined> {
  for (const root of SOURCE_ROOTS) {
    const candidate = path.join(exercisePath, root, relativePath)
    const exists = await fs.access(candidate).then(
      () => true,
      () => false,
    )
    if (exists) {
      return candidate
    }
  }
  return undefined
}
