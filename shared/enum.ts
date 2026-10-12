import { z } from "zod"

/**
 * Which of the two backends something belongs to.
 *
 * This is the bare tag, for values that name a backend without carrying per-backend data.
 * Anything that does carry per-backend data is an {@link Enum} instead, whose `kind` uses
 * the same two spellings.
 */
export type BackendKind = "tmc" | "mooc"

export type Enum<Tmc, Mooc> = { kind: "tmc"; data: Tmc } | { kind: "mooc"; data: Mooc }

// schema equivalent of the `Enum<Tmc, Mooc>` tagged union
//
// the return type is annotated as `z.ZodType<Enum<...>>` so that the inferred
// type of an enum schema is exactly the `Enum<A, B>` alias — this keeps
// generic helpers like `match` inferring the same way they do for
// hand-written `Enum<A, B>` types
export function EnumSchema<Tmc extends z.ZodType, Mooc extends z.ZodType>(
  tmc: Tmc,
  mooc: Mooc,
): z.ZodType<Enum<z.output<Tmc>, z.output<Mooc>>> {
  // the cast is needed because TypeScript cannot prove that the mapped types
  // in zod's inferred object types simplify to `Enum`'s members while `Tmc` and
  // `Mooc` are still generic; every call site is checked against the annotated
  // return type above
  //
  // the price of the annotation is that zod's own `.options` and `.extend()` are
  // no longer visible on the result
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("tmc"), data: tmc }),
    z.object({ kind: z.literal("mooc"), data: mooc }),
  ]) as unknown as z.ZodType<Enum<z.output<Tmc>, z.output<Mooc>>>
}

export const CourseIdentifierSchema = EnumSchema(
  z.object({ courseId: z.number() }),
  z.object({ instanceId: z.string() }),
)

export type CourseIdentifier = z.infer<typeof CourseIdentifierSchema>

export namespace CourseIdentifier {
  export function toString(id: CourseIdentifier): string {
    return match(
      id,
      (tmc) => tmc.courseId.toString(),
      (mooc) => mooc.instanceId,
    )
  }

  /**
   * A string naming the course and its backend, for `Map`/`Set` keys and comparisons:
   * {@link toString} alone makes tmc course `1` and mooc course `"1"` collide.
   */
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

// helper to simulate Rust's `match`
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
 * The name to show the user for a backend. Course slugs and titles are only
 * unique within one backend, so anything listing courses from both must name
 * the backend alongside them.
 *
 * This is the only place those names are spelled: no component, panel or message
 * writes "TMC Server", "TestMyCode", "courses.mooc.fi" or "Courses MOOC" itself.
 * Backend base URLs follow the same rule and come from the `__TMC_BACKEND_URL__`
 * and `__MOOC_BACKEND_URL__` build defines in `config.js`, never from a literal.
 */
export function backendName(kind: BackendKind): string {
  return kind === "tmc" ? "TMC Server" : "courses.mooc.fi"
}

/**
 * The name to show the user for a backend's paste service, where an exercise can be shared
 * for help. Derived from {@link backendName} so the two never disagree.
 */
export function pasteServiceName(kind: BackendKind): string {
  return `${backendName(kind)} paste`
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
