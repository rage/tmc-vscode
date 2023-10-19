# Changelog

## [2.2.4] - 2023-10-10

- Improved error reporting when fetching and updating exercises
- Improved extension update procedure to be more robust against interrupted updates

## [2.2.3] - 2023-10-05

- Fixed another "Empty Langs Response Error" that would sometimes occur after submitting an exercise.

## [2.2.2] - 2023-09-13

- Fixed an "Empty Langs Response Error" that would sometimes occur after submitting an exercise.

## [2.2.1] - 2023-09-11

-   Bumped TMC-langs version to 0.35.0.
-   The `Open` button in the course exercise list will now download the exercises if they don't exist locally.
-   Removed the `Download` button in the course exercise list.
-   Added more logging.
-   Fixed an issue that caused the extension to not work on ARM64 MacOS with ARM64 Java.

## [2.2.0] - 2023-08-23

Pre-release testing version.

## [2.1.5] - 2022-08-29

### Changed

Bumped TMC-langs to version 0.25.2.

## [2.1.4] - 2022-08-29

### Changed

Reverted TMC-langs back to version 0.23.2.

## [2.1.3] - 2022-08-26

#### Added

-   Support for C# exercises that use .NET 6.0.

#### Changed

-   Bumped TMC-langs to version 0.25.1.

## [2.1.2] - 2021-11-24

#### Changed

-   Bumped TMC-langs to version 0.23.2.

#### Fixed

-   TMC-langs: Download old submission to fallback to template download if 403 encountered (e.g. exam mode) when fetching users' old submissions.

## [2.1.1] - 2021-10-04

#### Added

-   Better support for MacOS Big Sur.

#### Changed

-   Bumped TMC-langs to version 0.23.1.

## [2.1.0] - 2021-07-05

#### Added

-   Exercise decorations: Show completed, expired, partially completed and missing in course workspace file tree.
-   Automatically download old submission (disabled since version 2.0.0).

#### Changed

-   Bumped TMC-langs to version 0.21.0-beta-4.
-   Moved Extension Settings behind VSCode Settings API. [Read more...](https://code.visualstudio.com/docs/getstarted/settings)
-   Moved TMC folder selection to My Courses page.

#### Removed

-   Custom Settings webview.

#### Security

-   Updated dependencies.

## [2.0.3] - 2021-06-28

#### Fixed

-   Bug when migrating Session state that caused extension to fail initialization in some cases.

## [2.0.2] - 2021-04-13

#### Fixed

-   Prevent extension from immediately restarting after `Wipe all extension data` command.

#### Removed

-   Timeout from most TMC-Langs processes to avoid issues with slow connections.

#### Security

-   Updated dependencies.

## [2.0.1] - 2021-03-11

#### Fixed

-   Broken light theme icons after lowest supported VS Code version bump.
-   Missing logs when compile fails due to compile error.

#### Security

-   Updated dependencies.

## [2.0.0] - 2021-03-07

#### Changed

-   Major changes to exercise workspace management logic.
-   Drastically improved exercise downloading performance.
-   Improved logic when changing exercise data location.
-   Improved usage of `Wipe all extension data` command.
-   Technical improvements to settings page.
-   Bumped lowest supported VS Code version from 1.40.0 to 1.52.0.
-   TMC-langs and exercise workspace files are now stored always in a consistent location.
-   Bumped TMC-langs to version 0.11.1.
-   MacOS 11 to use x86 build of TMC-langs for now.

#### Fixed

-   Don't try to recommend unavailable extensions on VSCodium.

#### Removed

-   Automatically download old submission temporarily.
-   Authentication status migration from versions below 1.0.
-   Fake OK-buttons from notifications to follow new extension guidelines.

#### Security

-   Updated dependencies.

## [1.3.4] - 2020-11-10

#### Changed

-   Bumped TMC-langs to version 0.6.5.
-   Updated all dependencies.

## [1.3.3] - 2020-11-06

#### Changed

-   Bumped TMC-langs to version 0.6.3.

## [1.3.2] - 2020-11-05

#### Changed

-   Bumped TMC-langs to version 0.6.2.

## [1.3.1] - 2020-11-03

#### Changed

-   Rolled TMC-langs back to version 0.4.1.

## [1.3.0] - 2020-11-03

#### Added

-   _Open TMC Exercises Folder_ button to TMC TreeView.
-   Show warning message if running tests using too old Python version.
-   Hint about possible Antivirus conflict if the extension fails to start.
-   Arm64 build of TMC-langs for Mac OS.
-   [Pylance](https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance) to recommended Python extensions.

#### Changed

-   Reworked caching for TMC API data.
-   Bumped TMC-langs to version 0.6.1.
    -   Fixes path issues with some Python libraries when running tests on Windows.

#### Fixed

-   Updateable exercises notification didn't disappear from Course Details page in some circumstances.

#### Security

-   Updated dependencies.

## [1.2.0] - 2020-10-01

#### Added

-   Option in settings to toggle automatic exercise updates.

#### Changed

-   Exercise updates are now done automatically by default.

## [1.1.1] - 2020-09-29

#### Changed

-   Bumped TMC-langs to version [0.4.1](https://github.com/rage/tmc-langs-rust/releases/tag/0.4.1).

## [1.1.0] - 2020-09-21

#### Added

-   Handle logout when token has expired.
-   Log out user if token is invalid.
-   Run TMC Actions for exercises when right clicking exercise folders or files in the explorer view.
    -   This way .ipynb notebooks can be tested and submitted more easily.
-   Buttons to clear new exercises buffer from notification or course card.
-   Inform user if TMC Extension is too old.
-   Access to course details page from the TMC Tree Menu.
-   Refresh button to fetch course and exercise updates in TMC Tree View.

#### Changed

-   Technical improvements to Login page.
-   Technical improvements to TMC TreeView menu.
-   Bumped TMC-langs to version 0.4.0.
-   Exam mode in submissions handled by TMC-langs.
-   Distinguish between disabled courses and access denied for TMC-langs commands.
-   Use course title instead of course name.

#### Security

-   Updated dependencies.

## [1.0.1] - 2020-09-01

#### Fixed

-   Prevent losing exercise data if update fails at a bad time.
-   Broken image in Welcome view on some file systems.

## [1.0.0] - 2020-08-27

#### Added

-   VSCode command for checking for exercise updates.
-   Open logs folder button to Settings page.
-   _Need Help?_ option on TMC Submission Result view.
-   When downloading an exercise, download last submission by default.
    -   Default behavior can be changed in Settings.

#### Changed

-   Show some TMC-VSCode commands only when logged in.
-   Bumped TMC-langs Rust to version 0.1.0.
-   VSCode Python Interpreter path passed to TMC-langs Rust.
-   All API Requests handled externally by TMC-langs Rust.
-   Exercise related actions use TMC-langs Rust.
-   TMC-langs commands to obfuscate sensitive details from TMC logs.
-   Technical improvements to My Courses page.
-   Remove obsolete "closed-exercise" folder from tmcdata if empty.

#### Removed

-   Temporarily removed _Show submission in browser_ button in Submission Queue view.
-   Download of AdoptOpenJDK if Java not present in system.
-   Download of TMC-langs Java CLI .jar file.

## [0.10.0] - 2020-08-10

#### Added

-   Welcome page, displayed when major or minor version changes.
-   VSCode Commands for most TMC actions.
-   VSCode Command for wiping all extension data.
-   Extension recommendations for course workspaces based on file language in workspace.
-   Possibility to download individual exercises in Course Page.

#### Changed

-   Bumped TMC-langs Rust to version 0.1.17-alpha.
-   Local exercise tests runs with TMC-langs Rust.
-   Course specific workspaces using VSCode Multi-root workspaces.
-   Need to close TMC Workspace if moving TMC Data from Settings.
-   Insider: Python executable path passed to TMC-langs Rust.
-   Insider: Most API Request handled externally by TMC-langs Rust.
-   Insider: Handle login and logout externally by TMC-langs Rust.
-   Insider: Exercise related actions uses TMC-langs Rust.

#### Fixed

-   Remove old Rust CLI versions.
-   Clear new exercise only when download succeeded for given exercise.

#### Removed

-   Insider notification on extension activation.

#### Security

-   Updated dependencies.

## [0.9.2] - 2020-07-21

#### Fixed

-   Status of new exercises was displayed as expired.

## [0.9.1] - 2020-07-16

#### Changed

-   Log level to verbose if insider.

#### Fixed

-   Quote TMC Rust cli path in command.

## [0.9.0] - 2020-07-15

#### Added

-   [Insider](https://github.com/rage/tmc-vscode/blob/master/docs/insider.md) version support.

#### Changed

-   Insider: Use TMC Langs Rust when running local tests.

#### Fixed

-   Not to check for new exercises or updates if logged out.

## [0.8.3] - 2020-07-08

#### Fixed

-   Refresh button was using cache data.

## [0.8.2] - 2020-07-07

#### Added

-   Support for disabled courses.
-   Refresh button to course details page.
-   Show material URL in course details if defined.

#### Changed

-   After resetting an exercise or downloading an old submission, reopen the active file.
-   Improvements to move TMC data folder operation and cleanup.
-   No longer auto-open exercise lists when starting a download.
-   Less pronounced hover effect on clickable cards.

#### Fixed

-   Data validation to not clear new exercises array and notification delay for courses.
-   Don't remove .vscode/settings.json in TMC workspace.

## [0.8.0] - 2020-06-30

#### Added

-   Exam mode.

#### Changed

-   All exercise downloads are now displayed with a progress notification.
-   "No deadline" text is shown only if there are no deadlines in a group of exercises.
-   Expand verbose logging for the extension.
-   TMC Langs executable version bumped to 0.8.5.

#### Removed

-   Exercise Download Progress page.

#### Fixed

-   Hide update exercises notification in Course View after pressing the button.
-   Error handling when attempting to send an expired exercise to TMC Paste.
-   Data validation to not remove user data if an API error was received.
-   Restore Course Details webview properly after the page had been hidden.
-   0.8.1 Hotfix: Validation issue on old user courses when receiving Authorization error.

## [0.7.1] - 2020-06-24

#### Changed

-   Darker disabled buttons.
-   Enable python.terminal.executeInFileDir for TMC Workspace.

#### Fixed

-   Problem showing HTML characters in TMC Test Results.
-   Disabled 'Open all' button if no exercises downloaded.

## [0.7.0] - 2020-06-23

#### Added

-   Hide/show exercise meta files. Hidden by default, can be changed in TMC Settings.
-   Provide an easy access from TMC Settings to change where webviews are opened.
-   Notify user if couldn't fetch API data on course page.

#### Changed

-   TMC Test Results and Submission pages are recycled after usage.

#### Fixed

-   User-defined Workspace Folder settings were automatically being deleted.
-   TMC Langs logs not appearing if test results (.tmc_test_results.json) can't be found.
-   Problem showing error messages with backslashes in TMC Test Results.

## [0.6.3] - 2020-06-18

#### Added

-   Show logs button to settings.
-   30min timer to poll for new exercises and updates for My courses.

#### Changed

-   0.6.4 Hotfix: Bumped TMC-Langs version to 0.8.2.
-   TMC-Langs process timeout increased to two minutes.

#### Removed

-   Exercise result parsing (now handled by TMC-Langs)

#### Fixed

-   Course page 'Update exercises' button.

## [0.6.0] - 2020-06-17

#### Added

-   Server submission button even when some tests fail.

#### Changed

-   Redesigned course detail page.

#### Removed

-   Download exercises page.
-   Obsolete information from readme.

#### Fixed

-   Faulty API data when downloading old submissions.
-   0.6.2 Hotfix: Broken course detail page scripts in production build.

## [0.5.2] - 2020-06-12

#### Added

-   Parsing to test names within displayed test results.
-   Filter out 'False is not true' from the start of failed test messages.

#### Changed

-   By default, show only one locally failed test.
-   API Endpoint for fetching old submissions.
-   Reduced local test process timeout to 15 seconds.

#### Fixed

-   Missing whitespace when showing test results.
-   Regression: Closed exercises were not re-opened after updating.

#### Security

-   Updated dependencies.

## [0.5.0] - 2020-05-14

#### Added

-   Icons for running tests and opening TMC menu.
-   Output channel for logging extension status information.
-   User able to choose extension logging level in settings (default: Errors).

#### Fixed

-   Resolve errors if data was removed externally while the extension was running.

## [0.4.1] - 2020-05-08

#### Changed

-   Remove data of missing exercises when deleting course from My courses.

#### Fixed

-   Closing temporary webview didn't work properly in some cases.
-   Some areas were not reflecting the previous displayed course name change.

## [0.4.0] - 2020-05-05

#### Added

-   Download and use standalone Java on Windows and Linux if java is missing from system.
-   User can abort running TMC test process.
-   Abort running TMC test process after 180 seconds.

#### Changed

-   My courses now shows proper course name.
-   Course details now shows proper course name.

#### Fixed

-   Running local tests in background didn't show test results.

## [0.3.0] - 2020-04-27

#### Added

-   Can change location of TMC data in settings.
-   Checks if new exercises or updates are available for user's courses.
-   Can download old submissions for exercises.
-   Offer help to user if some local tests fail.

#### Changed

-   TMC Langs executable version bumped to 0.7.17.
-   Downgraded required VSCode version to 1.40.

## [0.2.0] - 2020-03-30

#### Added

-   Send code to TMC Paste.
-   Dropdown menu for TMC Commands next to run tests button.

#### Changed

-   Limited download concurrency when downloading many exercises.
-   Calculate course progress based on points.
-   Show soft deadline for exercises if exists.
-   Show errors related to user actions in webview panel.
-   More convenient yes/no dialog for most prompts.

#### Fixed

-   Workspace watcher path error on Windows.
-   Error on exercise completion checking.

## [0.1.2] - 2020-03-19

#### Added

-   TMC-Readme.txt in the TMC workspace.
-   Marketplace icon.

#### Fixed

-   Data validation issue with very old courses in the HY organization.

## [0.1.1] - 2020-03-18

#### Changed

-   Faster deadline fetch in My Courses-view.
-   Improved button styles in course details and downloads views.
-   Improved exercise status tracking to account for missing exercises.

#### Fixed

-   Missing breadcrumb in Exercise Download-view.
-   Unlockable exercises couldn't be downloaded.

## [0.1.0] - 2020-03-17

#### Added

-   Logging in with TMC account.
-   Adding and removing courses.
-   Downloading exercises.
-   Opening extension's workspace.
-   Opening and closing exercises in extension's workspace.
-   Running exercise tests locally.
-   Submitting a solution to TMC server.
-   Resetting current active exercise.
-   Course overview with a progress bar and next deadline.
