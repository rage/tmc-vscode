# ATTENTION!

**this extension is still in development and the team would like to know your thoughts on overall functionality of the extension or hear, if you've encountered any problems while using this extension. You can submit your overall thoughts about extension via [google form](https://docs.google.com/forms/d/1oDCFVNgi5rDSh5iqeINX7qEpc72VnHKmFzuj-jzxtcA/viewform?edit_requested=true) (goods, bads, from the middle...) or you can open an issue to github project [https://github.com/rage/tmc-vscode/issues](https://github.com/rage/tmc-vscode/issues) about encountered problems/bugs.**

# TestMyCode for Visual Studio Code

This extension provides [TestMyCode](https://tmc.mooc.fi/) integration for Visual Studio Code.
Students of its various organizations can download, complete and return course exercises directly from the editor.

To use extension you will need
* [TestMyCode](https://tmc.mooc.fi/) account
* [Java](https://www.java.com/) runtime (for packing/unpacking and testing exercises)
* Course-specific system environment

## Getting started

1. Install this extension.
2. Select the TMC icon on the left side bar.
   * **First time initialization will take some time!** Please pay attention to the bottom bar during this time.
3. Select *Log in* from the TestMyCode menu.
4. Enter your credentials and log in.

![Getting started](media/README_getting_started.png)

* Now you can add courses to "My courses" list.
* By selecting a course afterwards, you may select exercises you want to download.

## Editor usage

Downloaded exercises appear on the Explorer:

![Explorer button](media/README_click_Explorer.png)

### Testing a solution
When you want to test your solution, click the "TMC - Run tests". It is located in the top right corner of the screen. It is highlighted as blue in the following picture.

### Submitting a solution
If your solution passes tests, click the "TMC - Submit solutions" in the top right corner. It is highlighted as red in the following picture. 

### Resetting an exercise
If you want to reset your active exercise, you can open a dropdown menu by clicking the button highlighted as green in the following image. It is located in the top right corner. Click "TMC - Reset exercise" from the dropdown menu.

![TestSubmitReset](media/README_submit_test_reset.png)
