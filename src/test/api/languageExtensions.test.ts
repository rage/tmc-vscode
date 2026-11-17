import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import * as vscode from "vscode"

import {
  installLanguageExtension,
  installSentence,
  LANGUAGE_EXTENSIONS,
  languageExtensionById,
  missingLanguageExtensions,
} from "../../api/languageExtensions"
import { Logger } from "../../utilities"

const python = languageExtensionById("ms-python.python")
const java = languageExtensionById("vscjava.vscode-java-pack")

/** Makes `installed` the extensions VS Code has. */
function withInstalled(installed: string[]): void {
  vi.mocked(vscode.extensions.getExtension).mockImplementation(((id: string) =>
    installed.includes(id) ? { id } : undefined) as typeof vscode.extensions.getExtension)
}

suite("language extensions", function () {
  let root: string

  function exercise(name: string, files: string[]): string {
    const folder = path.join(root, name)
    for (const file of files) {
      fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true })
      fs.writeFileSync(path.join(folder, file), "")
    }
    return folder
  }

  beforeEach(function () {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tmc-language-extensions-"))
    withInstalled([])
  })

  afterEach(function () {
    fs.rmSync(root, { recursive: true, force: true })
    vi.mocked(vscode.extensions.getExtension).mockReset()
  })

  test("names Python and Java exercises by their files", function () {
    const folders = [
      exercise("python", ["src/hello.py", "test/test_hello.py"]),
      exercise("maven", ["pom.xml", "src/main/java/Hello.java"]),
      exercise("ant", ["build.xml"]),
    ]

    expect(missingLanguageExtensions(folders)).toEqual([python, java])
  })

  test("leaves out an installed extension and an exercise of no known language", function () {
    withInstalled(["ms-python.python"])
    const folders = [exercise("python", ["src/hello.py"]), exercise("c", ["src/main.c"])]

    expect(missingLanguageExtensions(folders)).toEqual([])
  })

  test("names each extension once however many exercises need it", function () {
    const folders = [exercise("a", ["src/a.py"]), exercise("b", ["src/b.py"])]

    expect(missingLanguageExtensions(folders)).toEqual([python])
  })

  test("finds a language in a folder that had no files yet", function () {
    const folder = path.join(root, "downloading")
    expect(missingLanguageExtensions([folder])).toEqual([])

    exercise("downloading", ["src/hello.py"])

    expect(missingLanguageExtensions([folder])).toEqual([python])
  })

  test("says what to install and why", function () {
    expect(LANGUAGE_EXTENSIONS.map((extension) => installSentence(extension))).toEqual([
      "Install the Python extension to run and debug your code.",
      "Install the Java extension to run and debug your code.",
    ])
  })

  test("installs through VS Code, and never rejects", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    onTestFinished(() => executeCommand.mockRestore())

    await installLanguageExtension(python as (typeof LANGUAGE_EXTENSIONS)[number])
    expect(executeCommand).toHaveBeenCalledWith(
      "workbench.extensions.installExtension",
      "ms-python.python",
    )

    executeCommand.mockRejectedValue(new Error("offline"))
    vi.spyOn(Logger, "warn").mockImplementation(() => undefined)
    await expect(
      installLanguageExtension(python as (typeof LANGUAGE_EXTENSIONS)[number]),
    ).resolves.toBeUndefined()
  })

  test("knows only its own extensions by id", function () {
    expect(languageExtensionById("evil.extension")).toBeUndefined()
  })
})
