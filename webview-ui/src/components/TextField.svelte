<script lang="ts">
    export let type: "text" = "text";
    export let placeholder: string = "";
    export let value: string = "";
    export let onChange: (value: string) => void = () => {};

    type InputEvent = Event & {
        currentTarget: EventTarget & HTMLInputElement;
    };
    function onChangeWrapper(event: InputEvent) {
        onChange(event.currentTarget.value);
    }
</script>

<vscode-text-field class="input" {type} {placeholder} {value} on:input={onChangeWrapper}>
    <slot />
</vscode-text-field>

<style>
    .input {
        width: 100%;
    }
</style>
