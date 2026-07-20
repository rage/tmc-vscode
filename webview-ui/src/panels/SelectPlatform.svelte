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
  <div role="button" tabindex="0" onclick={selectMooc} onkeypress={selectMooc}>
    <h2>https://courses.mooc.fi</h2>
    <div>The new MOOC platform launched in 2023.</div>
  </div>
</Card>

<Card>
  <div role="button" tabindex="0" onclick={selectTmc} onkeypress={selectTmc}>
    <h2>https://tmc.mooc.fi</h2>
    <div>The old MOOC platform.</div>
  </div>
</Card>
