// import { promise } from "vscode-extension-tester";

/**
 * Waits until a positive amount of provided elements are found and returns them. If the optional
 * timeout parameter is given, stops searching at that point.
 */
const waitForElements = async <T>(
    // Unused code, type used to be promise.Promise<T[]>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    elementsProvider: () => any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    comparator: (t: any) => Promise<boolean> = async (): Promise<boolean> => true,
    timeout?: number,
): Promise<T[]> => {
    let elements: T[];
    const end = timeout ? Date.now() + timeout : undefined;
    do {
        elements = [];
        const elems = await elementsProvider();
        if (!comparator) {
            elements = elems;
            continue;
        }
        for (const elem of elems) {
            if (await comparator(elem)) {
                elements.push(elem);
            }
        }
    } while (elements.length === 0 || (end && Date.now() > end));
    return elements;
};

export { waitForElements };
