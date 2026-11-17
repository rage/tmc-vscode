<script lang="ts">
  import { onMount, tick } from "svelte"

  import type {
    AddCoursePanel,
    CatalogCourse,
    CatalogOrganization,
    MoocCatalog,
    TmcOrganizations,
    WebviewError,
  } from "../../../shared/lib"
  import { backendName } from "../../../shared/lib"
  import ActionMenu from "../components/ActionMenu.svelte"
  import Button from "../components/Button.svelte"
  import ErrorNotice from "../components/ErrorNotice.svelte"
  import Notice from "../components/Notice.svelte"
  import PanelHeader from "../components/PanelHeader.svelte"
  import Section from "../components/Section.svelte"
  import Spinner from "../components/Spinner.svelte"
  import ToolbarButton from "../components/ToolbarButton.svelte"
  import { announce } from "../utilities/a11y.svelte"
  import { createRequester } from "../utilities/script"
  import { restoreScroll, uiState } from "../utilities/uiState.svelte"
  import { vscode } from "../utilities/vscode"
  import CatalogCard from "./addCourse/CatalogCard.svelte"

  interface Props {
    panel: AddCoursePanel
  }

  /** Lists the courses the student can add, from both backends, and adds the one picked. */
  let { panel }: Props = $props()

  type Loadable<T> =
    | { state: "loading" }
    | { state: "failed"; error: WebviewError }
    | { state: "loaded"; value: T }

  const MOOC = backendName("mooc")
  const TMC = backendName("tmc")

  let mooc = $state.raw<Loadable<MoocCatalog>>({ state: "loading" })
  let organizations = $state.raw<Loadable<TmcOrganizations>>({ state: "loading" })
  let organizationCourses = $state.raw<Loadable<CatalogCourse[]>>({ state: "loading" })
  const query = uiState("query", "")
  // The slug of the organization whose courses the tmc section shows; empty for none.
  const browsed = uiState("organization", "")
  let addingKey = $state<string | undefined>(undefined)
  let addFailure = $state<{ key: string; error: WebviewError } | undefined>(undefined)
  let organizationHeading = $state<HTMLElement | undefined>(undefined)

  const request = createRequester()
  const sourcePanel = $derived({ id: panel.id, type: panel.type })

  const browsedOrganization = $derived(
    organizations.state === "loaded" && organizations.value.kind === "listed"
      ? organizations.value.items.find((organization) => organization.slug === browsed.current)
      : undefined,
  )

  async function loadMooc() {
    mooc = { state: "loading" }
    const outcome = await request("requestMoocCatalog", { sourcePanel })
    mooc = outcome.ok ? { state: "loaded", value: outcome.value } : failed(outcome.error)
  }

  async function loadOrganizations() {
    organizations = { state: "loading" }
    const outcome = await request("requestTmcOrganizations", { sourcePanel })
    organizations = outcome.ok ? { state: "loaded", value: outcome.value } : failed(outcome.error)
    if (browsedOrganization) {
      void loadOrganizationCourses(browsedOrganization.slug)
    } else {
      browsed.current = ""
    }
  }

  async function loadOrganizationCourses(organizationSlug: string) {
    organizationCourses = { state: "loading" }
    const outcome = await request("requestTmcCourses", { sourcePanel, organizationSlug })
    if (browsed.current === organizationSlug) {
      organizationCourses = outcome.ok
        ? { state: "loaded", value: outcome.value }
        : failed(outcome.error)
    }
  }

  function failed(error: WebviewError): Loadable<never> {
    return { state: "failed", error }
  }

  onMount(() => {
    void Promise.all([loadMooc(), loadOrganizations()]).then(async () => {
      await tick()
      restoreScroll()
    })
  })

  async function browse(organization: CatalogOrganization) {
    browsed.current = organization.slug
    void loadOrganizationCourses(organization.slug)
    await tick()
    organizationHeading?.focus()
  }

  async function leaveOrganization() {
    const left = browsed.current
    browsed.current = ""
    await tick()
    if (left) {
      document.querySelector<HTMLElement>(`[data-organization="${CSS.escape(left)}"]`)?.focus()
    }
  }

  async function add(course: CatalogCourse) {
    if (addingKey !== undefined) {
      return
    }
    addingKey = course.key
    addFailure = undefined
    const outcome = await request("addCourse", { sourcePanel, key: course.key })
    addingKey = undefined
    if (!outcome.ok) {
      addFailure = { key: course.key, error: outcome.error }
    }
  }

  function logIn() {
    vscode.postMessage({ type: "addCourseAction", sourcePanel, action: "logIn" })
  }

  function findCourse() {
    vscode.postMessage({ type: "addCourseAction", sourcePanel, action: "findCourse" })
  }

  /** Whether `fields` together contain every word of the search. */
  function matches(...fields: (string | undefined)[]): boolean {
    const terms = query.current.toLocaleLowerCase().split(/\s+/).filter(Boolean)
    const text = fields.filter(Boolean).join(" ").toLocaleLowerCase()
    return terms.every((term) => text.includes(term))
  }

  const shownMoocCourses = $derived(
    mooc.state === "loaded" && mooc.value.kind === "listed"
      ? mooc.value.items.filter((course) =>
          matches(course.name, course.organization, course.description),
        )
      : [],
  )
  const shownOrganizations = $derived(
    organizations.state === "loaded" && organizations.value.kind === "listed"
      ? organizations.value.items.filter((organization) =>
          matches(organization.name, organization.description),
        )
      : [],
  )
  const shownOrganizationCourses = $derived(
    organizationCourses.state === "loaded"
      ? organizationCourses.value.filter((course) =>
          matches(course.name, course.organization, course.description),
        )
      : [],
  )

  // Waits for the typing to pause, so a screen reader is not told every keystroke's count.
  $effect(() => {
    if (query.current.trim() === "") {
      return
    }
    const courses = shownMoocCourses.length + shownOrganizationCourses.length
    const summary = browsedOrganization
      ? `${plural(courses, "course")} found`
      : `${plural(courses, "course")} and ${plural(shownOrganizations.length, "organization")} found`
    const timer = setTimeout(() => announce(summary), 600)
    return () => clearTimeout(timer)
  })

  function plural(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? "" : "s"}`
  }
</script>

{#snippet noMatches()}
  <p class="muted">Nothing here matches “{query.current.trim()}”.</p>
{/snippet}

{#snippet courseList(courses: CatalogCourse[], label: string)}
  <ul class="cards" aria-label={label}>
    {#each courses as course (course.key)}
      <CatalogCard
        name={course.name}
        context={course.organization}
        description={course.description}
        failure={addFailure?.key === course.key
          ? {
              title: `Could not add ${course.name}`,
              error: addFailure.error,
              ondismiss: () => (addFailure = undefined),
            }
          : undefined}
      >
        {#snippet action()}
          {#if course.isAdded}
            <span class="added muted">
              <vscode-icon name="check" aria-hidden="true"></vscode-icon>
              Added
            </span>
            <Button secondary aria-label="Open {course.name}" onclick={() => void add(course)}>
              Open
            </Button>
          {:else if addingKey === course.key}
            <Spinner label="Adding…" />
          {:else}
            <Button
              secondary
              disabled={addingKey !== undefined}
              aria-label="Add {course.name}"
              onclick={() => void add(course)}
            >
              Add
            </Button>
          {/if}
        {/snippet}
      </CatalogCard>
    {/each}
  </ul>
{/snippet}

<div class="add-course">
  <PanelHeader title="Add Course">
    {#snippet toolbar()}
      <ActionMenu actions={[{ label: `Find a Course on ${MOOC}`, onselect: findCourse }]} />
    {/snippet}
  </PanelHeader>
  <p class="muted intro">Pick the course you're taking.</p>

  <div class="search">
    <vscode-icon name="search" aria-hidden="true"></vscode-icon>
    <input
      type="search"
      placeholder="Search courses"
      aria-label="Search courses and organizations"
      bind:value={query.current}
    />
  </div>

  <Section title={MOOC}>
    {#if mooc.state === "loading"}
      <Spinner label="Loading your courses…" />
    {:else if mooc.state === "failed"}
      <ErrorNotice error={mooc.error} title="Could not list your {MOOC} courses">
        {#snippet actions()}
          <Button secondary onclick={() => void loadMooc()}>Try Again</Button>
        {/snippet}
      </ErrorNotice>
    {:else if mooc.value.kind === "loggedOut"}
      <Notice kind="info" title="Not logged in">
        <p>Log in with your MOOC.fi account to see the courses you are enrolled in.</p>
        {#snippet actions()}
          <Button onclick={logIn}>Log In</Button>
        {/snippet}
      </Notice>
    {:else if mooc.value.items.length === 0}
      <p>You are not enrolled on any {MOOC} course with programming exercises yet.</p>
      <div class="actions">
        <Button secondary onclick={findCourse}>Find a Course on {MOOC}</Button>
      </div>
    {:else if shownMoocCourses.length === 0}
      {@render noMatches()}
    {:else}
      {@render courseList(shownMoocCourses, `${MOOC} courses`)}
    {/if}
  </Section>

  <Section title={TMC}>
    {#if browsedOrganization}
      <div class="organization-header">
        <ToolbarButton
          icon="arrow-left"
          label="Back to Organizations"
          onclick={leaveOrganization}
        />
        <h3 bind:this={organizationHeading} tabindex="-1">{browsedOrganization.name}</h3>
      </div>
      {#if organizationCourses.state === "loading"}
        <Spinner label="Loading the courses of {browsedOrganization.name}…" />
      {:else if organizationCourses.state === "failed"}
        <ErrorNotice
          error={organizationCourses.error}
          title="Could not list the courses of {browsedOrganization.name}"
        >
          {#snippet actions()}
            <Button
              secondary
              onclick={() =>
                browsedOrganization && void loadOrganizationCourses(browsedOrganization.slug)}
            >
              Try Again
            </Button>
          {/snippet}
        </ErrorNotice>
      {:else if organizationCourses.value.length === 0}
        <p class="muted">This organization has no courses.</p>
      {:else if shownOrganizationCourses.length === 0}
        {@render noMatches()}
      {:else}
        {@render courseList(shownOrganizationCourses, `Courses of ${browsedOrganization.name}`)}
      {/if}
    {:else if organizations.state === "loading"}
      <Spinner label="Loading the organizations…" />
    {:else if organizations.state === "failed"}
      <ErrorNotice error={organizations.error} title="Could not list the {TMC} organizations">
        {#snippet actions()}
          <Button secondary onclick={() => void loadOrganizations()}>Try Again</Button>
        {/snippet}
      </ErrorNotice>
    {:else if organizations.value.kind === "loggedOut"}
      <Notice kind="info" title="Not logged in">
        <p>Log in with your MOOC.fi account to see the courses on {TMC}.</p>
        {#snippet actions()}
          <Button secondary onclick={logIn}>Log In</Button>
        {/snippet}
      </Notice>
    {:else if organizations.value.items.length === 0}
      <p class="muted">{TMC} lists no organizations.</p>
    {:else if shownOrganizations.length === 0}
      {@render noMatches()}
    {:else}
      <p class="muted">Courses on {TMC} are listed under their organization.</p>
      <ul class="cards" aria-label="{TMC} organizations">
        {#each shownOrganizations as organization (organization.slug)}
          <CatalogCard name={organization.name} description={organization.description}>
            {#snippet action()}
              <Button
                secondary
                data-organization={organization.slug}
                aria-label="Show the courses of {organization.name}"
                onclick={() => void browse(organization)}
              >
                Show Courses
              </Button>
            {/snippet}
          </CatalogCard>
        {/each}
      </ul>
    {/if}
  </Section>
</div>

<style>
  .add-course {
    max-width: var(--tmc-content-max-width, 720px);
  }
  .intro {
    margin: 0 0 var(--tmc-space-3);
  }
  .search {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-2);
    padding: 3px var(--tmc-space-2);
    border: 1px solid var(--tmc-input-border);
    border-radius: 2px;
    background: var(--tmc-input-background);
    color: var(--tmc-input-foreground);
  }
  .search:focus-within {
    outline: 1px solid var(--tmc-focus-border);
    outline-offset: -1px;
  }
  .search vscode-icon {
    color: var(--tmc-input-placeholder);
  }
  .search input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    padding: 2px 0;
    background: transparent;
    color: inherit;
    font: inherit;
  }
  .search input::placeholder {
    color: var(--tmc-input-placeholder);
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--tmc-space-2);
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .added {
    display: inline-flex;
    align-items: center;
    gap: var(--tmc-space-1);
  }
  .organization-header {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-1);
    margin-bottom: var(--tmc-space-2);
  }
  .organization-header h3 {
    margin: 0;
  }
</style>
