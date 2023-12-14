export type Platform =
    | "linux32"
    | "linux64"
    | "linuxarm"
    | "linuxarm64"
    | "macos32"
    | "macos64"
    | "macosarm64"
    | "windows32"
    | "windows64"
    | "other";

export function getAllLangsCLIs(version: string): string[];

export function getLangsCLIForPlatform(platform: Platform, version: string): string;

export function getPlatform(): Platform;
