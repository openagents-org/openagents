export const WEB_PROJECT_TYPE = 'application/vnd.openagents.web-project+zip';
export type ProjectPreview = { id: string; revision: string; entrypoint: string; files: string[]; can_update: boolean; preview_path: string; expires_in: number };
export type ProjectUpload = { title: string; entrypoint: string; files: { path: string; content_base64: string }[]; channel_name?: string; visibility: 'private' | 'inherit'; expected_revision?: string };
export function projectFiles(files: File[]) {
  return files.map(file => ({ file, path: (file.webkitRelativePath || file.name).split('/').slice(file.webkitRelativePath ? 1 : 0).join('/') }))
    .filter(({path}) => !path.split('/').some(part => part.startsWith('.') || ['node_modules','__pycache__'].includes(part)));
}
export async function encodeProjectFiles(files: {file: File; path: string}[]) {
  if (files.length > 500 || files.reduce((n, {file}) => n + file.size, 0) > 25 * 1024 * 1024) throw new Error('Projects can contain up to 500 files and 25 MB.');
  return Promise.all(files.map(async ({file,path}) => {
    const bytes = new Uint8Array(await file.arrayBuffer()); let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
    return {path, content_base64:btoa(binary)};
  }));
}
