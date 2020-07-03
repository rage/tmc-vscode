# TestMyCode for Visual Studio Code

This extension provides [TestMyCode](https://tmc.mooc.fi/) integration for Visual Studio Code.
Students of its various organizations can download, complete and return course exercises directly from the editor.

## Prerequisites

* Visual Studio Code version 1.40.xx or above
* [TestMyCode](https://tmc.mooc.fi/) account
* [Java](https://www.java.com/) runtime (for packing/unpacking and testing exercises)
* Course-specific system environment   
  * For _Java courses_, use same version of JDK and JRE

## Getting started

Instructions on how to install and use the extension in Visual Studio Code can be found [here](https://www.mooc.fi/en/installation/vscode).

### Commands

All predefined commands are related to the currently open and active exercise file in the editor. A list of available commands can be found under the `TMC Menu` button located at the top right for an active editor.

### JRE source

The plugin may download an OpenJDK Java Runtime Environment if no JRE is found on the system. The source code for this JRE distribution can be found [here](https://github.com/AdoptOpenJDK/openjdk-jdk8u/tree/eb3c58ad18052eca4d3e969f95154ab065d025bb).

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
