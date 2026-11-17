<script lang="ts">
  import type { CourseDetailsPanel } from "../../../shared/lib"
  import ScreenFailures from "../components/ScreenFailures.svelte"
  import { listenForFailures } from "../utilities/screenFailures.svelte"

  let { panel, isLogInShown = false }: { panel: CourseDetailsPanel; isLogInShown?: boolean } =
    $props()

  // svelte-ignore state_referenced_locally -- a probe for one panel
  const failures = listenForFailures(panel)
</script>

<ScreenFailures {failures} {isLogInShown} />
