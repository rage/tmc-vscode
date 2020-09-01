# Changelog

## [1.0.1] - 2020-09-01

#### Fixed
- Prevent losing exercise data if update fails at a bad time.
- Broken image in Welcome view on some file systems.


## [1.0.0] - 2020-08-27

#### Added
- VSCode command for checking for exercise updates.
- Open logs folder button to Settings page.
- *Need Help?* option on TMC Submission Result view.
- When downloading an exercise, download last submission by default.
    * Default behavior can be changed in Settings.

#### Changed
- Show some TMC-VSCode commands only when logged in.
- Bumped TMC-langs Rust version to 0.1.0.
- VSCode Python Interpreter path passed to TMC-langs Rust.
- All API Requests handled externally by TMC-langs Rust.
- Exercise related actions use TMC-langs Rust.
- TMC-langs commands to obfuscate sensitive details from TMC logs.
- Technical improvements to My Courses page.
- Remove obsolete "closed-exercise" folder from tmcdata if empty.

#### Removed
- Temporarily removed *Show submission in browser* button in Submission Queue view.
- Download of AdoptOpenJDK if Java not present in system.
- Download of TMC-langs Java CLI .jar file.


## [0.10.0] - 2020-08-10

#### Added
- Welcome page, displayed when major or minor version changes.
- VSCode Commands for most TMC actions.
- VSCode Command for wiping all extension data.
- Extension recommendations for course workspaces based on file language in workspace.
- Possibility to download individual exercises in Course Page.

#### Changed
- TMC-langs Rust version 0.1.17-alpha.
- Local exercise tests runs with TMC-langs Rust.
- Course specific workspaces using VSCode Multi-root workspaces.
- Need to close TMC Workspace if moving TMC Data from Settings.
- Insider: Python executable path passed to TMC-langs Rust.
- Insider: Most API Request handled externally by TMC-langs Rust.
- Insider: Handle login and logout externally by TMC-langs Rust.
- Insider: Exercise related actions uses TMC-langs Rust.

#### Fixed
- Remove old Rust CLI versions.
- Clear new exercise only when download succeeded for given exercise.

#### Removed
- Insider notification on extension activation.

#### Security
- Updated dependencies.


## [0.9.2] - 2020-07-21

#### Fixed
- Status of new exercises was displayed as expired.


## [0.9.1] - 2020-07-16

#### Changed
- Log level to verbose if insider.

#### Fixed
- Quote TMC Rust cli path in command.


## [0.9.0] - 2020-07-15

#### Added
- [Insider](https://github.com/rage/tmc-vscode/blob/master/docs/insider.md) version support.

#### Changed
- Insider: Use TMC Langs Rust when running local tests.

#### Fixed
- Not to check for new exercises or updates if logged out.


## [0.8.3] - 2020-07-08

#### Fixed
- Refresh button was using cache data.


## [0.8.2] - 2020-07-07

#### Added
- Support for disabled courses.
- Refresh button to course details page.
- Show material url in course details if defined.

#### Changed
- After reseting an exercise or downloading an old submission, reopen the active file.
- Improvements to move TMC data folder operation and cleanup.
- No longer auto-open exercise lists when starting a download.
- Less pronounced hover effect on clickable cards.

#### Fixed
- Data validation to not clear new exercises array and notification delay for courses.
- Don't remove .vscode/settings.json in TMC workspace.


## [0.8.0] - 2020-06-30

#### Added
- Exam mode.

#### Changed
- All exercise downloads are now displayed with a progress notification.
- "No deadline" text is shown only if there are no deadlines in a group of exercises.
- Expand verbose logging for the extension.
- TMC Langs executable version bumped to 0.8.5.

#### Removed
- Exercise Download Progress page.

#### Fixed
- Hide update exercises notification in Course View after pressing the button.
- Error handling when attempting to send an expired exercise to TMC Paste.
- Data validation to not remove user data if an API error was received.
- Restore Course Details webview properly after the page had been hidden.
- 0.8.1 Hotfix: Validation issue on old user courses when receiving Authorization error.


## [0.7.1] - 2020-06-24

#### Changed
- Darker disabled buttons.
- Enable python.terminal.executeInFileDir for TMC Workspace.

#### Fixed
- Problem showing HTML characters in TMC Test Results.
- Disabled 'Open all' button if no exercises downloaded.


## [0.7.0] - 2020-06-23

#### Added
- Hide/show exercise meta files. Hidden by default, can be changed in TMC Settings.
- Provide an easy access from TMC Settings to change where webviews are opened.
- Notify user if couldn't fetch API data on course page.

#### Changed
- TMC Test Results and Submission pages are recycled after usage.

#### Fixed
- User-defined Workspace Folder settings were automatically being deleted.
- TMC Langs logs not appearing if test results (.tmc_test_results.json) can't be found.
- Problem showing error messages with backslashes in TMC Test Results.


## [0.6.3] - 2020-06-18

#### Added
- Show logs button to settings.
- 30min timer to poll for new exercises and updates for My courses.

#### Changed
- 0.6.4 Hotfix: Bumped TMC-Langs version to 0.8.2.
- TMC-Langs process timeout increased to two minutes.

#### Removed
- Exercise result parsing (now handled by TMC-Langs)

#### Fixed
- Course page 'Update exercises' button.


## [0.6.0] - 2020-06-17

#### Added
- Server submission button even when some tests fail.

#### Changed
- Redesigned course detail page.

#### Removed
- Download exercises page.
- Obsolete information from readme.

#### Fixed
- Faulty API data when downloading old submissions.
- 0.6.2 Hotfix: Broken course detail page scripts in production build.


## [0.5.2] - 2020-06-12

#### Added
- Parsing to test names within displayed test results.
- Filter out 'False is not true' from the start of failed test messages.

#### Changed
- By default, show only one locally failed test.
- API Endpoint for fetching old submissions.
- Reduced local test process timeout to 15 seconds.

#### Fixed
- Missing whitespace when showing test results.
- Regression: Closed exercises were not re-opened after updating.

#### Security
- Updated dependencies.


## [0.5.0] - 2020-05-14

#### Added
- Icons for running tests and opening TMC menu.
- Output channel for logging extension status information.
- User able to choose extension logging level in settings (default: Errors).

#### Fixed
- Resolve errors if data was removed externally while the extension was running.


## [0.4.1] - 2020-05-08

#### Changed
- Remove data of missing exercises when deleting course from My courses.

#### Fixed
- Closing temporary webview didn't work properly in some cases.
- Some areas were not reflecting the previous displayed course name change.


## [0.4.0] - 2020-05-05

#### Added
- Download and use standalone Java on Windows and Linux if java is missing from system.
- User can abort running TMC test process.
- Abort running TMC test process after 180 seconds.

#### Changed
- My courses now shows proper course name.
- Course details now shows proper course name.

#### Fixed
- Running local tests in background didn't show test results.


## [0.3.0] - 2020-04-27

#### Added
- Can change location of TMC data in settings.
- Checks if new exercises or updates are available for user's courses.
- Can download old submissions for exercises.
- Offer help to user if some local tests fail.

#### Changed
- TMC Langs executable version bumped to 0.7.17.
- Downgraded required VSCode version to 1.40.


## [0.2.0] - 2020-03-30

#### Added
- Send code to TMC Pastebin.
- Dropdown menu for TMC Commands next to run tests button.

#### Changed
- Limited download concurrency when downloading many exercises.
- Calculate course progress based on points.
- Show soft deadline for exercises if exists.
- Show errors related to user actions in webview panel.
- More convenient yes/no dialog for most prompts.

#### Fixed
- Workspace watcher path error on Windows.
- Error on exercise completion checking.


## [0.1.2] - 2020-03-19

#### Added
- TMC-Readme.txt in the TMC workspace.
- Marketplace icon.

#### Fixed
- Data validation issue with very old courses in the HY organization.


## [0.1.1] - 2020-03-18

#### Changed
- Faster deadline fetch in My Courses-view.
- Improved button styles in course details and downloads views.
- Improved exercise status tracking to account for missing exercises.

#### Fixed
- Missing breadcrumb in Exercise Download-view.
- Unlockable exercises couldn't be downloaded.


## [0.1.0] - 2020-03-17

#### Added
- Logging in with TMC account.
- Adding and removing courses.
- Downloading exercises.
- Opening extension's workspace.
- Opening and closing exercises in extension's workspace.
- Running exercise tests locally.
- Submitting a solution to TMC server.
- Resetting current active exercise.
- Course overview with a progress bar and next deadline.
