<div class="card">
    <slot />
</div>

<style>
    .card {
        background-color: var(--vscode-editorInlayHint-background, rgba(97, 97, 97, 0.1));
        border-radius: 0.4rem;
        margin-top: 0.4rem;
        margin-bottom: 1rem;
        cursor: pointer;
        padding: 0.8rem;
        border: calc(var(--border-width) * 1px) solid var(--button-border);
    }
</style>
