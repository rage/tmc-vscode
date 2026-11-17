<script lang="ts">
  import { withoutLogIn } from "../../../shared/lib"
  import type { ScreenFailureList } from "../utilities/screenFailures.svelte"
  import ErrorNotice from "./ErrorNotice.svelte"

  interface Props {
    failures: ScreenFailureList
    /** The screen has its own Log In, which the notices then leave out. */
    isLogInShown?: boolean
  }

  /** The failures of what the screen started, each a notice the student can dismiss. */
  let { failures, isLogInShown = false }: Props = $props()
</script>

{#each failures.current as failure (failure.serial)}
  <ErrorNotice
    kind={failure.tone}
    error={isLogInShown ? withoutLogIn(failure.error) : failure.error}
    title={failure.title}
    ondismiss={() => failures.dismiss(failure.serial)}
    dismissLabel={failure.tone === "error" ? "Dismiss this error" : "Dismiss this warning"}
  />
{/each}
