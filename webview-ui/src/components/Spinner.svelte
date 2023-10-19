<script lang="ts">
    export let variant: "large" | "medium" | "small";
    export let disableMargin: boolean = false;

    const rotation = `
  0% { transform: rotate(0deg) }
  100% { transform: rotate(360deg) }
`;

    const fadeIn = `
0% {
  opacity: 0;
}
100% {
  opacity: 1;
}
`;

    const variantSizes = {
        small: {
            width: "16px",
            height: "16px",
        },
        medium: {
            width: "30px",
            height: "30px",
        },
        large: {
            width: "42px",
            height: "42px",
        },
    };

    const style = `
        margin: ${disableMargin ? "0" : "1rem"};
        width: ${variantSizes[variant].width};
        height: ${variantSizes[variant].height};
        border: 5px solid #f1f1f1;
        border-bottom-color: green;
        border-radius: 50%;
        display: inline-block;
        /** Showing the spinner is delayed because showing a spinner for a moment on fast transitions makes the application to feel like more slow than it is **/
        opacity: 0;
        animation-name: ${rotation}, ${fadeIn};
        animation-duration: 1s, 600ms;
        animation-timing-function: linear, ease;
        animation-iteration-count: infinite, 1;
        animation-delay: 400ms;
        animation-fill-mode: forwards;
    `;
</script>

<div {style} />
