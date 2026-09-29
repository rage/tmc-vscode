<script lang="ts">
  import { onMount, untrack } from "svelte"

  import Button from "../components/Button.svelte"
  import Card from "../components/Card.svelte"
  import CodeBlock from "../components/CodeBlock.svelte"
  import LinkButton from "../components/LinkButton.svelte"
  import Meter from "../components/Meter.svelte"
  import Notice from "../components/Notice.svelte"
  import PanelHeader from "../components/PanelHeader.svelte"
  import Spinner from "../components/Spinner.svelte"
  import ToolbarButton from "../components/ToolbarButton.svelte"
  import type {
    LocalCourseData as LocalCourseDataType,
    MyCoursesPanel,
    WebviewError,
  } from "../shared/shared"
  import {
    CourseIdentifier,
    ExerciseIdentifier,
    LocalCourseData,
    assertUnreachable,
    makeMoocKind,
    makeTmcKind,
    match,
    unwrap,
  } from "../shared/shared"
  import { addMessageListener, createPanelDataRequester } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: MyCoursesPanel
  }

  let { panel }: Props = $props()

  const panelData = createPanelDataRequester()

  // Set when the request for this panel's data is answered with a failure, or goes
  // unanswered; rendered where the course list would be, so neither is a permanent spinner.
  let dataError = $state<WebviewError | undefined>(undefined)

  // Where focus goes once a card's notice is dismissed, keyed like the cards.
  const openWorkspaceButtons = new Map<string, HTMLElement>()

  async function requestData() {
    dataError = undefined
    dataError = await panelData.request((requestId) =>
      vscode.postMessage({
        type: "requestMyCoursesData",
        requestId,
        sourcePanel: panel,
      }),
    )
  }

  onMount(() => {
    void requestData()
  })
  // Its id and type are all the listener filters on, and they never change: a new panel remounts.
  const listeningPanel = untrack(() => panel)
  addMessageListener(listeningPanel, (message) => {
    switch (message.type) {
      case "setMyCourses": {
        panel = { ...panel, courses: message.courses }
        break
      }
      case "setTmcDataPath": {
        panel = { ...panel, tmcDataPath: message.tmcDataPath }
        break
      }
      case "setTmcDataSize": {
        panel = { ...panel, tmcDataSize: message.tmcDataSize }
        break
      }
      case "setNewExercises": {
        replaceCourse(message.courseId, (course) =>
          match(
            course,
            (tmc) =>
              makeTmcKind({
                ...tmc,
                newExercises: message.exerciseIds.flatMap((id) =>
                  id.kind === "tmc" ? [id.data.tmcExerciseId] : [],
                ),
              }),
            (mooc) =>
              makeMoocKind({
                ...mooc,
                newExercises: message.exerciseIds.flatMap((id) =>
                  id.kind === "mooc" ? [id.data.moocExerciseId] : [],
                ),
              }),
          ),
        )
        break
      }
      case "panelDataResult": {
        panelData.answer(message)
        break
      }
      case "setCourseDisabledStatus": {
        replaceCourse(message.courseId, (course) =>
          match(
            course,
            (tmc) => makeTmcKind({ ...tmc, disabled: message.disabled }),
            (mooc) => makeMoocKind({ ...mooc, disabled: message.disabled }),
          ),
        )
        break
      }
      default:
        assertUnreachable(message)
    }
  })

  function courseKey(course: LocalCourseDataType): string {
    return CourseIdentifier.toString(LocalCourseData.getCourseId(course))
  }
  function replaceCourse(
    courseId: CourseIdentifier,
    replacement: (course: LocalCourseDataType) => LocalCourseDataType,
  ) {
    const key = CourseIdentifier.toString(courseId)
    panel = {
      ...panel,
      courses: (panel.courses ?? []).map((course) =>
        courseKey(course) === key ? replacement(course) : course,
      ),
    }
  }
  function addNewCourse() {
    vscode.postMessage({
      type: "addNewCourse",
    })
  }
  function changeTmcDataPath() {
    vscode.postMessage({
      type: "changeTmcDataPath",
    })
  }
  function openCourseDetails(courseId: CourseIdentifier) {
    vscode.postMessage({
      type: "openCourseDetails",
      courseId,
    })
  }
  function removeCourse(id: CourseIdentifier) {
    vscode.postMessage({
      type: "removeCourse",
      id,
    })
  }
  function openWorkspace(courseId: CourseIdentifier) {
    vscode.postMessage({
      type: "openCourseWorkspace",
      courseId,
    })
  }
  function downloadExercises(ids: Array<ExerciseIdentifier>, courseId: CourseIdentifier) {
    vscode.postMessage({
      type: "downloadExercises",
      ids,
      courseId,
      mode: "download",
    })
  }
  function clearNewExercises(course: LocalCourseDataType) {
    openWorkspaceButtons.get(courseKey(course))?.focus()
    vscode.postMessage({
      type: "clearNewExercises",
      courseId: LocalCourseData.getCourseId(course),
    })
  }
  function registerOpenWorkspaceButton(key: string) {
    return (button: HTMLElement) => {
      openWorkspaceButtons.set(key, button)
      return () => {
        openWorkspaceButtons.delete(key)
      }
    }
  }
</script>

<PanelHeader title="My Courses">
  {#snippet actions()}
    <Button onclick={addNewCourse}>Add new course</Button>
  {/snippet}
</PanelHeader>

{#if panel.courses !== undefined}
  {#if panel.courses.length > 0}
    <ul class="course-list" role="list">
      {#each panel.courses as course (courseKey(course))}
        {@const courseData = unwrap(course)}
        {@const courseId = LocalCourseData.getCourseId(course)}
        {@const newExerciseCount = courseData.newExercises.length}
        <li>
          <Card>
            <div class="course-header">
              <h2 class="course-title">
                <LinkButton onclick={() => openCourseDetails(courseId)}>
                  {courseData.title}
                </LinkButton>
                <small class="muted">({courseData.name})</small>
              </h2>
              <ToolbarButton
                icon="close"
                label={`Remove ${courseData.title}`}
                onclick={() => removeCourse(courseId)}
              />
            </div>
            {#if courseData.description}
              <p class="course-description">{courseData.description}</p>
            {/if}
            <Meter
              label="Programming exercise points"
              value={courseData.awardedPoints}
              max={courseData.availablePoints}
            />
            <div class="actions card-actions">
              <Button
                secondary
                aria-label={`Open workspace for ${courseData.title}`}
                onclick={() => openWorkspace(courseId)}
                {@attach registerOpenWorkspaceButton(courseKey(course))}
              >
                Open workspace
              </Button>
            </div>

            <!-- Rendered on every open, so a live region here would re-announce it each time. -->
            {#if courseData.disabled}
              <Notice kind="warning" role="none">
                <p>This course has been disabled. Exercises cannot be downloaded or submitted.</p>
              </Notice>
            {:else if newExerciseCount > 0}
              <Notice
                kind="info"
                role="none"
                ondismiss={() => clearNewExercises(course)}
                dismissLabel={`Dismiss new exercises for ${courseData.title}`}
              >
                <p>
                  {newExerciseCount === 1
                    ? "1 new exercise found for this course."
                    : `${newExerciseCount} new exercises found for this course.`}
                </p>
                {#snippet actions()}
                  <Button
                    secondary
                    aria-label={`Download new exercises for ${courseData.title}`}
                    onclick={() =>
                      downloadExercises(LocalCourseData.getNewExercises(course), courseId)}
                  >
                    Download
                  </Button>
                {/snippet}
              </Notice>
            {/if}
          </Card>
        </li>
      {/each}
    </ul>
  {:else}
    <p>Add a course to start completing exercises.</p>
  {/if}
{:else if dataError}
  <Notice kind="error" title="Could not load your courses">
    <p>{dataError.message}</p>
    {#if dataError.details}
      <CodeBlock code={dataError.details} label="Error details" />
    {/if}
    {#snippet actions()}
      <Button onclick={() => void requestData()}>Retry</Button>
    {/snippet}
  </Notice>
{:else}
  <Spinner label="Loading courses" />
{/if}

<p class="storage muted">
  Your exercises ({panel.tmcDataSize ?? "size unknown"}) are stored in
  <span class="data-path">{panel.tmcDataPath ?? "…"}</span>.
  <LinkButton onclick={changeTmcDataPath}>Change path</LinkButton>
</p>

<style>
  .course-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .course-header {
    display: flex;
    align-items: flex-start;
    gap: var(--tmc-space-2);
  }
  .course-title {
    flex: 1;
    min-width: 0;
    margin-top: 0;
  }
  .course-description {
    margin-top: 0;
  }
  .card-actions {
    margin-top: var(--tmc-space-2);
  }
  .storage {
    margin-top: var(--tmc-space-6);
  }
  .data-path {
    font-family: var(--tmc-font-mono);
    overflow-wrap: anywhere;
  }
</style>
