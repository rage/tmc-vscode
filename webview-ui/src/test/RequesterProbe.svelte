<script lang="ts">
  import type { Request } from "../utilities/script"
  import { createRequester } from "../utilities/script"

  interface Props {
    onready: (request: Request) => void
  }

  let { onready }: Props = $props()

  // svelte-ignore state_referenced_locally -- handed over once, like a panel's requester
  onready(createRequester())
</script>
