import * as cp from "child_process";
import { is } from "typescript-is";

/**
 * Check if calling java programs is possible.
 */
export async function isJavaPresent(): Promise<boolean> {
    let result = false;
    await new Promise((resolve) =>
        cp.exec("java -version", (error) => {
            result = error === null;
            resolve();
        }),
    );

    return result;
}

export function getPlatform(): "linux32" | "linux64" | "windows32" | "windows64" | "other" {
    const platform = process.platform;
    const arch = process.arch;
    if (platform === "linux") {
        return arch === "x64" ? "linux64" : "linux32";
    } else if (platform === "win32") {
        return arch === "x64" ? "windows64" : "windows32";
    }
    return "other";
}

/**
 * Runs a test to see whether or not superfluous properties are enabled within typescript-is
 * properties.
 */
export function superfluousPropertiesEnabled(): boolean {
    // Use configuration properties to see whether superflous object properties are enabled in
    // tsconfig. In the code this feature is primarily used when fetched API data is being parsed.
    // For configuration, see tsconfig.json used by webpack.dev.json
    // and tsconfig.production.json used by webpack.prod.json
    type TestType = {
        strict: boolean;
    };

    const testObject = {
        strict: true,
        superflous: "a superfluous property",
    };

    return is<TestType>(testObject);
}
