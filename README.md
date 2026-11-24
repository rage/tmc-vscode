[![Extension tests](https://github.com/rage/tmc-vscode/actions/workflows/test.yml/badge.svg)](https://github.com/rage/tmc-vscode/actions/workflows/test.yml)
[![Build and Upload](https://github.com/rage/tmc-vscode/actions/workflows/build-and-upload.yml/badge.svg)](https://github.com/rage/tmc-vscode/actions/workflows/build-and-upload.yml)
[![Code scanning](https://github.com/rage/tmc-vscode/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/rage/tmc-vscode/actions/workflows/codeql-analysis.yml)

# TestMyCode for Visual Studio Code

This extension provides [TestMyCode](https://tmc.mooc.fi/) integration for Visual Studio Code. Students can download, complete and submit course exercises directly from the editor.

The source code for the extension is available at https://github.com/rage/tmc-vscode. The extension also utilises an additional command line tool, `tmc-langs-rust`, the source code of which is available at https://github.com/rage/tmc-langs-rust.

## Prerequisites

- Visual Studio Code version 1.100 or above. Older editors keep receiving TestMyCode 3.5.x, which has no courses.mooc.fi support. 1.100 is the first version with the networking and extension APIs this version relies on.
- A MOOC.fi account
- Course-specific system environment

## Supported systems

- **Operating systems:** Windows (x86_64), macOS (Intel and Apple silicon) and Linux (x86_64 and arm64). The TestMyCode tools are downloaded once, on first use, from download.mooc.fi.
- **Linux:** the tools need glibc 2.30 or newer; the next version of the tools needs only 2.28.
- **Remote development** (WSL, Remote-SSH, Dev Containers, Codespaces): the extension runs on the remote side, so each remote has its own login and its own exercises.
- **Proxies:** set `HTTPS_PROXY` (and `NO_PROXY` if needed) in the environment VS Code starts from. The next version of the tools also uses the system proxy on Windows and macOS; proxy auto-config (PAC) scripts alone are not supported.
- **Editors:** Visual Studio Code, and editors built on it that can switch their built-in AI off, such as VSCodium. Courses that restrict AI assistance are refused in editors whose built-in AI cannot be switched off, such as Cursor and Windsurf.

Problems with downloads, antivirus or networks: [troubleshooting](docs/troubleshooting.md). Installing for a lab or exam room: [administrators](docs/administrators.md).

## Getting started

Instructions on how to install and use the extension in Visual Studio Code can be found [here](https://www.mooc.fi/en/installation/vscode). Questions and problems: [FAQ](docs/FAQ.md) and [troubleshooting](docs/troubleshooting.md).

After installing, the **Get Started with TestMyCode** walkthrough takes you from logging in to your first submission. Reopen it any time with **TestMyCode: Get Started** from the Command Palette.

### Commands

Every command is in the Command Palette under **TestMyCode**. While an exercise file is open, Run Tests and Submit are in the editor's title bar, and the exercise's item in the status bar lists the other exercise actions.

## Data collected by the extension

The extension does not have trackers or telemetry. It’s open source, and anyone can verify what it does. See: https://github.com/rage/tmc-vscode.

What is sent, and when, is listed in the [FAQ](docs/FAQ.md#what-does-the-extension-send-and-where).

## AI assistance in courses

A course's AI policy is a classroom rule that the extension helps you keep; it is not a control. Inside VS Code the extension switches off Copilot, inline suggestions and the AI features of other extensions that a setting controls, and refuses to run tests, submit or use Get Help while an AI extension it cannot switch off is enabled. This is best effort: the server accepts submissions from any client. Only the policies `full_use` and `required` leave AI on; `not_set`, `limited` and `planning_only` are treated as no AI. See the [FAQ](docs/FAQ.md#why-are-copilot-and-other-ai-features-off).

## Contributing

Please refer to [this document](CONTRIBUTING.md).

## Credits

The project started as a Software Engineering Lab project at the [University of Helsinki CS Dept.](https://www.cs.helsinki.fi/home/).  
Currently it is being maintained by the [Agile Education Research group](https://www.cs.helsinki.fi/en/rage/).

### Original developers

- Samuli Ahlqvist [samp3](https://github.com/samp3)
- Jesse Anttila [jesseanttila-cai](https://github.com/jesseanttila-cai)
- Jori Lampi [jolampi](https://github.com/jolampi)
- Heikki Pulli [hegepi](https://github.com/hegepi)
- Sebastian Sergelius [sebazai](https://github.com/sebazai)

### Client

- Henrik Nygren [nygrenh](https://github.com/nygrenh)
