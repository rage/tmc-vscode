interface WebviewProps {
    children: unknown;
    cspSource: string;
    cssBlob: string;
    script?: () => void;
}

export function component(webviewProps: WebviewProps): unknown;

export function render(webviewProps: WebviewProps): string;
