/**
 * Convert relative URL to absolute URL
 * @param path - Relative path (e.g., '/media/avatars/300-2.png')
 * @returns Absolute URL
 */
export function toAbsoluteUrl(path: string): string {
  // If path is already absolute, return as is
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  
  // For development, use public folder
  // In production, this should be configured based on your deployment
  return `/${cleanPath}`;
}

