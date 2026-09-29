<script lang="ts">
  interface Props {
    /** Visible name of what is measured, e.g. "Points". */
    label: string
    value: number
    /** May be 0, e.g. an exercise worth no points; the scale then runs to 1 and shows empty. */
    max: number
    /** What `value` and `max` count; read out as "3 / 5 points". */
    unit?: string
  }

  let { label, value, max, unit = "points" }: Props = $props()

  const labelId = $props.id()
  const scaleMax = $derived(Math.max(1, max))
  const scaleValue = $derived(Math.min(scaleMax, Math.max(0, value)))
  const valueText = $derived(`${value} / ${max} ${unit}`)
</script>

<!--
  A score, not activity: work in progress belongs in `vscode-progress-bar`, and work of unknown
  length in `Spinner`.
-->
<div class="meter">
  <div class="meter-label">
    <span id={labelId}>{label}</span>
    <span class="muted" aria-hidden="true">{valueText}</span>
  </div>
  <div
    class="track"
    role="meter"
    aria-labelledby={labelId}
    aria-valuemin={0}
    aria-valuemax={scaleMax}
    aria-valuenow={scaleValue}
    aria-valuetext={valueText}
    style:--meter-fraction={scaleValue / scaleMax}
  >
    <div class="fill"></div>
  </div>
</div>

<style>
  .meter-label {
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: var(--tmc-space-2);
    margin-bottom: var(--tmc-space-1);
  }
  .track {
    height: 6px;
    border: 1px solid var(--tmc-meter-track-border);
    border-radius: var(--tmc-radius);
    background: transparent;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    width: calc(var(--meter-fraction) * 100%);
    background: var(--tmc-meter-fill);
    transition: width 0.3s;
  }
</style>
