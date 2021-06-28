export default function validateData<T>(
    data: unknown,
    validator: (object: unknown) => object is T,
): T | undefined {
    if (!data) {
        return undefined;
    }

    if (!validator(data)) {
        throw new Error(`Data type missmatch: ${JSON.stringify(data)}`);
    }

    return data;
}
