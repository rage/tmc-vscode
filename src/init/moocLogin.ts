import { CLIENT_NAME, TMC_LANGS_CONFIG_DIR } from "../config/constants";
import { Logger } from "../utilities/logger";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";

/**
 * Whether the langs config dir holds a courses.mooc.fi login from 4.x. The langs version this
 * build pins reads only `credentials.json`, so such a login does not log the student in here.
 */
export async function hasMoocLoginFromNewerVersion(): Promise<boolean> {
    const configDir = langsClientConfigDir();
    if (!configDir) {
        return false;
    }
    try {
        const entries = await fs.readdir(configDir);
        return entries.some((x) => x.startsWith("credentials_mooc") && x.endsWith(".json"));
    } catch (e) {
        Logger.debug(`Could not list ${configDir}:`, e);
        return false;
    }
}

/** Resolves the dir the way tmc-langs does: `dirs::config_dir()` unless overridden. */
function langsClientConfigDir(): string | undefined {
    const override = process.env.TMC_LANGS_CONFIG_DIR ?? TMC_LANGS_CONFIG_DIR;
    const base = override ?? platformConfigDir();
    return base && path.join(base, `tmc-${CLIENT_NAME}`);
}

function platformConfigDir(): string | undefined {
    switch (process.platform) {
        case "win32":
            return process.env.APPDATA;
        case "darwin":
            return path.join(os.homedir(), "Library", "Application Support");
        default: {
            const xdg = process.env.XDG_CONFIG_HOME;
            return xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".config");
        }
    }
}
