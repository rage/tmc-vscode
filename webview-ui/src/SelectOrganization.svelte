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
        filter.set(query.toUpperCase());
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

<h1>Frequently used organizations</h1>
{#if $pinned !== undefined && $tmcBackendUrl !== undefined}
    {#each $pinned as pinned}
        <div
            class="org-row"
            on:click={() => selectOrganization(pinned.slug)}
            on:keypress={() => selectOrganization(pinned.slug)}
        >
            <div class="org-img-container">
                <img
                    class="org-img"
                    src={resolveLogoPath($tmcBackendUrl, pinned.logo_path)}
                    alt={`Logo for ${pinned.name}`}
                />
            </div>
            <div class="org-content">
                <h3>{pinned.name} <small class="muted">({pinned.slug})</small></h3>
                <p>{pinned.information}</p>
            </div>
        </div>
    {/each}
{:else}
    <vscode-progress-ring />
{/if}

<h1>All organizations</h1>
<div>
    <input
        type="text"
        placeholder="Search organizations"
        on:keyup={(ev) => filterOrganizations(ev.currentTarget.value)}
    />
</div>

{#if $organizations !== undefined && $tmcBackendUrl !== undefined}
    {#each $organizations ?? [] as organization}
        <div
            class="org-row"
            on:click={() => selectOrganization(organization.slug)}
            on:keypress={() => selectOrganization(organization.slug)}
            hidden={$filter.length > 0 &&
                !organization.slug.toUpperCase().includes($filter) &&
                !organization.name.toUpperCase().includes($filter)}
        >
            <div class="org-img-container">
                <img
                    class="org-img"
                    src={resolveLogoPath($tmcBackendUrl, organization.logo_path)}
                    alt={`Logo for ${organization.name}`}
                />
            </div>
            <div class="org-content">
                <h4>
                    {organization.name} <small class="muted">({organization.slug})</small>
                </h4>
                <p>{organization.information}</p>
            </div>
        </div>
    {/each}
{:else}
    <vscode-progress-ring />
{/if}

<style>
    .org-row {
        cursor: pointer;
        border: 1px;
        border-style: inset;
        margin: 0.4rem;
        display: flex;
        flex-direction: column;
        padding: 10px;
        margin-bottom: 10px;
        min-height: 125px;
    }
    .org-img-container {
        width: 100%;
        background-color: white;
        display: flex;
        align-items: center;
    }
    .org-img {
        max-width: 100px;
        max-height: 100px;
        margin: 0 auto;
        display: block;
        width: 100%;
        padding: 0.4rem;
    }
    .org-content {
        flex-grow: 1;
    }
    .muted {
        opacity: 80%;
    }

    @media (orientation: landscape) {
        .org-row {
            flex-direction: row;
        }
        .org-img-container {
            width: auto;
        }
        .org-img {
            width: auto;
        }
        .org-content {
            margin-left: 0.4rem;
        }
    }

    [hidden] {
        display: none;
    }
</style>
