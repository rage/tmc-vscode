import { VisibilityGroup, VisibilityGroupNegated } from "./types";

/**
 * Logic class for managing visibility of treeview actions
 */
export class Visibility {
    private idsByGroup = new Map<string, string[]>();
    private groupsById = new Map<string, string[]>();
    private enabledSet = new Set<string>();
    private nextId = 0;

    public createGroup(visible: boolean) {
        const groupId = "_" + this.nextId++;
        this.idsByGroup.set(groupId, []);
        this.idsByGroup.set(this.negate(groupId), []);
        this.enabledSet.add(visible ? groupId : this.negate(groupId));
        return { _id: groupId, not: { _id: this.negate(groupId) } };
    }

    /**
     * Implementation for the group registration, checks for name uniqueness and ensures
     * that no group names start with an exclamation mark
     * @param group Name of group
     * @param visible Should the group be active
     */
    public registerGroup(group: string, visible: boolean) {
        if (group.startsWith("!")) {
            throw new Error("Visibility group name may not start with a exclamation mark");
        }
        if (this.idsByGroup.has(group)) {
            throw new Error("Group already registered");
        }
        this.idsByGroup.set(group, []);
        this.idsByGroup.set(this.negate(group), []);
        this.enabledSet.add(visible ? group : this.negate(group));
    }

    /**
     * Implementation for the registration of groups for an action, checks for group name correctness
     * @param id Id of the action
     * @param groups Names of the associated groups, possibly negated
     */
    public registerAction(id: string, groups: Array<VisibilityGroup | VisibilityGroupNegated>) {
        if (this.groupsById.has(id)) {
            throw new Error("Action already registered");
        }

        groups.forEach((x) => {
            const group = this.idsByGroup.get(x._id);
            if (!group) {
                throw new Error("No such visibility group: " + this.normalize(x._id));
            } else {
                group.push(id);
            }
        });
        this.groupsById.set(
            id,
            groups.map((x) => x._id),
        );
    }

    /**
     * Implementation for setting a single, possibly negated, group active
     * @param group Name of the group, can be negated
     * @returns List of ids and states for modified action visibilities
     */
    public setGroupVisible(
        group: VisibilityGroup | VisibilityGroupNegated,
    ): Array<[string, boolean]> {
        const groupId = group._id;
        if (this.enabledSet.has(groupId)) {
            return [];
        }

        const idsEnabled = this.idsByGroup.get(groupId);
        const idsDisabled = this.idsByGroup.get(this.negate(groupId));
        if (!idsEnabled || !idsDisabled) {
            throw new Error("No such visibility group: " + this.normalize(groupId));
        }

        const ids = idsEnabled.concat(idsDisabled);
        const currentVisibility = new Map<string, boolean>(
            ids.map((id) => [id, this.getVisible(id)]),
        );

        this.enabledSet.add(groupId);
        this.enabledSet.delete(this.negate(groupId));

        const changes: Array<[string, boolean]> = [];

        ids.forEach((id) => {
            const visible = this.getVisible(id);
            if (currentVisibility.get(id) !== visible) {
                changes.push([id, visible]);
            }
        });

        return changes;
    }

    /**
     * Determines whether a specific action should be visible
     * @param id Id of the action to check
     */
    public getVisible(id: string): boolean {
        const groups = this.groupsById.get(id);
        if (!groups) {
            throw new Error("Visibility logic badly broken");
        }
        return groups.every((group) => this.enabledSet.has(group));
    }

    /**
     * Negates a visibility group, e.g. "loggedIn" <-> "!loggedIn"
     * @param group Group name to be negated
     */
    private negate(group: string): string {
        return group.startsWith("!") ? group.substring(1) : "!" + group;
    }

    /**
     * Normalizes a visibility group, removing a prepended exclamation mark if present
     * @param group Group name to be normalized
     */
    private normalize(group: string): string {
        return group.startsWith("!") ? group.substring(1) : group;
    }
}
