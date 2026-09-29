/**
 * A plain copy of `value` with every `$state` proxy unwrapped, safe to structured-clone.
 * Plain data comes back as an equal copy.
 */
export function snapshot<T>(value: T): T {
  return $state.snapshot(value) as T
}
