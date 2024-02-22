[![Extension tests](https://github.com/rage/tmc-vscode/actions/workflows/test.yml/badge.svg)](https://github.com/rage/tmc-vscode/actions/workflows/test.yml)
[![Build and Upload](https://github.com/rage/tmc-vscode/actions/workflows/build-and-upload.yml/badge.svg)](https://github.com/rage/tmc-vscode/actions/workflows/build-and-upload.yml)
[![Code scanning](https://github.com/rage/tmc-vscode/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/rage/tmc-vscode/actions/workflows/codeql-analysis.yml)

# TestMyCode for Visual Studio Code

This extension provides [TestMyCode](https://tmc.mooc.fi/) integration for Visual Studio Code.
Students of its various organizations can download, complete and return course exercises directly from the editor.

## Prerequisites

* Visual Studio Code version 1.52.xx or above
* [TestMyCode](https://tmc.mooc.fi/) account
* Course-specific system environment

## Getting started

Instructions on how to install and use the extension in Visual Studio Code can be found [here](https://www.mooc.fi/en/installation/vscode).

### Commands

A list of all available commands can be found under the `TMC Commands Menu` button located at the top right for an active editor.

## Data collected by the extension
The extension does not have trackers or telemetry. It’s open source, and anyone can verify what it does. See: https://github.com/rage/tmc-vscode.

If you choose to submit your answer to a programming exercise to be graded to our server, the extension will send us the folder of that specific exercise. This folder contains only your solution to the exercise, and no other files are sent. This information will also include the language the server should use for error messages. The error message language is currently your computer’s locale. We may check the answers you submit for plagiarism, and we may use the IP address of the computer that submitted the exercise for blocking spam and preventing abuse.

The same applies if you choose to submit your answer to the TMC pastebin for sharing your solution to other students.

When you interact with our server, e.g. log in, download, or submit exercises, we will send the version of this plugin in the requests. This is used for blocking outdated and potentially misbehaving plugin versions.


## Contributing

Please refer to [this document](CONTRIBUTING.md).

## Credits

The project started as a Software Engineering Lab project at the [University of Helsinki CS Dept.](https://www.cs.helsinki.fi/home/).  
Currently it is being maintained by the [Agile Education Research group](https://www.cs.helsinki.fi/en/rage/).

### Original developers
  * Samuli Ahlqvist [samp3](https://github.com/samp3)
  * Jesse Anttila [jesseanttila-cai](https://github.com/jesseanttila-cai)
  * Jori Lampi [jolampi](https://github.com/jolampi)
  * Heikki Pulli [hegepi](https://github.com/hegepi)
  * Sebastian Sergelius [sebazai](https://github.com/sebazai)

### Client
  * Henrik Nygren [nygrenh](https://github.com/nygrenh)
