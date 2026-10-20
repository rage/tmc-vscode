<script lang="ts">
  interface Props {
    /** The accessible name of what is measured, e.g. "Points"; the visible text is the count. */
    label: string
    value: number
    /** At 0 there is nothing to score, and the meter renders nothing. */
    max: number
  }

  /**
   * A score as a thin bar with "<value> / <max> points" beside it. Not for activity: work in
   * progress belongs in `vscode-progress-bar`, and work of unknown length in `Spinner`.
   */
  let { label, value, max }: Props = $props()

  const scaleValue = $derived(Math.min(max, Math.max(0, value)))
  const valueText = $derived(`${value} / ${max} points`)
</script>

{#if max > 0}
  <div class="meter">
    <div
      class="track"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={scaleValue}
      aria-valuetext={valueText}
      style:--meter-fraction={scaleValue / max}
    >
      <div class="fill"></div>
    </div>
    <span class="value" aria-hidden="true">{valueText}</span>
  </div>
{/if}

<style>
  .meter {
    display: flex;
    align-items: center;
    gap: var(--tmc-space-3);
  }
  .track {
    flex: 1;
    min-width: 48px;
    height: 4px;
    border-radius: 2px;
    background: var(--tmc-meter-track);
    /* High Contrast draws extents with outlines, not fills. */
    outline: 1px solid var(--tmc-hc-outline);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    width: calc(var(--meter-fraction) * 100%);
    background: var(--tmc-meter-fill);
    transition: width 0.3s;
  }
  .value {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
</style>
