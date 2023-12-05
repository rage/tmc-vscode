<script lang="ts">
    import { writable } from "svelte/store";
    import { SelectOrganizationPanel, assertUnreachable } from "../shared/shared";
    import { addMessageListener, loadable, postMessageToWebview } from "../utilities/script";
    import { Organization } from "../shared/langsSchema";
    import TextField from "../components/TextField.svelte";
    import { onMount } from "svelte";
    import { vscode } from "../utilities/vscode";

    export let panel: SelectOrganizationPanel;

    const organizations = loadable<Array<Organization>>();
    const pinned = loadable<Array<Organization>>();
    const tmcBackendUrl = loadable<string>();
    const filter = writable<string>("");

    onMount(() => {
        vscode.postMessage({
            type: "requestSelectOrganizationData",
            sourcePanel: panel,
        });
    });
    addMessageListener(panel, (message) => {
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

    function resolveLogoPath(tmcBackendUrl: string, path: string): string {
        return !path.endsWith("missing.png")
            ? `${tmcBackendUrl}${path}`
            : `${tmcBackendUrl}/logos/small_logo/missing.png`;
    }
    function selectOrganization(slug: string) {
        postMessageToWebview({
            type: "selectedOrganization",
            target: panel.requestingPanel,
            slug,
        });
    }
    function filterOrganizations(query: string) {
        filter.set(query.toUpperCase());
    }
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
                <h3>{pinned.name} <small class="org-slug">({pinned.slug})</small></h3>
                <p>{pinned.information}</p>
            </div>
        </div>
    {/each}
{:else}
    <vscode-progress-ring />
{/if}

<h1>All organizations</h1>
<div class="search-container">
    <TextField placeholder="Search organizations" onChange={(val) => filterOrganizations(val)} />
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
                    {organization.name} <small class="org-slug">({organization.slug})</small>
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
        height: 100px;
        margin: 0 auto;
        display: block;
        width: 100%;
        padding: 0.4rem;
    }
    .org-content {
        padding: 10px;
        flex-grow: 1;
    }
    .org-slug {
        opacity: 80%;
        word-wrap: break-word;
    }
    .search-container {
        padding: 0.4rem;
    }

    @media (min-width: 25rem) {
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
