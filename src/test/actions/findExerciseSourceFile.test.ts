import * as path from "path"

import { findMainSourceFile } from "../../actions/findExerciseSourceFile"
import { makeTmpDirs } from "../utils"

suite("findMainSourceFile", function () {
  test("picks the student's Python module, not the tests or the package marker", async function () {
    const root = makeTmpDirs({
      "src/__init__.py": "",
      "src/arithmetics.py": "",
      "test/test_arithmetics.py": "",
      "tmc/points.py": "",
    })

    expect(await findMainSourceFile(root, ["src"])).toBe(path.join(root, "src/arithmetics.py"))
  })

  test("goes down a Maven source tree", async function () {
    const root = makeTmpDirs({
      "src/main/java/fi/mooc/Program.java": "",
      "src/test/java/fi/mooc/ProgramTest.java": "",
      "pom.xml": "",
    })

    expect(await findMainSourceFile(root, ["src/main"])).toBe(
      path.join(root, "src/main/java/fi/mooc/Program.java"),
    )
  })

  test("prefers the least nested file, then the first by name", async function () {
    const root = makeTmpDirs({
      "src/deep/helper.c": "",
      "src/source.c": "",
      "src/main.c": "",
    })

    expect(await findMainSourceFile(root, ["src"])).toBe(path.join(root, "src/main.c"))
  })

  test("takes a student path naming a file as it is", async function () {
    const root = makeTmpDirs({ "solution.py": "", "src/other.py": "" })

    expect(await findMainSourceFile(root, ["solution.py", "src"])).toBe(
      path.join(root, "solution.py"),
    )
  })

  test("finds nothing in an exercise without source files", async function () {
    const root = makeTmpDirs({ "src/data.txt": "", "README.md": "" })

    expect(await findMainSourceFile(root, ["src", "missing"])).toBeUndefined()
  })
})
