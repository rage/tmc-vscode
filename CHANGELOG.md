# Changelog

## [Unreleased]

- Course pickers, such as Switch Course Workspace, name a course's server only beside a course that shares its title with another.
- The walkthrough ticks off Run Tests and Submit also when you open it in a later window, such as the course workspace's, as the extension remembers that you ran tests and submitted.
- An exercise update shows one progress notification: an update holds its exercise until it ends, so a check that began meanwhile cannot update it a second time, and an automatic update held back that way stays quiet. A failed update is told by the "Update failed" status bar item and the course home's notice, which go away once Try Again succeeds, instead of a notification that stayed.
- The two review states read apart in the course home, the Courses view and the status bar: "waiting for teacher review" with an eye, and "waiting for the chapter to be locked" with a milestone. A course home with nothing left to do but an exercise waiting for review says "Waiting for review" and names it, instead of "Nothing left to do right now".
- Open Next Exercise from a course's last exercise opens its course home with "You reached the last exercise", naming an earlier exercise still left to do, and offers that exercise as a secondary action instead of the main Continue button, until you open an exercise of the course or dismiss the notice.
- When several reasons stop a submission, every screen names the same one: the course's access or enrollment first, then the exercise's own (locked by the teacher, deadline passed, no tries left), then its chapter's (locked, not open yet, complete earlier chapters first). An exercise out of tries no longer reads "complete earlier chapters first" once chapter locking is on, and one whose chapter has not opened yet reads so on its results screen and in the status bar, with Get Help and History, instead of as removed from the course.
- A courses.mooc.fi exercise no longer offers Show Model Solution beside Open Course Material, as both opened the same page: the results screen, the course home, the Courses view and the status bar offer Open Course Material, which shows the model solution once it is revealed. The Show Model Solution command points a courses.mooc.fi exercise to Open Course Material, and a grading no longer makes an extra request to check for its model solution.
- Logging out leaves you logged out, not expired: the status bar keeps "TestMyCode: Log In" and the course home and Courses view keep "Not logged in" after a refresh, and an action that needs a login asks you to log in instead of saying you were logged out. Only an expired or revoked login reads "You were logged out. Log in again."
- In the course home, a chapter's lock reason has its own line under the chapter name, and an exercise name cut short shows in full in its tooltip. Focused chapter and section toggles are ringed inside their row, as VS Code rings a list row, and the More Actions menus are spaced like VS Code's own menus.
- History's refresh button sits in its header beside the title instead of on a line of its own.
- Notices in the course home, results, add-course and Error Details screens share one look: the same border, a coloured left edge for their kind, the icon level with the first line, and their buttons under the full-width text instead of squeezing it into a column.
- The Courses view's exercise menu and the exercise status bar item offer the same actions in the same order: Run Tests, Submit, Show Results, Get Help; History, Reset Exercise; Open Next Exercise, Show Model Solution, Open Course Material; Delete Generated Files, Close Exercise. The status bar adds Show in Courses View. The Explorer's TestMyCode menu keeps Run Tests, Submit, Get Help and History, and the Testing view no longer offers Submit.
- Exercise files open in the first editor group, beside the results screen instead of in its group, and a file already open is focused instead of opened twice. Error Details opens as a tab in the group of the screen you opened it from.
- When all tests pass on your computer, whether run from the results screen, the editor or the Testing view, the results screen opens and asks "All tests pass. Submit for grading?" with Submit and Not Now. Not Now leaves Submit beside Run Tests until the next run. It does not ask while logged out, in exam mode, or when the exercise cannot be submitted.
- Get Help is always in the results screen's More Actions, a passed exercise's too; the Get Help section shows by itself only on results that did not pass.
- Show Model Solution is never the main button of the results screen. Where there is none, the results screen and the course home offer Open Course Material instead.
- Each reason an exercise cannot be submitted has its own icon in the course home, the Courses view and the status bar: a watch for deadline passed, a crossed circle for no tries left, a lock for locked, a numbered list for complete earlier chapters first, a calendar for a chapter not open yet, a person for not enrolled and an eye for waiting for review.
- A long job, such as a download of several exercises, an update or waiting for a grading, shows its progress in a notification while the course home or results screen that shows it is out of sight, and the notification goes away when you bring the screen back.
- One status bar item shows what runs out of sight: a spinner reading "TestMyCode: <job>" while a refresh, an update check, a download or update, a test run or a submission until it is graded runs, with how many more run beside it. Clicking it opens the course home, the results screen or Test Results that shows the job. The exercise item no longer spins, and the failed-update item is the same item while nothing runs.
- New exercises found in the background are offered course by course: "N new exercises in <course>." with Download and Later, which asks again in 30 minutes. The new setting `testMyCode.newExercises` downloads them by themselves instead and says how many, or leaves them to the course home. Courses you are not enrolled on or have lost access to are not offered.
- The exercise actions of a passed exercise in a chapter not unlocked yet no longer say to complete earlier chapters first; the chapter says it.
- A course home you are not enrolled on no longer offers to download its exercises.
- Open Next Exercise, and Next in the results screen, only go forward in the course: from its last exercise left to do they open the course home, which offers the earlier ones. When the next exercise cannot be downloaded, the course home opens and says why instead of a notification.
- When tmc.mooc.fi cannot list its organizations, the add-course screen says its course list is unavailable, with Try Again, instead of an error blaming your network.
- While a teacher's review holds an exercise's points back, its results screen shows no score, as Course Details does: a passing grading reads All tests passed, and the exercise reads Waiting for review. The tmc.mooc.fi test server awards a passing submission's points and marks the exercise passed, as tmc.mooc.fi does, so its results screen, History and the Courses view agree.
- Refresh in Course Details checks the course's exercises for updates too, so an exercise the teacher changed shows as an update, or is updated, without Update Exercises, and a changed AI policy is noted there.
- The results screen no longer contradicts itself: an exercise that is not passed and can no longer be submitted is headed by why, such as Deadline passed, a local pass of such an exercise no longer asks you to submit it, and a failing submission of an exercise passed earlier is headed Passed, as the exercise reads in a later session.
- A lost login is told once: the screen on view says it with a single Log In, the status bar item always does, and a notification appears only while no TestMyCode screen is on view, once until you log in again. A login the server refused stays shown as logged out until you log in again. Logging in or out clears the failures a screen showed, a failed submission gives way to the exercise's standing once you log in or it can no longer be submitted, an action that succeeds clears its earlier failure, a repeated failure replaces the earlier one, and a successful course home refresh clears what earlier actions reported.
- An exercise download the server fails says "The server ran into a problem. Try again later." instead of blaming the exercise package; the server's own reason stays in Error Details.
- Error Details leads with Show Logs, with Copy Details beside it, unless the error has its own remedy.
- Error Details shows and copies your home folder as ~ (%USERPROFILE% on Windows) and leaves your user name out, in the error, its causes, the recent log and the startup help.
- A course whose exercises need a language extension VS Code lacks, Python's or Java's, says "Install the Python extension to run and debug your code." in its course home with Install, and the first time such an exercise opens a notification says the same, once per language until the extension is installed.
- A course workspace with AI assistance off opens with its AI settings already in place, so the chat side bar no longer shows there for the first seconds, and the secondary side bar is closed when it opens.
- Student-facing text follows one glossary: your MOOC.fi account, Log In, the course home (Open Course Home), Add Course, Submit, Passed and Not passed, Tests pass on your computer, Get Help with Send to Pastebin, History, Show in Courses View and Open Course Material. Lock reasons read Complete earlier chapters first, Locked by the teacher and Waiting for review. Errors say what happened and what to do, with codes and causes behind Show Details, and an expired or revoked login says "You were logged out. Log in again." Server names show only where you pick a course. A course with no AI policy says nothing about it, while AI assistance stays off.
- Refreshing a course home after logging out no longer shows an error there; its Not logged in notice already says what to do.
- The walkthrough's exercise steps open Course Details and Continue with an Exercise instead of a course quick pick, a download notification, or Run Tests and Submit Solution that only worked from an exercise file. Its Get help step offers Show Help.
- A course's changed AI policy is noted in its Course Details until dismissed, and notified only while Course Details is not on screen. An update you started is listed in Course Details too, with the status bar message only while it is not on screen, and a warning about your session found by a refresh shows in the Course Details on screen.
- A failed exercise update shows in Course Details: the updates notice becomes "Couldn't update N exercises" with why and Try Again. The failed-update status bar item opens that course's Course Details.
- Open Next Exercise with nothing left to do opens Course Details, which then says nothing is left to do right now. Commands that need a course open the add-course screen when none is added, as does Add Course in the Command Palette when neither site lists anything. Enroll on a course without a page of its own opens courses.mooc.fi.
- Submitting an exercise the course refuses, or one held back by the AI policy or a submission in progress, says so in its results screen while that is on screen. Passing tests while logged out opens the results screen with Log In to Submit. Exam mode no longer adds a notification to what Test Results says.
- A failed action in Course Details or the results screen, such as a download, shows in that screen until dismissed instead of in a notification. While the screen is out of sight a notification says so too, and the screen shows the failure when you return to it.
- Error notifications and the error notices in screens offer Show Details instead of Show Logs and inline details: a screen with the error, its causes and the recent log, with Copy Details, Show Logs and the error's own remedy. Show Help for the TestMyCode tools no longer claims the extension failed to start.
- Every notification goes through one place, and a test pins how many each part of the extension shows, so a new one is a deliberate choice.
- Logging in shows a login screen instead of a notification: your code in large type with Copy, and Open courses.mooc.fi, which opens the page where you approve it. The screen counts down until the code expires and says when the login is denied, the code expires or courses.mooc.fi cannot be reached or fails, with Try Again. Cancel or closing the screen stops the login. A login with no course added goes on to the add-course screen.
- Add Course opens a screen listing your courses.mooc.fi courses as cards with their organization and description, and the tmc.mooc.fi organizations, whose courses open under them. Search narrows both. Each site says on its own when you need to log in, it cannot be reached or you have no courses there, with Find a Course on courses.mooc.fi. Adding a course opens its Course Details; a course you already have is marked Added and opens. The Courses view, its welcome, the walkthrough and the screen after login open it; "TestMyCode: Add Course..." in the Command Palette keeps the quick pick.
- The submission result is now the exercise's results screen. Show Results, in the exercise's status bar actions, the Command Palette and the exercise menus, opens it for the exercise at hand, showing where the exercise stands when nothing was submitted in this session. Tests passing locally open it with Submit as its main action instead of a notification, unless it is still showing a submission being graded.
- The results screen's History lists an exercise's earlier submissions, help requests and backups with their date, score and outcome, marks the latest submission, and restores one after asking. Download Old Submission opens it instead of a list to pick from.
- The results screen's Get help sends the code via paste and shows the link with Copy Link and Open Link instead of a notification, saying when the code is unchanged since the last paste. Share Exercise via Paste opens it.
- A passed tmc.mooc.fi exercise offers its model solution in the results screen and the exercise's actions, not only after a submission. Once revealed, the model solution is a button on the results screen, and a course refresh that reveals it updates the open screen.
- In its course workspace, Course Details offers Continue with the next exercise to do once nothing is left to download. Its exercise rows say "In workspace" instead of "Open", and their open button has a clearer icon.
- The notification offering a course's workspace is not shown while that course's Course Details, which offers the same, is on screen.
- A courses.mooc.fi course links to its course material: the course from Course Details' menu, and each exercise from its row's menu.
- A courses.mooc.fi course you are not enrolled on, found by a refresh or a refused submission, says so in Course Details, with Enroll Again and Remove Course, and is marked "not enrolled" in the Courses view, where its exercises offer no Submit. Refreshing the course after enrolling again clears it.
- A course you can no longer reach, because it was hidden, closed or deleted on its site, says so in Course Details, with Find the Course and Remove Course, and is marked "no access" or "removed" in the Courses view. Its exercises on your computer still open and run their tests; Submit is hidden and downloads and pastes are refused, each saying why. A refresh once the course is back clears it; background refreshes check such a course only twice a day. Such a course no longer stops the exercise update check of your other courses.mooc.fi courses; a check that finds one marks it, and says so instead of the all-clear. Removing a course closes its Course Details.
- Download Old Submission marks a courses.mooc.fi submission graded to full points as passed, and shows each score out of the exercise's points.
- The walkthrough ticks off logging in, adding a course and downloading exercises when they were done before it was first shown, such as a login that carried over from an earlier install.
- The submission result is redesigned: it is titled with the exercise's name and its course, states the result in one banner with the points beside a thin bar, and offers one suggested next step: Run Tests after failing tests, Submit Again after a failed submission, Next after a pass. Showing the submission or the model solution in the browser and asking for help via paste are in its "⋯" menu, and the Close button is gone; the tab and the header still close it.
- Failing server tests are listed first with their messages, the passed ones behind Show passed tests, and the grader's feedback on a courses.mooc.fi submission is labelled as such.
- An error with a remedy, such as Log In, offers it as the result's first button.
- The help panel for a failed start and the error notices in every panel have a lighter style, with one suggested action and the rest in a "⋯" menu.
- Course Details is now the course's home page: its exercises by part, each with its status, points, deadline and whether it is downloaded, open or closed, with Open, Download, Reset and Download Old Submission on each; Download and Close Completed for the course; and notices for new exercises, updates, Restricted Mode, an unreachable site, an exam or a disabled course, each with its action. It shows what the Courses view shows, as it changes, including downloads in progress.
- Adding a course opens its Course Details instead of the "Added" notification, as do clicking a course in the Courses view, which also expands it, and Show Courses in the account menu when one course is at hand. A window opened on a course workspace shows its Course Details.
- New exercises and exercise updates are announced in Course Details. While it is not on screen, one notification with Show announces them, once each; downloading, updating and dismissing new exercises are done in Course Details, and Remind Me Later is gone. An automatic update is listed in Course Details until dismissed, and announced with Show while Course Details is not on screen.
- A window TestMyCode opens in a course workspace shows the Courses view instead of the Explorer.
- A window TestMyCode reopens in a course workspace shows the walkthrough on your next step instead of the one it last showed.
- A submission result left open behind another editor no longer comes back after a restart as a tab with nothing in it.
- The Workspace Trust editor, where Manage in VS Code's trust question leads, closes once you trust the workspace.
- Opening an exercise from the Courses view or with Next shows its file among your code instead of in the submission result's split, and Next closes the result.
- A Courses view row action used right after the view changed no longer answers "Open a file of an exercise first.": the view is redrawn only when its rows change.
- Selecting an exercise in the Courses view opens it, downloading it first, and shows its main source file; downloading or opening a single exercise does too.
- After a passing submission the result offers Next with the exercise to do next, as does "TestMyCode: Open Next Exercise"; a result short of a pass offers Run Tests and Submit Again.
- A course's menu, Course Details and "TestMyCode: Download All Exercises..." download every exercise not downloaded yet, and Download New Exercises does so for a course with nothing new. Course Details opens the course workspace and shows the course, expanded, in the Courses view.
- New exercises are offered once, when they appear, not again at every start, poll and submission. Nothing is offered right after a submission, automatic exercise updates show their progress in the status bar instead of a notification, and returning to the VS Code window checks for new exercises if the last check was over ten minutes ago. The course whose workspace is open is checked sooner: on returning to the window a minute or more after its last check, and every five minutes while the window has focus.
- Refresh Courses, now also in the Command Palette, asks the sites afresh instead of reusing an exercise update check from the last five minutes, and waits for a refresh already running instead of refusing.
- A lost session keeps your courses in the Courses view, where the exercises on your computer still open, close and run their tests; passing tests while logged out offers Log In to Submit. The session warning and the error for a lost session now say the same thing.
- Logging in and out are reported in the status bar.
- A paste link is copied to the clipboard as it arrives.
- Submitting with no tries left says the score is final instead of reporting a failed submission, and an exercise command run on a file outside every exercise names the file.
- A failed exercise update says the exercise was not updated and why, in plain words, and its row offers Update to retry. A failed automatic update shows in the status bar instead of a notification, and goes away once the exercise updates or no longer has an update.
- An exercise update you ask for says in the status bar which exercises it updated.
- Only README files open as a preview, and VS Code's own suggestion to install a language's extension is no longer joined by a second one for the workspace.
- A course pick with a single course added is skipped, except for Remove Course, and the open course is listed first.
- One name for each thing, and Title Case on every button: Add Course (was Add New Course / Add a Course), Show Course Details (was Go To Course Details), Delete Generated Files (was Clean Exercise), tmc.mooc.fi (was TMC Server).
- The walkthrough's download step offers Download All Exercises and is ticked off once exercises are downloaded, not on merely opening a course workspace, and its login step explains how to stop VS Code asking before every courses.mooc.fi link.
- Course workspaces now turn off Copilot, inline suggestions and, wherever a setting can, the AI features of other extensions, and turn them back off when they are switched on, including through a language-specific User setting.
- Submitting, including before a reset or restore, running tests and sharing via paste are refused, with what to change, while the course workspace's AI settings can't be applied or an AI extension no setting turns off, such as Cline or Claude Code, is enabled.
- Logging in now always uses the courses.mooc.fi account (a browser-based device-code login); the TestMyCode username and password form has been removed. An existing TestMyCode session keeps working until it expires.
- Raised the minimum required VS Code version to 1.100.
- In Restricted Mode the Courses view, login, adding courses and downloading keep working, and the view says why running tests, submitting, sharing via paste and deleting generated files are held back, with Trust Course Workspace as its first row; their notification says trust is needed and offers Trust Course Workspace, and the refused action runs once the workspace is trusted. A workspace cannot set `testMyCode.javaHome` until it is trusted.
- A course workspace that opens untrusted asks to be trusted, through VS Code's own trust question; where VS Code asks on startup, TestMyCode leaves that opening's question to VS Code, so a quick No is not asked again, and asks itself on later openings, which VS Code no longer asks on. Trust Course Workspace asks the same way. A course workspace opens with its exercises already in it, so one answer covers them; an exercise downloaded while it is open asks again.
- Course workspaces no longer keep their own copy of TestMyCode's settings, so a change in User settings applies inside them too; the copies earlier versions made are removed on the next start.
- Downloading or opening exercises outside their course workspace offers to open it, naming the course, instead of only marking them open.
- Switching from one course workspace to another no longer asks first; opening a course workspace over a folder of your own asks, naming the course and the folder, and offers a new window instead. The window a switch opens does not repeat the new-exercise and update offers the previous one made. Switch Course Workspace marks the course that is open.
- The walkthrough and the FAQ say to trust the course workspace, and each exercise downloaded into it.
- The extension now declares itself unsupported in virtual workspaces, such as a repository opened straight from GitHub, since it runs the TMC-langs CLI as a local process and stores exercises on disk.
- The backend name beside a course in the Courses view is now shown dimmed, next to the title, instead of appended to it.
- Logging in no longer opens a panel: courses.mooc.fi opens in your browser with your login code, and a notification you can cancel shows the code and waits while you approve there. A denied or expired login says so and offers Try Again.
- Your courses.mooc.fi account now shows in VS Code's Accounts menu, where you can also sign out.
- An error answer from courses.mooc.fi or tmc.mooc.fi now says the server returned an error, with its status, instead of asking you to check your internet connection or showing the raw response.
- Submitting or pasting a courses.mooc.fi exercise that has been removed from the course now says the exercise no longer exists and offers Refresh Courses, and an error's details no longer repeat the same cause twice.
- Every initialization error notification now offers Show Help.
- Fixed a newly added course's passed exercises not showing as passed right away.
- Fixed a courses.mooc.fi exercise showing as completed after any graded submission; it now takes full points.
- A graded courses.mooc.fi submission now says whether the exercise is passed or some tests failed, instead of only Exercise graded, and links to the exercise's page in the course material.
- The Courses view groups courses.mooc.fi exercises by chapter, and marks an exercise whose tries are used up; submitting it again is refused before anything is uploaded.
- Fixed removing a course saying it was removed even when the removal failed.
- A failed submission is now reported once, in the submission panel; a notification is added only when it offers a fix, such as Log In.
- Pasting, resetting an exercise or downloading an old submission while submissions are throttled now says so instead of doing nothing.
- An error in a command, or in an action started from the Courses view or Course Details, is now reported under that action's own name instead of a generic message.
- A paste from the exercise panel that fails now shows its error in the panel only, instead of also as a notification.
- A course workspace that fails to open is now reported.
- Checking for exercise updates no longer says "All exercises are up to date." when refreshing the courses failed, or when a site holding your courses could not be checked; that site's failure is reported instead.
- Updated TMC-langs to 0.42.1.
- Fixed Course Details sometimes staying blank for half a minute when shown again from its tab right after opening an exercise.
- Removed the Ctrl+Shift+T (Run Tests), Ctrl+Shift+C (Close Exercise) and Ctrl+Shift+A (Action Menu) shortcuts. They replaced VS Code's Reopen Closed Editor, terminal Copy and Toggle Block Comment in every course workspace, and copying from the terminal on Linux could close an exercise. To keep a shortcut for running tests, bind "TestMyCode: Run Tests" in Keyboard Shortcuts (Ctrl+K Ctrl+S).
- The Java Home setting now takes effect: Java exercises run with the JDK it names. It had been ignored.
- Removed the Insider Version setting, which did nothing.
- Notifications no longer start with "TestMyCode:", and error messages no longer show internal error class names, command ids or a doubled period. An out-of-date extension error now offers Update Extension.
- Opening another course workspace now confirms in a dialog with a named button instead of a Yes/No list that closed when clicked away from; logging out and closing an exercise no longer ask, as both are undone in one click. Reset and Download Old Submission ask once, with "Submit and Reset" and "Reset Without Submitting" style buttons, instead of twice, and only whether to go ahead when the code is what you last submitted. Wiping all data asks you to type DELETE.
- Changing Download Old Submission, Update Exercises Automatically or Hide Meta Files in the User settings now takes effect inside a course workspace too, instead of being overridden by the workspace's own copy. The settings are listed in a fixed order, and Log Level has a description.
- Command names are consistent: "Open Exercises Folder" and "Move Exercises Folder..." (was "Open TMC Data Folder" and "Change TMC Data Path"), "Share Exercise via Paste", "Show Courses", "Refresh Courses", "Get Started", "Show Logs (Debug)", and "..." on every command that asks for more. Messages no longer mention TMC-langs, and Settings opens only this extension's settings.
- A fresh install opens the new Get Started with TestMyCode walkthrough, which takes you from logging in to your first submission and ticks off each step as you do it, instead of the Welcome page. "TestMyCode: Get Started" reopens it. Updating the extension no longer opens anything over your work; the status bar says it was updated.
- The status bar shows whether you are logged in, and says so when your session has expired, until you log in again. While an exercise file is open, it also shows the exercise and its points, with a spinner while its tests or submission run; selecting it lists the exercise's actions.
- The TestMyCode sidebar's Courses view now lists each course's parts and exercises, with each exercise's status, points and next deadline, and replaces the My Courses page. Download, open, close, test and submit exercises from their rows or their context menu, select several to download, open or close them together, and use a course's menu to update its exercises, close the ones you have passed or remove it. The view's badge counts new exercises and updates, and the exercise you are editing is selected in it. Course Details now shows only the course overview, and "Show Courses" focuses the Courses view. The exercise status bar item's menu reveals the exercise in the Courses view, as does "Reveal in Courses View".
- New exercises found in several courses are now offered in one notification ("New exercises in 2 courses: …") with Download All, Remind Me Later and Don't Remind Again, instead of one notification per course. A failed update check on both sites is one notification, and "All exercises are up to date." shows in the status bar instead of a notification.
- When TestMyCode cannot start, it now shows one notification naming what failed, with Show Details and Show Logs, instead of a notification per failing step, a separate antivirus notification and a help page opened over your work.
- The TestMyCode sidebar view is now "Courses": it lists your courses with their points, with inline buttons to open a course's workspace and to download its new exercises, and Course Details and Remove Course in its context menu. The activity bar icon counts new exercises. While TestMyCode starts, while you are logged out, before you add a course and when it failed to start, the view says so and offers the next step. Open Exercises Folder, Log Out, Settings and Show Logs moved to the view's "…" menu, and refreshing shows progress in the view instead of a notification.
- Run Tests and Submit Solution are now buttons in the editor title bar, shown only on an exercise's own files, with theme-aware icons. The other exercise actions moved into a TestMyCode submenu in the explorer's context menu, and into the exercise's status bar item for the open file, replacing the orange Action Menu button and seven separate explorer entries. From the Command Palette, exercise commands are offered only while an exercise file is open.
- Add Course opens at once and fills in as each site answers, lists your courses.mooc.fi courses first under their own heading, searches organization names too, and has a Back button on the tmc.mooc.fi organization step. Picking a course you already have opens its details instead of adding it again. A new course offers Download and Open Course, which downloads the exercises it starts with and opens its workspace. Without a course to add, it offers to find one on courses.mooc.fi instead of a notification. Logging in with no course added goes straight to it.
- Resetting an exercise, downloading an old submission and sharing an exercise via paste now show progress, and reset, restore and clean say in the status bar when they are done.
- Run Tests reports through VS Code's testing UI: the results appear in the Test Results view, and style warnings as problems in the exercise's files.
- A submission's result looks the same for both sites. When courses.mooc.fi has not finished grading by the time the wait ends, the result offers Keep Waiting, and the status bar shows the exercise as submitting while it waits.
- Download New Exercises refuses to run while the same course's exercises are already downloading, instead of downloading them twice.
- Download Old Submission lists the newest submission first, marked Latest, with a readable local date and the result beside it.
- Course Details and the initialization help reopen after a window reload. A hidden TestMyCode panel no longer holds on to memory; showing it again keeps its scroll position, open sections, feedback draft and paste link.

## [3.5.5] - 2026-10-30

- Fixed the exercise panel getting stuck on "Loading TestMyCode..." when it had been hidden and reopened before its contents arrived.
- Fixed submissions failing with "Access is denied (os error 5)" on Windows once an exercise had been submitted before.
- Fixed overlapping test runs and submissions for the same exercise racing each other against the same directory; duplicate attempts are now rejected with a notification.
- Fixed exercises downloaded on Windows missing their `.tmcproject.yml`, which left files the exercise lists as student files out of submissions, by updating TMC-langs to 0.39.9.
- Fixed exercise commands acting on an unrelated exercise when the active file was on a different drive than the exercises.
- Fixed opening the course workspace that is already open asking to close it and reloading the window.
- Fixed cleaning a file or folder from the explorer not cleaning the exercise it belongs to.

## [3.5.4] - 2026-10-01

- Course workspaces now turn off VS Code's AI features.

## [3.5.3] - 2026-06-12

- Fixed the extension failing to start on VS Code 1.123 and later (Windows) when the CLI was downloaded or redownloaded, caused by its checksum file being read before the download had finished.

## [3.5.2] - 2026-06-12

- Fixed unnecessary CLI redownload on every startup caused by case-sensitive checksum comparison

## [3.5.1] - 2025-11-20

- Fixed CLI hash comparison on Windows
- Improved error messages on failure to run CLI

## [3.5.0] - 2025-10-09

- Improved exercise submission packaging to avoid overly large archives
- Improved extension data migration from one version to the next

## [3.4.2] - 2025-08-21

- Fixed unnecessary dynamic library dependency causing errors when the library was missing on the user's computer.

## [3.4.1] - 2025-08-21

- Fixed Python exercises including venv directories when packaging.

## [3.4.0] - 2025-07-17

- Improved error handling during initialization.
- Added shasum check for langs CLI executable.

## [3.3.0] - 2025-04-03

- Added command `tmc.logs` for opening the logs with a corresponding option in the extension menu.
- Added command `tmc.debug` that resets the logs before opening them in a file.

## [3.2.1] - 2025-03-11

- Improved error reporting when initialising the extension fails.

## [3.2.0] - 2025-02-25

- Test results now contain style warnings or errors for applicable exercises.

## [3.1.1] - 2025-02-21

- Improved error messages and logging.

## [3.1.0] - 2024-12-17

- Fixed downloading old submissions for C# exercises
- Fixed error messages not displaying in some cases when running tests
- Sort dialogue of old submissions by date
- Bumped TMC-langs version to 0.37.0

## [3.0.6] - 2024-11-07

- Added a warning for a large number of open exercises

## [3.0.5] - 2024-10-29

- Bumped TMC-langs version to 0.36.4
- Fixed issues with file locking on certain platforms
- Fixed the current file not refreshing when resetting an exercise

## [3.0.4] - 2024-08-29

- Bumped TMC-langs version to 0.36.3
- .csproj files are no longer included when submitting C# exercises
- Set the minimum supported VSCode version to 1.86.0 (released in January 2024)
- Fixed the TMC-langs CLI's permissions being set to 111

## [3.0.3] - 2024-02-26

- Fixed missing "Send solution to server" button when tests are ran successfully
- Fixed running tests for exam exercises not working correctly

## [3.0.2] - 2024-02-22

- Bumped TMC-langs version to 0.36.1
- Added a notice about the data collected by the extension

## [3.0.1] - 2024-01-25

- Redesigned the user interface
- Fixed a bug when changing the exercise directory on Windows
- Bumped TMC-langs version to 0.36.0

## [2.2.4] - 2023-10-10

- Improved error reporting when fetching and updating exercises
- Improved extension update procedure to be more robust against interrupted updates

## [2.2.3] - 2023-10-05

- Fixed another "Empty Langs Response Error" that would sometimes occur after submitting an exercise.

## [2.2.2] - 2023-09-13

- Fixed an "Empty Langs Response Error" that would sometimes occur after submitting an exercise.

## [2.2.1] - 2023-09-11

- Bumped TMC-langs version to 0.35.0.
- The `Open` button in the course exercise list will now download the exercises if they don't exist locally.
- Removed the `Download` button in the course exercise list.
- Added more logging.
- Fixed an issue that caused the extension to not work on ARM64 MacOS with ARM64 Java.

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

- Support for C# exercises that use .NET 6.0.

#### Changed

- Bumped TMC-langs to version 0.25.1.

## [2.1.2] - 2021-11-24

#### Changed

- Bumped TMC-langs to version 0.23.2.

#### Fixed

- TMC-langs: Download old submission to fallback to template download if 403 encountered (e.g. exam mode) when fetching users' old submissions.

## [2.1.1] - 2021-10-04

#### Added

- Better support for MacOS Big Sur.

#### Changed

- Bumped TMC-langs to version 0.23.1.

## [2.1.0] - 2021-07-05

#### Added

- Exercise decorations: Show completed, expired, partially completed and missing in course workspace file tree.
- Automatically download old submission (disabled since version 2.0.0).

#### Changed

- Bumped TMC-langs to version 0.21.0-beta-4.
- Moved Extension Settings behind VSCode Settings API. [Read more...](https://code.visualstudio.com/docs/getstarted/settings)
- Moved TMC folder selection to My Courses page.

#### Removed

- Custom Settings webview.

#### Security

- Updated dependencies.

## [2.0.3] - 2021-06-28

#### Fixed

- Bug when migrating Session state that caused extension to fail initialization in some cases.

## [2.0.2] - 2021-04-13

#### Fixed

- Prevent extension from immediately restarting after `Wipe all extension data` command.

#### Removed

- Timeout from most TMC-Langs processes to avoid issues with slow connections.

#### Security

- Updated dependencies.

## [2.0.1] - 2021-03-11

#### Fixed

- Broken light theme icons after lowest supported VS Code version bump.
- Missing logs when compile fails due to compile error.

#### Security

- Updated dependencies.

## [2.0.0] - 2021-03-07

#### Changed

- Major changes to exercise workspace management logic.
- Drastically improved exercise downloading performance.
- Improved logic when changing exercise data location.
- Improved usage of `Wipe all extension data` command.
- Technical improvements to settings page.
- Bumped lowest supported VS Code version from 1.40.0 to 1.52.0.
- TMC-langs and exercise workspace files are now stored always in a consistent location.
- Bumped TMC-langs to version 0.11.1.
- MacOS 11 to use x86 build of TMC-langs for now.

#### Fixed

- Don't try to recommend unavailable extensions on VSCodium.

#### Removed

- Automatically download old submission temporarily.
- Authentication status migration from versions below 1.0.
- Fake OK-buttons from notifications to follow new extension guidelines.

#### Security

- Updated dependencies.

## [1.3.4] - 2020-11-10

#### Changed

- Bumped TMC-langs to version 0.6.5.
- Updated all dependencies.

## [1.3.3] - 2020-11-06

#### Changed

- Bumped TMC-langs to version 0.6.3.

## [1.3.2] - 2020-11-05

#### Changed

- Bumped TMC-langs to version 0.6.2.

## [1.3.1] - 2020-11-03

#### Changed

- Rolled TMC-langs back to version 0.4.1.

## [1.3.0] - 2020-11-03

#### Added

- _Open TMC Exercises Folder_ button to TMC TreeView.
- Show warning message if running tests using too old Python version.
- Hint about possible Antivirus conflict if the extension fails to start.
- Arm64 build of TMC-langs for Mac OS.
- [Pylance](https://marketplace.visualstudio.com/items?itemName=ms-python.vscode-pylance) to recommended Python extensions.

#### Changed

- Reworked caching for TMC API data.
- Bumped TMC-langs to version 0.6.1.
  - Fixes path issues with some Python libraries when running tests on Windows.

#### Fixed

- Updateable exercises notification didn't disappear from Course Details page in some circumstances.

#### Security

- Updated dependencies.

## [1.2.0] - 2020-10-01

#### Added

- Option in settings to toggle automatic exercise updates.

#### Changed

- Exercise updates are now done automatically by default.

## [1.1.1] - 2020-09-29

#### Changed

- Bumped TMC-langs to version [0.4.1](https://github.com/rage/tmc-langs-rust/releases/tag/0.4.1).

## [1.1.0] - 2020-09-21

#### Added

- Handle logout when token has expired.
- Log out user if token is invalid.
- Run TMC Actions for exercises when right clicking exercise folders or files in the explorer view.
  - This way .ipynb notebooks can be tested and submitted more easily.
- Buttons to clear new exercises buffer from notification or course card.
- Inform user if TMC Extension is too old.
- Access to course details page from the TMC Tree Menu.
- Refresh button to fetch course and exercise updates in TMC Tree View.

#### Changed

- Technical improvements to Login page.
- Technical improvements to TMC TreeView menu.
- Bumped TMC-langs to version 0.4.0.
- Exam mode in submissions handled by TMC-langs.
- Distinguish between disabled courses and access denied for TMC-langs commands.
- Use course title instead of course name.

#### Security

- Updated dependencies.

## [1.0.1] - 2020-09-01

#### Fixed

- Prevent losing exercise data if update fails at a bad time.
- Broken image in Welcome view on some file systems.

## [1.0.0] - 2020-08-27

#### Added

- VSCode command for checking for exercise updates.
- Open logs folder button to Settings page.
- _Need Help?_ option on TMC Submission Result view.
- When downloading an exercise, download last submission by default.
  - Default behavior can be changed in Settings.

#### Changed

- Show some TMC-VSCode commands only when logged in.
- Bumped TMC-langs Rust to version 0.1.0.
- VSCode Python Interpreter path passed to TMC-langs Rust.
- All API Requests handled externally by TMC-langs Rust.
- Exercise related actions use TMC-langs Rust.
- TMC-langs commands to obfuscate sensitive details from TMC logs.
- Technical improvements to My Courses page.
- Remove obsolete "closed-exercise" folder from tmcdata if empty.

#### Removed

- Temporarily removed _Show submission in browser_ button in Submission Queue view.
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

- Bumped TMC-langs Rust to version 0.1.17-alpha.
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
- Show material URL in course details if defined.

#### Changed

- After resetting an exercise or downloading an old submission, reopen the active file.
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

- Send code to TMC Paste.
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
