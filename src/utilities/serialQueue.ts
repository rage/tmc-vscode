/** Runs tasks one at a time, each once every earlier one has settled. */
export class SerialQueue {
    private _tail: Promise<unknown> = Promise.resolve();

    /** Resolves or rejects as `task` does; a rejection does not stop the tasks queued after it. */
    public run<T>(task: () => T | Thenable<T>): Promise<T> {
        const result = this._tail.then(task);
        this._tail = result.catch(() => undefined);
        return result;
    }
}
