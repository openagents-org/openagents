/**
 * The name a new agent of `type` starts from. Usually the type itself; a type
 * whose CLI name is not the product people know gets the product name instead
 * (`codebuddy` runs Tencent's WorkBuddy engine, and users look for WorkBuddy).
 */
const DEFAULT_NAME_BASE: Record<string, string> = {
  codebuddy: 'workbuddy',
};

export function defaultAgentNameBase(type: string): string {
  return DEFAULT_NAME_BASE[type] ?? type;
}

/** `base`, or the first of `base-2`, `base-3`, … that no agent is using yet. */
export function uniqueAgentName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
