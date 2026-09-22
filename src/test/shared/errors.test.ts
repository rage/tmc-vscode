import { BaseError } from "../../shared/shared"

suite("BaseError", function () {
  test("keeps the message, stack and errno fields of an Error", function () {
    const errno = Object.assign(new Error("open failed"), {
      errno: -2,
      code: "ENOENT",
      path: "/tmp/missing",
      syscall: "open",
    })

    const error = new BaseError(errno, "while reading the exercise")

    expect(error.message).toBe("open failed")
    expect(error.stack).toBe(errno.stack)
    expect(error.details).toBe("while reading the exercise")
    expect(error.code).toBe("ENOENT")
    expect(error.errno).toBe(-2)
    expect(error.path).toBe("/tmp/missing")
    expect(error.syscall).toBe("open")
  })

  test("describes a thrown object by its contents", function () {
    expect(new BaseError({ kind: "cli-crash" }).message).toBe(
      'Unexpected error {"kind":"cli-crash"} (object)',
    )
  })

  // an error that fails to construct hides the failure it was reporting
  test("does not throw on a value that cannot be described", function () {
    const circular: { self?: unknown } = {}
    circular.self = circular

    expect(new BaseError(Symbol("boom")).message).toBe("Unexpected error Symbol(boom) (symbol)")
    expect(new BaseError(circular).message).toBe("Unexpected error <unserializable> (object)")
    expect(new BaseError(10n).message).toBe("Unexpected error <unserializable> (bigint)")
  })
})
