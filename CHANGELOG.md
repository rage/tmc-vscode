# Changelog

## [0.3.0] - 2020-04-21

#### Added
- Can change TMC data path in extension settings.
- Checks and informs if exercises are updated for user's courses.
- Checks and informs if new exercises available for user's courses.
- Old submissions for exercises can be downloaded.
- Offer help to user if some local tests fail.

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
