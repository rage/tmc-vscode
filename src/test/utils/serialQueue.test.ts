import { SerialQueue } from "../../utilities";
import { expect } from "chai";

suite("SerialQueue class", function () {
    test("starts a task only once the one before it has settled", async function () {
        const queue = new SerialQueue();
        const events: string[] = [];

        const first = queue.run(async () => {
            events.push("first started");
            await new Promise((resolve) => setTimeout(resolve, 10));
            events.push("first done");
        });
        const second = queue.run(() => {
            events.push("second started");
        });
        await Promise.all([first, second]);

        expect(events).to.deep.equal(["first started", "first done", "second started"]);
    });

    test("a rejected task rejects its own caller and does not stop the next", async function () {
        const queue = new SerialQueue();

        const failing = queue.run(() => {
            throw new Error("refused");
        });
        const next = queue.run(() => "ran");

        let error: unknown;
        await failing.catch((e) => {
            error = e;
        });
        expect((error as Error).message).to.equal("refused");
        expect(await next).to.equal("ran");
    });
});
