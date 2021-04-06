//@ts-check

/**@type {import("./env").getPlatform} */
function getPlatform() {
    const platform = process.platform;
    const arch = process.arch;
    if (platform === "linux") {
        if (arch === "x64") {
            return "linux64";
        } else if (arch === "arm64") {
            return "linuxarm64";
        } else if (arch === "arm") {
            return "linuxarm";
        } else {
            return "linux32";
        }
    } else if (platform === "win32") {
        return arch === "x64" ? "windows64" : "windows32";
    } else if (platform === "darwin") {
        if (arch === "arm64") {
            return "macosarm64";
        }
        return arch === "x64" ? "macos64" : "macos32";
    }
    return "other";
}

/**@type {import("./env").getLangsCLIForPlatform} */
function getLangsCLIForPlatform(platform, version) {
    switch (platform) {
        case "linux32":
            return `tmc-langs-cli-i686-unknown-linux-gnu-${version}`;
        case "linux64":
            return `tmc-langs-cli-x86_64-unknown-linux-gnu-${version}`;
        case "linuxarm":
            return `tmc-langs-cli-armv7-unknown-linux-gnueabihf-${version}`;
        case "linuxarm64":
            return `tmc-langs-cli-aarch64-unknown-linux-gnu-${version}`;
        case "macosarm64":
        // return `tmc-langs-cli-aarch64-apple-darwin-${version}`;
        // falls through
        case "macos64":
            return `tmc-langs-cli-x86_64-apple-darwin-${version}`;
        case "windows32":
            return `tmc-langs-cli-i686-pc-windows-msvc-${version}.exe`;
        case "windows64":
            return `tmc-langs-cli-x86_64-pc-windows-msvc-${version}.exe`;
        default:
            // Currently set linux CLI as default, this is experimental, in future return error.
            return `tmc-langs-cli-x86_64-unknown-linux-gnu-${version}`;
    }
}

module.exports = { getLangsCLIForPlatform, getPlatform };
