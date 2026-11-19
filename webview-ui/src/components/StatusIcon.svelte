<script lang="ts" module>
  export type Status = "passed" | "failed" | "warning"

  const icons: Record<Status, string> = {
    passed: "pass-filled",
    failed: "error",
    warning: "warning",
  }
</script>

<script lang="ts">
  interface Props {
    status: Status
    /** Says the status to screen readers, e.g. "Passed" or "Error"; the icon alone is not enough. */
    label: string
  }

  let { status, label }: Props = $props()
</script>

<span class="status">
  <vscode-icon class="icon tone-{status}" name={icons[status]}></vscode-icon>
  <span class="visually-hidden">{label}</span>
</span>

<style>
  .status {
    display: inline-flex;
    align-items: center;
    gap: var(--tmc-space-1);
  }
  .tone-passed {
    color: var(--tmc-status-passed);
  }
  .tone-failed {
    color: var(--tmc-status-failed);
  }
  .tone-warning {
    color: var(--tmc-status-warning);
  }
</style>
