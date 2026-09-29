/** Wraps `value` in a deep `$state` proxy, as a component's state would be. */
export function deepState<T>(value: T): T {
  const state = $state(value)
  return state
}
