<script lang="ts">
  import type { ScreenFailureList } from "../utilities/screenFailures.svelte"
  import ErrorNotice from "./ErrorNotice.svelte"

  interface Props {
    failures: ScreenFailureList
  }

  /** The failures of what the screen started, each a notice the student can dismiss. */
  let { failures }: Props = $props()
</script>

{#each failures.current as failure (failure.serial)}
  <ErrorNotice
    kind={failure.tone}
    error={failure.error}
    title={failure.title}
    ondismiss={() => failures.dismiss(failure.serial)}
    dismissLabel={failure.tone === "error" ? "Dismiss this error" : "Dismiss this warning"}
  />
{/each}
