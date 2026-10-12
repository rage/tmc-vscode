/**
 * Pairs each of `items` with a key unique among them, for a list whose names may repeat: a
 * repeated name gets the first free `#2`, `#3`… suffix, so even a name already ending in one
 * cannot collide.
 */
export function withDistinctKeys<T>(
  items: readonly T[],
  nameOf: (item: T) => string,
): { key: string; item: T }[] {
  const taken = new Set<string>()
  return items.map((item) => {
    const name = nameOf(item)
    let key = name
    for (let copy = 2; taken.has(key); copy++) {
      key = `${name}#${copy}`
    }
    taken.add(key)
    return { key, item }
  })
}
