# Get Help

- Your course material comes first: it has the instructions for setting up the programming environment the course uses.
- [Installation guide](https://www.mooc.fi/en/installation/vscode) for TestMyCode in VS Code.
- [Frequently asked questions](https://github.com/rage/tmc-vscode/blob/master/docs/FAQ.md): logging in with a code, waiting for grading, tries and deadlines, lost course access, and reporting a bug with **Copy Details**.
- [Troubleshooting](https://github.com/rage/tmc-vscode/blob/master/docs/troubleshooting.md): downloads, antivirus and proxies.
- [Report a problem](https://github.com/rage/tmc-vscode/issues). **TestMyCode: Show Logs** opens the log to attach.

## What the extension sends

The extension has no trackers or telemetry. It is open source, and anyone can check what it does at [github.com/rage/tmc-vscode](https://github.com/rage/tmc-vscode).

- **Submit** sends the exercise folder, which holds only your solution, to the course's server. Before a **Reset** or **Restore**, the folder's current state is sent too, as a backup submission. We may check submissions for plagiarism, and we may use the IP address that sent one to block spam and prevent abuse.
- **Get Help** sends your solution and gives you a link your teacher or classmates can open. You and the course staff can always open it. If the code did not pass all tests, anyone who is logged in can; if it passed, only students with full points on that exercise can.
- The TestMyCode tools are downloaded once from download.mooc.fi.
- Requests to the course servers carry the version of this extension and the version of the TestMyCode tools. We use them to block outdated and misbehaving versions.
- **Run Tests** sends nothing.
