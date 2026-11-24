/** `count` followed by `noun`, pluralised with an "s" unless `count` is 1. */
export function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}
