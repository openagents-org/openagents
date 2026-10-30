/** Stable pastel background for a person's avatar, seeded by id/email/name. */
export function humanColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 55% 82%)`;
}
