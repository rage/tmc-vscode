<script lang="ts">
    import { writable } from "svelte/store";
    import { Organization, SelectOrganizationPanel, assertUnreachable } from "./shared";
    import {
        addExtensionMessageListener,
        loadable,
        postMessageToWebview,
    } from "./utilities/script";

    export let panel: SelectOrganizationPanel;

    const organizations = loadable<Array<Organization>>();
    const pinned = loadable<Array<Organization>>();
    const tmcBackendUrl = loadable<string>();
    const filter = writable<string>("");

    function resolveLogoPath(tmcBackendUrl: string, path: string): string {
        return !path.endsWith("missing.png")
            ? `${tmcBackendUrl}${path}`
            : `${tmcBackendUrl}/logos/small_logo/missing.png`;
    }

    function selectOrganization(slug: string) {
        postMessageToWebview(panel.requestingPanel, {
            type: "selectedOrganization",
            slug,
        });
    }

    function filterOrganizations(query: string) {
        filter.set(query);
    }

    addExtensionMessageListener(panel, (message) => {
        switch (message.type) {
            case "setOrganizations": {
                message.organizations.sort((l, r) => l.name.localeCompare(r.name));
                organizations.set(message.organizations);
                pinned.set(message.organizations.filter((o) => o.pinned));
                break;
            }
            case "setTmcBackendUrl": {
                tmcBackendUrl.set(message.tmcBackendUrl);
                break;
            }
            default:
                assertUnreachable(message);
        }
    });
</script>

<div>
    <div class="org">
        <div>
            <h1 class="org-header">Frequently used organizations</h1>
            {#if $pinned && $tmcBackendUrl}
                {#each $pinned as pinned}
                    <div
                        class="org-row border-current-color"
                        on:click={() => selectOrganization(pinned.slug)}
                        on:keypress={() => selectOrganization(pinned.slug)}
                    >
                        <div>
                            <img
                                class="org-img"
                                src={resolveLogoPath($tmcBackendUrl, pinned.logo_path)}
                                alt={`Logo for ${pinned.name}`}
                            />
                        </div>
                        <div>
                            <h3>{pinned.name} <small class="text-muted">({pinned.slug})</small></h3>
                            <p>{pinned.information}</p>
                        </div>
                    </div>
                {/each}
            {/if}
        </div>
    </div>

    <div>
        <div>
            <h1>All organizations</h1>
            <div>
                <input
                    type="text"
                    placeholder="Search organizations"
                    on:keyup={(ev) => filterOrganizations(ev.currentTarget.value)}
                />
            </div>
        </div>
    </div>

    <div class="row">
        <div class="col">
            {#if $organizations && $tmcBackendUrl}
                {#each $organizations as organization}
                    <div
                        class="org-row organization"
                        on:click={() => selectOrganization(organization.slug)}
                        on:keypress={() => selectOrganization(organization.slug)}
                        hidden={$filter.length > 0 &&
                            !organization.name.toUpperCase().includes($filter.toUpperCase())}
                    >
                        <div>
                            <img
                                class="org-img"
                                src={resolveLogoPath($tmcBackendUrl, organization.logo_path)}
                                alt={`Logo for ${organization.name}`}
                            />
                        </div>
                        <div>
                            <h4>
                                {organization.name}
                                <small>({organization.slug})</small>
                            </h4>
                            <p>{organization.information}</p>
                        </div>
                    </div>
                {/each}
            {/if}
        </div>
    </div>
</div>
