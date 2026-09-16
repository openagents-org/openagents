/** Join a folder name onto a path reported by a remote node. */
export function joinNodePath(base: string, name: string): string {
  const separator = /^[A-Za-z]:/.test(base) || base.includes('\\') ? '\\' : '/';
  return base.endsWith('/') || base.endsWith('\\')
    ? `${base}${name}`
    : `${base}${separator}${name}`;
}
