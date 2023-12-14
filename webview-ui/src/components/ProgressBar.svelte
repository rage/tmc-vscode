<script lang="ts">
    export let label: string;
    export let value: number;
    export let max: number;

    $: progress = max === 0 ? 0.0 : value / max;
</script>

<div class="progress-bar-label">{label}</div>
<div style="--bar-width: {progress}" class="background">
    <div class="bar"></div>
</div>

<style>
    .background {
        height: 1rem;
        width: 100%;
        border: calc(var(--border-width) * 2px) solid var(--button-border);
        border-radius: 0.4rem;
        background-color: var(--vscode-badge-background, #616161);
    }
    .bar {
        height: 100%;
        width: calc(var(--bar-width) * 100%);
        background-color: var(--vscode-progressBar-background, #0078d4);
        border-radius: 0.4rem;
        transition: width 0.3s;
    }
    .progress-bar-label {
        margin-bottom: 0.2rem;
    }
</style>
