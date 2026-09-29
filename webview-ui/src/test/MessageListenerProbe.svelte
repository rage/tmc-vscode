<script lang="ts">
  import type { ExtensionToWebview, Panel } from "../shared/shared"
  import { addMessageListener } from "../utilities/script"

  interface Props {
    panel: Panel
    onmessage: (message: ExtensionToWebview) => void
  }

  let { panel, onmessage }: Props = $props()

  // svelte-ignore state_referenced_locally -- registered once, like a panel's listener
  addMessageListener(panel, onmessage)
</script>
