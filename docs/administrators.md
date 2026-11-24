# For administrators

Installing TestMyCode in a lab or exam room, or on managed computers.

- **Network:** allow HTTPS to `courses.mooc.fi`, `tmc.mooc.fi` and `download.mooc.fi` (see [troubleshooting.md](troubleshooting.md)).
- **Antivirus and application control:** the extension downloads the TestMyCode tools (`tmc-langs-cli`) into a `cli` folder under its VS Code global storage and runs them from there. Allow-list that folder. Policies that deny executables in user-writable folders (AppLocker default rules, WDAC, Software Restriction Policies) prevent the extension from working.
- **Pre-installed tools:** the extension will have a machine-scoped setting, `testMyCode.cliPath`, that points at a CLI installed by an administrator, so nothing is downloaded or run from a user-writable folder. The CLI must be the version this extension release pins, and is still checksum-verified.
- **Proxy:** set `HTTPS_PROXY` for VS Code's environment.
- **Linux:** glibc 2.30 or newer (2.28 with the next tools release).
- **Remote development:** each remote host needs the same access.
