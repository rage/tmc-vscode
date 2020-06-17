export function removeFalseIsNotTrue(input: string): string {
    const match = input.match(/^False is not true : ([\s\S]+)/i);
    return match ? match[1] : input;
}

export function prettifyTestHeaders(input: string): string {
    const nameMatch = input.match(/(\w+)\.(\w+)$/);
    const displayName = nameMatch ? `${nameMatch[1]}: ${nameMatch[2]}` : input;
    return displayName;
}
