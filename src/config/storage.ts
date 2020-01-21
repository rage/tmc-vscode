import { ExtensionContext } from "vscode";

/**
 * Interface class for accessing stored TMC configuration and data.
 */
export default class Storage {

    private context: ExtensionContext;

    /**
     * Creates new instance of the TMC storage access object.
     * @param context context of the extension where all data is stored
     */
    constructor(context: ExtensionContext) {
        this.context = context;
    }

    /**
     * Gets currently stored course.
     * @returns currently stored course id or undefined if not set
     */
    public getCourseId(): string | undefined {
        return this.context.globalState.get("course");
    }

    /**
     * Gets currently stored organization slug.
     * @returns currently stored organization slug or undefined if not set
     */
    public getOrganizationSlug(): string | undefined {
        return this.context.globalState.get("organization");
    }

    /**
     * Stores the given course id.
     * @param courseId course id to store
     */
    public storeCourseId(courseId: string) {
        this.context.globalState.update("course", courseId);
    }

    /**
     * Stores the given organization slug.
     * @param organizationSlug organization slug to store
     */
    public storeOrganizationSlug(organizationSlug: string) {
        this.context.globalState.update("organization", organizationSlug);
    }

}
