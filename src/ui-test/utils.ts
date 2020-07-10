import { promise } from "vscode-extension-tester";

/**
 * Waits until a positive amount of provided elements are found and returns them. If the optional
 * timeout parameter is given, stops searching at that point.
 */
const waitForElements = async <T>(
    elementsProvider: () => promise.Promise<T[]>,
    timeout?: number,
): Promise<T[]> => {
    let elements: T[];
    const end = timeout ? Date.now() + timeout : undefined;
    do {
        elements = await elementsProvider();
    } while (elements.length === 0 || (end && Date.now() > end));
    return elements;
};

export { waitForElements };
