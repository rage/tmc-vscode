import diskusage = require("diskusage-ng");
import { Err, Ok, Result } from "ts-results";

export async function checkFreeDiskSpace(path: string): Promise<Result<number, Error>> {
    return new Promise((resolve) => {
        diskusage(path, function (err: string, usage: { available: number }) {
            if (err) {
                resolve(new Err(new Error("Couldn't check available space")));
            } else {
                resolve(new Ok(usage.available));
            }
        });
    });
}
