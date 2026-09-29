<script lang="ts">
  import type { HTMLButtonAttributes } from "svelte/elements"

  /**
   * A native button that looks like a link, for actions inside running text or a breadcrumb
   * ("Change path", "My Courses"). Use `<a href>` for real URLs and `Button` for primary actions.
   */
  let { type = "button", class: className, children, ...rest }: HTMLButtonAttributes = $props()
</script>

<button {...rest} {type} class={["link-button", className]}>{@render children?.()}</button>

<style>
  .link-button {
    display: inline;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: var(--tmc-fg-link);
    text-align: start;
    cursor: pointer;
  }
  .link-button:hover {
    color: var(--tmc-fg-link-active);
    text-decoration: underline;
    outline: 1px dashed var(--tmc-hc-active-outline);
  }
  .link-button:disabled {
    color: var(--tmc-fg-disabled);
    cursor: default;
    text-decoration: none;
  }
</style>
