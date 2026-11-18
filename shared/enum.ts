import { z } from "zod"

/** The bare backend tag; values with per-backend data are an {@link Enum}, whose `kind` matches. */
export type BackendKind = "tmc" | "mooc"

export type Enum<Tmc, Mooc> = { kind: "tmc"; data: Tmc } | { kind: "mooc"; data: Mooc }

// Schema for `Enum<Tmc, Mooc>`. Annotated as `z.ZodType<Enum<...>>` so the inferred type is
// exactly that alias and generic helpers like `match` infer as for hand-written ones.
export function EnumSchema<Tmc extends z.ZodType, Mooc extends z.ZodType>(
  tmc: Tmc,
  mooc: Mooc,
): z.ZodType<Enum<z.output<Tmc>, z.output<Mooc>>> {
  // The cast: TypeScript cannot prove zod's mapped object types simplify to `Enum`'s
  // members while `Tmc`/`Mooc` are generic. Costs zod's `.options` and `.extend()` on the result.
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("tmc"), data: tmc }),
    z.object({ kind: z.literal("mooc"), data: mooc }),
  ]) as unknown as z.ZodType<Enum<z.output<Tmc>, z.output<Mooc>>>
}

export const CourseIdentifierSchema = EnumSchema(
  z.object({ courseId: z.number() }),
  z.object({ moocCourseId: z.string() }),
)

export type CourseIdentifier = z.infer<typeof CourseIdentifierSchema>

export namespace CourseIdentifier {
  export function toString(id: CourseIdentifier): string {
    return match(
      id,
      (tmc) => tmc.courseId.toString(),
      (mooc) => mooc.moocCourseId,
    )
  }

  /** Backend-qualified id for `Map`/`Set` keys; {@link toString} alone collides `1` and `"1"`. */
  export function key(id: CourseIdentifier): string {
    return `${id.kind}:${toString(id)}`
  }

  export function equals(a: CourseIdentifier, b: CourseIdentifier): boolean {
    return key(a) === key(b)
  }
}

export const ExerciseIdentifierSchema = EnumSchema(
  z.object({ tmcExerciseId: z.number() }),
  z.object({ moocExerciseId: z.string() }),
)

export type ExerciseIdentifier = z.infer<typeof ExerciseIdentifierSchema>

export namespace ExerciseIdentifier {
  export function toString(id: ExerciseIdentifier): string {
    return match(
      id,
      (tmc) => tmc.tmcExerciseId.toString(),
      (mooc) => mooc.moocExerciseId,
    )
  }

  /** Like `CourseIdentifier.key`: keeps tmc exercise `1` and mooc exercise `"1"` apart. */
  export function key(id: ExerciseIdentifier): string {
    return `${id.kind}:${toString(id)}`
  }
}

export function match<A, B, C, D>(data: Enum<A, B>, tmc: (x: A) => C, mooc: (x: B) => D): C | D {
  switch (data.kind) {
    case "tmc": {
      return tmc(data.data)
    }
    case "mooc": {
      return mooc(data.data)
    }
    default: {
      assertUnreachable(data)
    }
  }
}

/**
 * The name shown for a backend, only where the student picks a course (slugs and titles are
 * unique only within one backend); elsewhere student text names neither host.
 *
 * The only place these names are spelled, so no component, panel or message writes
 * "tmc.mooc.fi", "TestMyCode", "courses.mooc.fi" or "Courses MOOC" itself. Base URLs likewise
 * come from the `__TMC_BACKEND_URL__`/`__MOOC_BACKEND_URL__` defines in `config.js`.
 */
export function backendName(kind: BackendKind): string {
  return kind === "tmc" ? "tmc.mooc.fi" : "courses.mooc.fi"
}

export function makeTmcKind<T>(t: T): { kind: "tmc" } & { data: T } {
  return { kind: "tmc", data: t }
}

export function makeMoocKind<T>(t: T): { kind: "mooc" } & { data: T } {
  return { kind: "mooc", data: t }
}

/** Splits `values` by backend, keeping their order within each. */
export function partition<A, B>(values: readonly Enum<A, B>[]): { tmc: A[]; mooc: B[] } {
  const tmc: A[] = []
  const mooc: B[] = []
  for (const value of values) {
    match(
      value,
      (a) => tmc.push(a),
      (b) => mooc.push(b),
    )
  }
  return { tmc, mooc }
}

export function unwrap<A, B>(e: Enum<A, B>): A | B {
  return match(
    e,
    (a) => a,
    (b) => b,
  )
}

export function assertUnreachable(x: never): never {
  throw new Error(`Unreachable ${JSON.stringify(x, null, 2)}`)
}
