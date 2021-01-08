export interface MigratedData<T> {
    data: T | undefined;
    obsoleteKeys: string[];
}
