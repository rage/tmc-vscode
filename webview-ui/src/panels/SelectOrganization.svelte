<script lang="ts">
  import { onMount } from "svelte"

  import TextField from "../components/TextField.svelte"
  import { Organization } from "../shared/langsSchema"
  import type { SelectOrganizationPanel } from "../shared/shared"
  import { assertUnreachable } from "../shared/shared"
  import { addMessageListener, postMessageToWebview, resolveLogoPath } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: SelectOrganizationPanel
  }

  let { panel }: Props = $props()

  let organizations = $state<Array<Organization> | undefined>(undefined)
  let pinned = $state<Array<Organization> | undefined>(undefined)
  let tmcBackendUrl = $state<string | undefined>(undefined)
  let error = $state<string | undefined>(undefined)
  let filter = $state<string>("")

  onMount(() => {
    vscode.postMessage({
      type: "requestSelectOrganizationData",
      sourcePanel: panel,
    })
  })
  // svelte-ignore state_referenced_locally -- the panel identity (id/type)
  // is fixed for the lifetime of the component, capturing the initial value is intended
  addMessageListener(panel, (message) => {
    switch (message.type) {
      case "setOrganizations": {
        message.organizations.sort((l, r) => l.name.localeCompare(r.name))
        organizations = message.organizations
        pinned = message.organizations.filter((o) => o.pinned)
        break
      }
      case "setTmcBackendUrl": {
        tmcBackendUrl = message.tmcBackendUrl
        break
      }
      case "requestSelectOrganizationDataError": {
        error = message.error
        break
      }
      default:
        assertUnreachable(message)
    }
  })

  function selectOrganization(slug: string) {
    postMessageToWebview({
      type: "selectedOrganization",
      target: panel.requestingPanel,
      slug,
    })
  }
</script>

<!-- Shared by the pinned and full lists; only the full list filters by search term
     (via `hidden`). -->
{#snippet orgRow(organization: Organization, backendUrl: string, hidden: boolean)}
  <div
    role="button"
    tabindex="0"
    class="org-row"
    onclick={() => selectOrganization(organization.slug)}
    onkeypress={() => selectOrganization(organization.slug)}
    {hidden}
  >
    <div class="org-img-container">
      <img
        class="org-img"
        src={resolveLogoPath(backendUrl, organization.logo_path)}
        alt={`Logo for ${organization.name}`}
      />
    </div>
    <div class="org-content">
      <h3>
        {organization.name} <small class="org-slug">({organization.slug})</small>
      </h3>
      <p>{organization.information}</p>
    </div>
  </div>
{/snippet}

{#if error !== undefined}
  <div class="error" role="alert">Error: {error}</div>
{:else}
  <h1>Select an organization</h1>
  <h2>Frequently used organizations</h2>
  {#if pinned !== undefined && tmcBackendUrl !== undefined}
    {#each pinned as pinnedOrganization}
      {@render orgRow(pinnedOrganization, tmcBackendUrl, false)}
    {/each}
  {:else}
    <vscode-progress-ring aria-label="Loading"></vscode-progress-ring>
  {/if}

  <h2>All organizations</h2>
  <div class="search-container">
    <TextField
      label="Search organizations"
      placeholder="Search organizations"
      icon="search"
      bind:value={filter}
    />
  </div>

  {#if organizations !== undefined && tmcBackendUrl !== undefined}
    {#each organizations ?? [] as organization}
      {@render orgRow(
        organization,
        tmcBackendUrl,
        filter.length > 0 &&
          !organization.slug.toUpperCase().includes(filter.toUpperCase()) &&
          !organization.name.toUpperCase().includes(filter.toUpperCase()),
      )}
    {/each}
  {:else}
    <vscode-progress-ring aria-label="Loading"></vscode-progress-ring>
  {/if}
{/if}

<style>
  .org-row {
    cursor: pointer;
    border: 1px solid var(--vscode-widget-border, transparent);
    border-radius: 0.4rem;
    margin: 0.4rem;
    display: flex;
    flex-direction: column;
    margin-bottom: 0.6rem;
    min-height: 8rem;
  }
  .org-row:hover {
    background-color: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.1));
  }
  .org-row:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 2px;
  }
  .org-img-container {
    width: 100%;
    background-color: var(--vscode-editorWidget-background, #d3d3d3);
    display: flex;
    align-items: center;
  }
  .org-img {
    max-width: 6rem;
    height: 6rem;
    margin: 0 auto;
    display: block;
    width: 100%;
    padding: 0.4rem;
  }
  .org-content {
    padding: 0.6rem;
    flex-grow: 1;
  }
  .org-slug {
    opacity: 80%;
    word-wrap: break-word;
  }
  .search-container {
    padding: 0.4rem;
  }
  .error {
    color: var(--vscode-notebookStatusErrorIcon-foreground, #f85149);
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
