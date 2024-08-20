import * as fs from "fs-extra";
import * as tmp from "tmp";

interface Dir {
    [files: string]: string | Dir;
}

export function makeTmpDirs(dir: Dir): string {
    const tmpDir = tmp.dirSync();
    const tmpRoot = tmpDir.name;
    makeTmpDirsInner(tmpRoot, dir);
    return tmpRoot;
}

function makeTmpDirsInner(root: string, dir: Dir): void {
    for (const [path, contents] of Object.entries(dir)) {
        const fullPath = root.replace(/\/$/, "") + "/" + path.replace(/^\//, "");
        if (typeof contents === "string") {
            console.log("writing", fullPath);
            fs.outputFileSync(fullPath, contents);
        } else {
            console.log("making", fullPath);
            fs.mkdirsSync(fullPath);
            makeTmpDirsInner(fullPath, contents);
        }
    }
}
