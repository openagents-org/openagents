export function personalFolder(email: string): string {
  const key = encodeURIComponent(email.trim().toLowerCase()).replace(/%40/g, '@').replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `people/${key}`;
}
