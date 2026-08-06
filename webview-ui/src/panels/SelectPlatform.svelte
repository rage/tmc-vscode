<script lang="ts">
  import Card from "../components/Card.svelte"
  import type { SelectPlatformPanel } from "../shared/shared"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: SelectPlatformPanel
  }

  let { panel }: Props = $props()

  function selectMooc() {
    vscode.postMessage({
      type: "selectMoocCourse",
      sourcePanel: panel.requestingPanel,
    })
  }

  function selectTmc() {
    vscode.postMessage({
      type: "selectOrganization",
      sourcePanel: panel.requestingPanel,
    })
  }
</script>

<h1>Select MOOC platform</h1>

<Card>
  <div class="platform" role="button" tabindex="0" onclick={selectMooc} onkeypress={selectMooc}>
    <h2>Courses MOOC</h2>
    <div class="platform-url">https://courses.mooc.fi</div>
    <div>The new MOOC platform launched in 2023.</div>
  </div>
</Card>

<Card>
  <div class="platform" role="button" tabindex="0" onclick={selectTmc} onkeypress={selectTmc}>
    <h2>TestMyCode</h2>
    <div class="platform-url">https://tmc.mooc.fi</div>
    <div>The old MOOC platform.</div>
  </div>
</Card>

<style>
  .platform {
    border-radius: 0.4rem;
    cursor: pointer;
  }
  .platform h2 {
    margin-top: 0;
  }
  .platform-url {
    opacity: 80%;
    word-break: break-all;
  }
  .platform:hover {
    background-color: var(--vscode-list-hoverBackground, rgba(128, 128, 128, 0.1));
  }
  .platform:focus-visible {
    outline: 1px solid var(--vscode-focusBorder, #007fd4);
    outline-offset: 2px;
  }
</style>
