/**
 * What a failed file system call says about the file: `missing`, `inUse` by another program
 * (on Windows, also a security product scanning it), or access `denied`. `undefined` for any
 * other failure.
 */
export type FileProblem = "missing" | "inUse" | "denied"

/** The {@link FileProblem} `error`'s errno code names, if any. */
export function fileProblemOf(error: unknown): FileProblem | undefined {
  const code =
    error instanceof Object && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined
  switch (code) {
    case "ENOENT":
      return "missing"
    case "EBUSY":
      return "inUse"
    case "EACCES":
    case "EPERM":
      return "denied"
    default:
      return undefined
  }
}
