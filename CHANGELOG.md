# Changelog

## [0.6.1] - 2020-06-17
- Revert 0.6.0

## [0.6.0] - 2020-06-17

### Changed
- Redesigned course detail page.

### Removed
- Download exercises page.
- Obsolete information from readme.

## [0.5.2] - 2020-06-12

### Changed
- Parse test result headers.

### Fixed
- Issue with filtering out 'False is not true'.

## [0.5.1] - 2020-06-12

### Added
- Filter out 'False is not true' from the start of failed test messages.

### Changed
- By default, show only one locally failed test.
- API Endpoint for fetching old submissions.
- Reduced local test process timeout to 15 seconds.

### Fixed
- Missing whitespace when showing test results.
- Regression: Closed exercises were not re-opened after updating.

### Security
- Updated dependencies.

## [0.5.0] - 2020-05-14

### Added
- Icons for running tests and opening TMC menu.
- Output channel for logging extension status information.
- User able to choose extension logging level in settings (default: Errors).

### Fixed
- Resolve errors if data was removed externally while the extension was running.

## [0.4.1] - 2020-05-08

### Changed
- Remove data of missing exercises when deleting course from My courses.

### Fixed
- Closing temporary webview didn't work properly in some cases.
- Some areas were not reflecting the previous displayed course name change.

## [0.4.0] - 2020-05-05

### Added
- Download and use standalone Java on Windows and Linux if java is missing from system.
- User can abort running TMC test process.
- Abort running TMC test process after 180 seconds.

### Changed
- My courses now shows proper course name.
- Course details now shows proper course name.

### Fixed
- Running local tests in background didn't show test results.

## [0.3.0] - 2020-04-27

### Added
- Can change location of TMC data in settings.
- Checks if new exercises or updates are available for user's courses.
- Can download old submissions for exercises.
- Offer help to user if some local tests fail.

### Changed
- TMC Langs executable version bumped to 0.7.17.
- Downgraded required VSCode version to 1.40.

## [0.2.0] - 2020-03-30

### Added
- Send code to TMC Pastebin.
- Dropdown menu for TMC Commands next to run tests button.

### Changed
- Limited download concurrency when downloading many exercises.
- Calculate course progress based on points.
- Show soft deadline for exercises if exists.
- Show errors related to user actions in webview panel.
- More convenient yes/no dialog for most prompts.

### Fixed
- Workspace watcher path error on Windows.
- Error on exercise completion checking.

## [0.1.2] - 2020-03-19

### Added
- TMC-Readme.txt in the TMC workspace.
- Marketplace icon.

### Fixed
- Data validation issue with very old courses in the HY organization.

## [0.1.1] - 2020-03-18

### Changed
- Faster deadline fetch in My Courses-view.
- Improved button styles in course details and downloads views.
- Improved exercise status tracking to account for missing exercises.

### Fixed
- Missing breadcrumb in Exercise Download-view.
- Unlockable exercises couldn't be downloaded.

## [0.1.0] - 2020-03-17

### Added
- Logging in with TMC account.
- Adding and removing courses.
- Downloading exercises.
- Opening extension's workspace.
- Opening and closing exercises in extension's workspace.
- Running exercise tests locally.
- Submitting a solution to TMC server.
- Resetting current active exercise.
- Course overview with a progress bar and next deadline.
