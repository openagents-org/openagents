import { WEB_PROJECT_TYPE } from './web-projects';
import type { BrowserTab, WorkspaceFile } from './types';
export type ArtifactReference = { kind: 'file' | 'knowledge' | 'browser'; id: string };
export type ThreadArtifactSetting = { artifact: ArtifactReference | null; unavailable: boolean; can_pin: boolean };
export const sameArtifact = (a: ArtifactReference | null, b: ArtifactReference | null) => !!a && !!b && a.kind === b.kind && a.id === b.id;
export const ARTIFACT_OPEN_EVENT = 'workspace:open-artifact';
export const ARTIFACT_PIN_EVENT = 'workspace:artifact-pin-changed';
export function openArtifactPreview(artifact: ArtifactReference) {
  window.dispatchEvent(new CustomEvent(ARTIFACT_OPEN_EVENT, { detail: artifact }));
}
export function isDocumentFile(file: Pick<WorkspaceFile,'filename'|'contentType'>) {
  return file.contentType === WEB_PROJECT_TYPE || file.contentType.startsWith('text/') || /\.(md|mdx|html?|txt|pdf|json|csv)$/i.test(file.filename) || file.contentType === 'application/pdf';
}
/** Resolve workspace resource links; the preview fetch enforces access. */
export function artifactFromLink(href: string, files: WorkspaceFile[], tabs: BrowserTab[], workspace: string): ArtifactReference | null {
  try {
    const url = new URL(href, window.location.href);
    const local = url.origin === window.location.origin;
    if (local) {
      const fileId = url.pathname.match(/^\/v1\/files\/([^/]+)\/?$/);
      if (fileId) return { kind: 'file', id: decodeURIComponent(fileId[1]) };
      const match = url.pathname.match(/^\/([^/]+)\/(files|knowledge)\/([^/]+)\/?$/);
      if (match && decodeURIComponent(match[1]) === workspace) return { kind: match[2] === 'files' ? 'file' : 'knowledge', id: decodeURIComponent(match[3]) };
    }
    const file = files.find(f => href === f.filename || decodeURIComponent(url.pathname) === `/v1/files/${f.id}` || decodeURIComponent(url.pathname).endsWith('/' + f.filename));
    if (file && (local || !/^https?:/i.test(href))) return {kind:'file',id:file.id};
    const tab = tabs.find(t => t.url === url.href);
    return tab ? {kind:'browser',id:tab.id} : null;
  } catch { return null; }
}
