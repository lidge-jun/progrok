/** Commander repeatable-option collector for --ref flags. */
export function collectRefs(value: string, prev: string[]): string[] {
  return [...prev, value];
}
