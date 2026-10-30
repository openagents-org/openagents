/** `base`, or the first of `base-2`, `base-3`, … that no agent is using yet. */
export function uniqueAgentName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
