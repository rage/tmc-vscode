# Troubleshooting

## Hosts and ports

The extension and its tools use HTTPS (port 443) to:

- `courses.mooc.fi`: login and courses.mooc.fi courses
- `tmc.mooc.fi`: tmc.mooc.fi courses
- `download.mooc.fi`: the TestMyCode tools, downloaded once on first use
- the file addresses those servers hand out for exercises and submissions

Running tests locally may also reach your toolchain's package servers, such as Maven Central, NuGet or PyPI, depending on the course.

## The TestMyCode tools do not start or will not download

The tools are a program the extension downloads into its own folder, `cli` under the extension's VS Code global storage (on Windows under `%APPDATA%\Code\User\globalStorage\`). If the download fails, check that `download.mooc.fi` is reachable. If the program will not start, an antivirus or application-control policy may be blocking it: allow that folder. Administrators: see [administrators.md](administrators.md).

## Behind a proxy

Set `HTTPS_PROXY` (and `NO_PROXY` if needed) in the environment VS Code starts from, then restart VS Code completely. The next version of the tools also uses the system proxy on Windows and macOS; proxy auto-config (PAC) scripts alone are not supported.

## Tests will not run after installing a language or toolchain

Restart VS Code, so it picks up the new `PATH`. Java exercises use the JDK set in `testMyCode.javaHome`.

## Still stuck

See the [FAQ](FAQ.md). To report a bug, select **Copy Details** on the error and run **TestMyCode: Show Logs**, then open an issue at https://github.com/rage/tmc-vscode/issues.
