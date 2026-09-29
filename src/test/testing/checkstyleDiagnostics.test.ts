import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import * as vscode from "vscode"

import type { StyleValidationResult } from "../../shared/langsSchema"
import { CheckstyleDiagnostics } from "../../testing/checkstyleDiagnostics"

function finding(line: number, column: number, message = "Indentation is wrong") {
  return {
    line,
    column,
    message,
    source_name: "com.puppycrawl.tools.checkstyle.checks.indentation.IndentationCheck",
  }
}

suite("CheckstyleDiagnostics", function () {
  let exercisePath: string
  let exerciseUri: vscode.Uri

  beforeEach(function () {
    exercisePath = fs.mkdtempSync(path.join(os.tmpdir(), "r3-checkstyle-"))
    exerciseUri = vscode.Uri.file(exercisePath)
  })

  afterEach(function () {
    fs.rmSync(exercisePath, { recursive: true, force: true })
  })

  function writeSource(relativePath: string): string {
    const file = path.join(exercisePath, relativePath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "class App {}\n")
    return file
  }

  test("resolves a Maven key under src/main/java and marks a FAIL finding an error", async function () {
    const file = writeSource("src/main/java/fi/helsinki/App.java")
    const collection = vscode.languages.createDiagnosticCollection("tmc-checkstyle")
    const diagnostics = new CheckstyleDiagnostics(collection)

    await diagnostics.report(exerciseUri, {
      strategy: "FAIL",
      validation_errors: { "fi/helsinki/App.java": [finding(4, 0)] },
    })

    const [reported] = collection.get(vscode.Uri.file(file)) ?? []
    expect(reported?.severity).toBe(vscode.DiagnosticSeverity.Error)
    expect(reported?.message).toBe("Indentation is wrong")
    expect(reported?.code).toBe("IndentationCheck")
    expect(reported?.range.start.line).toBe(3)
    expect(reported?.range.start.character).toBe(0)
  })

  test("resolves an Ant key under src and marks a WARN finding a warning", async function () {
    const file = writeSource("src/Arith.java")
    const collection = vscode.languages.createDiagnosticCollection("tmc-checkstyle")
    const diagnostics = new CheckstyleDiagnostics(collection)

    await diagnostics.report(exerciseUri, {
      strategy: "WARN",
      validation_errors: { "Arith.java": [finding(2, 5)] },
    })

    const [reported] = collection.get(vscode.Uri.file(file)) ?? []
    expect(reported?.severity).toBe(vscode.DiagnosticSeverity.Warning)
    expect(reported?.range.start.character).toBe(4)
  })

  test("a re-run replaces the previous findings, and a clean one clears them", async function () {
    writeSource("src/Arith.java")
    writeSource("src/Other.java")
    const collection = vscode.languages.createDiagnosticCollection("tmc-checkstyle")
    const diagnostics = new CheckstyleDiagnostics(collection)

    await diagnostics.report(exerciseUri, {
      strategy: "FAIL",
      validation_errors: { "Arith.java": [finding(1, 1)], "Other.java": [finding(1, 1)] },
    })
    await diagnostics.report(exerciseUri, {
      strategy: "FAIL",
      validation_errors: { "Arith.java": [finding(7, 1)] },
    })
    expect(
      [...collection].flatMap(([, reported]) => reported).map((d) => d.range.start.line),
    ).toEqual([6])

    await diagnostics.report(exerciseUri, { strategy: "FAIL", validation_errors: {} })
    expect([...collection].length).toBe(0)
  })

  test("a DISABLED strategy or a check that did not run reports nothing", async function () {
    writeSource("src/Arith.java")
    const collection = vscode.languages.createDiagnosticCollection("tmc-checkstyle")
    const diagnostics = new CheckstyleDiagnostics(collection)
    const disabled: StyleValidationResult = {
      strategy: "DISABLED",
      validation_errors: { "Arith.java": [finding(1, 1)] },
    }

    await diagnostics.report(exerciseUri, disabled)
    await diagnostics.report(exerciseUri, null)

    expect([...collection].length).toBe(0)
  })

  test("retain drops the findings of exercises that are no longer open", async function () {
    writeSource("src/Arith.java")
    const collection = vscode.languages.createDiagnosticCollection("tmc-checkstyle")
    const diagnostics = new CheckstyleDiagnostics(collection)
    await diagnostics.report(exerciseUri, {
      strategy: "FAIL",
      validation_errors: { "Arith.java": [finding(1, 1)] },
    })

    diagnostics.retain([exerciseUri])
    expect([...collection].length).toBe(1)
    diagnostics.retain([])
    expect([...collection].length).toBe(0)
  })

  test("a key no source root holds is still reported, against the exercise folder", async function () {
    const collection = vscode.languages.createDiagnosticCollection("tmc-checkstyle")
    const diagnostics = new CheckstyleDiagnostics(collection)

    await diagnostics.report(exerciseUri, {
      strategy: "FAIL",
      validation_errors: { "Missing.java": [finding(1, 1)] },
    })

    expect(collection.get(vscode.Uri.file(path.join(exercisePath, "Missing.java")))).toHaveLength(1)
  })
})
