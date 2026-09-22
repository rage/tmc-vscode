import { z } from "zod"

interface TmcKind {
  kind: "tmc"
}

interface MoocKind {
  kind: "mooc"
}

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
  // no longer visible on the result — use `enumSchemaKinds` for the arms
  return z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("tmc"), data: tmc }),
    z.object({ kind: z.literal("mooc"), data: mooc }),
  ]) as unknown as z.ZodType<Enum<z.output<Tmc>, z.output<Mooc>>>
}

/** The arms every `EnumSchema` carries, in declaration order. */
export function enumSchemaKinds(): readonly ["tmc", "mooc"] {
  return ["tmc", "mooc"]
}

export namespace Enum {
  // oxlint-disable-next-line no-shadow -- the namespace-scoped helpers deliberately reuse the module-level `unwrap` name (qualified access, e.g. Enum.unwrap)
  export function unwrap<A, B>(e: Enum<A, B>): A | B {
    return match(
      e,
      (value) => value,
      (value) => value,
    )
  }
}

export const CourseIdentifierSchema = EnumSchema(
  z.object({ courseId: z.number() }),
  z.object({ instanceId: z.string() }),
)

export type CourseIdentifier = z.infer<typeof CourseIdentifierSchema>

export namespace CourseIdentifier {
  export function from(id: number | string): CourseIdentifier {
    if (typeof id === "number") {
      return makeTmcKind({ courseId: id })
    } else if (typeof id === "string") {
      return makeMoocKind({ instanceId: id })
    }
    assertUnreachable(id)
  }

  export function toString(id: CourseIdentifier): string {
    return match(
      id,
      (tmc) => tmc.courseId.toString(),
      (mooc) => mooc.instanceId,
    )
  }
}

export type TmcExerciseId = number
export type MoocExerciseId = string

export const ExerciseIdentifierSchema = EnumSchema(
  z.object({ tmcExerciseId: z.number() }),
  z.object({ moocExerciseId: z.string() }),
)

export type ExerciseIdentifier = z.infer<typeof ExerciseIdentifierSchema>

export namespace ExerciseIdentifier {
  export function from(id: number | string): ExerciseIdentifier {
    if (typeof id === "number") {
      return makeTmcKind({ tmcExerciseId: id })
    } else if (typeof id === "string") {
      return makeMoocKind({ moocExerciseId: id })
    }
    assertUnreachable(id)
  }

  // oxlint-disable-next-line no-shadow -- deliberate qualified-name reuse (ExerciseIdentifier.unwrap)
  export function unwrap(id: ExerciseIdentifier): number | string {
    if (id.kind === "tmc") {
      return id.data.tmcExerciseId
    }
    if (id.kind === "mooc") {
      return id.data.moocExerciseId
    }
    assertUnreachable(id)
  }

  export function toString(id: ExerciseIdentifier): string {
    return match(
      id,
      (tmc) => tmc.tmcExerciseId.toString(),
      (mooc) => mooc.moocExerciseId,
    )
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

export function matchBackend<A extends { backend: "tmc" | "mooc" }, B, C>(
  data: A,
  tmc: (x: A) => B,
  mooc: (x: A) => C,
): B | C {
  switch (data.backend) {
    case "tmc": {
      return tmc(data)
    }
    case "mooc": {
      return mooc(data)
    }
    default: {
      assertUnreachable(data.backend)
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
export function backendName(kind: "tmc" | "mooc"): string {
  return kind === "tmc" ? "TMC Server" : "courses.mooc.fi"
}

/**
 * The name to show the user for a backend's paste service, where an exercise can be shared
 * for help. Derived from {@link backendName} so the two never disagree.
 */
export function pasteServiceName(kind: "tmc" | "mooc"): string {
  return `${backendName(kind)} paste`
}

export function matchOption<A, B, T extends Enum<A, B> | undefined>(
  data: T,
  tmc: (x: T & TmcKind) => A,
  mooc: (x: T & MoocKind) => B,
): A | B | undefined {
  switch (data?.kind) {
    case "tmc": {
      return tmc(data as T & TmcKind)
    }
    case "mooc": {
      return mooc(data as T & MoocKind)
    }
    case undefined: {
      return undefined
    }
    default: {
      assertUnreachable(data)
    }
  }
}

export function makeTmcKind<T>(t: T): { kind: "tmc" } & { data: T } {
  return { kind: "tmc", data: t }
}

export function makeMoocKind<T>(t: T): { kind: "mooc" } & { data: T } {
  return { kind: "mooc", data: t }
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
