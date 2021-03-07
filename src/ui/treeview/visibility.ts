import { VisibilityGroup, VisibilityGroupNegated } from "../types";

/**
 * Logic class for managing visibility of treeview actions
 */
export class Visibility {
    private _idsByGroup = new Map<string, string[]>();
    private _groupsById = new Map<string, string[]>();
    private _enabledSet = new Set<string>();
    private _nextId = 0;

    public createGroup(visible: boolean): VisibilityGroup {
        const groupId = "_" + this._nextId++;
        this._idsByGroup.set(groupId, []);
        this._idsByGroup.set(this._negate(groupId), []);
        this._enabledSet.add(visible ? groupId : this._negate(groupId));
        return { id: groupId, not: { id: this._negate(groupId) } };
    }

    /**
     * Implementation for the group registration, checks for name uniqueness and ensures
     * that no group names start with an exclamation mark
     * @param group Name of group
     * @param visible Should the group be active
     */
    public registerGroup(group: string, visible: boolean): void {
        if (group.startsWith("!")) {
            throw new Error("Visibility group name may not start with a exclamation mark");
        }
        if (this._idsByGroup.has(group)) {
            throw new Error("Group already registered");
        }
        this._idsByGroup.set(group, []);
        this._idsByGroup.set(this._negate(group), []);
        this._enabledSet.add(visible ? group : this._negate(group));
    }

    /**
     * Implementation for the registration of groups for an action, checks for group name
     * correctness.
     *
     * @param id Id of the action
     * @param groups Names of the associated groups, possibly negated
     */
    public registerAction(
        id: string,
        groups: Array<VisibilityGroup | VisibilityGroupNegated>,
    ): void {
        if (this._groupsById.has(id)) {
            throw new Error("Action already registered");
        }

        groups.forEach((x) => {
            const group = this._idsByGroup.get(x.id);
            if (!group) {
                throw new Error("No such visibility group: " + this._normalize(x.id));
            } else {
                group.push(id);
            }
        });
        this._groupsById.set(
            id,
            groups.map((x) => x.id),
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
        const groupId = group.id;
        if (this._enabledSet.has(groupId)) {
            return [];
        }

        const idsEnabled = this._idsByGroup.get(groupId);
        const idsDisabled = this._idsByGroup.get(this._negate(groupId));
        if (!idsEnabled || !idsDisabled) {
            throw new Error("No such visibility group: " + this._normalize(groupId));
        }

        const ids = idsEnabled.concat(idsDisabled);
        const currentVisibility = new Map<string, boolean>(
            ids.map((id) => [id, this.getVisible(id)]),
        );

        this._enabledSet.add(groupId);
        this._enabledSet.delete(this._negate(groupId));

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
        const groups = this._groupsById.get(id);
        if (!groups) {
            throw new Error("Visibility logic badly broken");
        }
        return groups.every((group) => this._enabledSet.has(group));
    }

    /**
     * Negates a visibility group, e.g. "loggedIn" <-> "!loggedIn"
     * @param group Group name to be negated
     */
    private _negate(group: string): string {
        return group.startsWith("!") ? group.substring(1) : "!" + group;
    }

    /**
     * Normalizes a visibility group, removing a prepended exclamation mark if present
     * @param group Group name to be normalized
     */
    private _normalize(group: string): string {
        return group.startsWith("!") ? group.substring(1) : group;
    }
}
