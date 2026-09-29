<script lang="ts" module>
  /**
   * `passed`..`info` are outcomes; the rest are an exercise's local state. Outcomes keep their
   * text in the body colour, local states are muted: only the icon carries the status colour.
   */
  export type Status =
    | "passed"
    | "failed"
    | "unset"
    | "warning"
    | "info"
    | "opened"
    | "closed"
    | "missing"
    | "downloading"
    | "downloadFailed"
    | "expired"

  type Appearance = { icon: string; tone: string; isMuted: boolean }

  const appearances: Record<Status, Appearance> = {
    passed: { icon: "pass-filled", tone: "passed", isMuted: false },
    failed: { icon: "error", tone: "failed", isMuted: false },
    unset: { icon: "circle-large-outline", tone: "unset", isMuted: false },
    warning: { icon: "warning", tone: "warning", isMuted: false },
    info: { icon: "info", tone: "info", isMuted: false },
    opened: { icon: "folder-opened", tone: "muted", isMuted: true },
    closed: { icon: "folder", tone: "muted", isMuted: true },
    missing: { icon: "cloud-download", tone: "muted", isMuted: true },
    downloading: { icon: "loading", tone: "muted", isMuted: true },
    downloadFailed: { icon: "error", tone: "error", isMuted: true },
    expired: { icon: "lock", tone: "disabled", isMuted: true },
  }
</script>

<script lang="ts">
  import { reducedMotion } from "../utilities/a11y.svelte"

  interface Props {
    status: Status
    /** Says the status in words, e.g. "Passed" or "Not downloaded"; never rely on the icon alone. */
    label: string
    /** Hides the label visually, e.g. in a table column whose header already names it. */
    isLabelHidden?: boolean
  }

  let { status, label, isLabelHidden = false }: Props = $props()

  const appearance = $derived(appearances[status])
</script>

<span class="status" class:muted={appearance.isMuted}>
  <vscode-icon
    class="icon tone-{appearance.tone}"
    name={appearance.icon}
    spin={status === "downloading" && !reducedMotion.current}
  ></vscode-icon>
  <span class:visually-hidden={isLabelHidden}>{label}</span>
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
  .tone-unset {
    color: var(--tmc-status-unset);
  }
  .tone-warning {
    color: var(--tmc-status-warning);
  }
  .tone-info {
    color: var(--tmc-fg-info);
  }
  .tone-muted {
    color: var(--tmc-fg-muted);
  }
  .tone-error {
    color: var(--tmc-fg-error);
  }
  .tone-disabled {
    color: var(--tmc-fg-disabled);
  }
</style>
