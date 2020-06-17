# ATTENTION!

**This extension is under development.**  
The VSCode team would like to hear if you've encountered any problems while using this extension.  
You can submit your ideas or issues to the GitHub repository [https://github.com/rage/tmc-vscode/issues](https://github.com/rage/tmc-vscode/issues).

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

1. Start Visual Studio Code
2. In the ```Extension``` tab (Four squares), look for ```TestMyCode``` and install
3. Select the TMC icon on the left sidebar.
   * **First time initialization will take some time!**  
      Please pay attention to the VSCode notifications
4. Select *Log in* from the TestMyCode menu.
5. Enter your TMC credentials and log in.
6. Add a course from ```My courses``` and download exercises
7. Select ```Open exercise workspace``` from TestMyCode extension menu.

## JRE source

The plugin may download an OpenJDK Java Runtime Environment if no JRE is found on the system. The source code for this JRE distribution can be found [here](https://github.com/AdoptOpenJDK/openjdk-jdk8u/tree/eb3c58ad18052eca4d3e969f95154ab065d025bb).

## Workspace and Editor usage

Exercises that are downloaded and opened via the TMC extension appear in the Explorer:

![Explorer button](media/README_click_Explorer.png)

### Commands

All predefined commands are related to the currently open and active exercise file in the editor. A list of available commands can be found under the `TMC Menu` button located at the top right for an active editor.

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
