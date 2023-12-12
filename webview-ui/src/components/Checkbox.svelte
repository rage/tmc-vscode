<script lang="ts">
    export let checked: boolean = false;
    export let onClick: (checked: boolean) => void = () => {};

    export let hidden: boolean = false;

    function onClickWrapper() {
        checked = !checked;
        onClick(checked);
    }
</script>

<!--
    the span blocks the checkbox from receiving events
    this is necessary to block the user from actually manipulating
    the checkbox in order to make the component controlled,
    as there's no way to properly bind the `checked`
    property to the store
    instead we use the span's event handlers to check/uncheck
-->
<span
    {hidden}
    on:click|capture|stopPropagation={onClickWrapper}
    on:keypress|capture|stopPropagation={onClickWrapper}
>
    <vscode-checkbox class="test" {checked}>
        <slot />
    </vscode-checkbox>
</span>
