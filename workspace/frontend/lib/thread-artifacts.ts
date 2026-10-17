import { WEB_PROJECT_TYPE } from './web-projects';
import { shareOrigin } from './share-origin';
import { browserFabricLiveUrl } from './thread-browser';
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
// New uploads have UUIDs. Known legacy records may use other identifiers.
// Reject instructional placeholders without waiting for the file list to refresh.
const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isFileReference = (id: string, files: WorkspaceFile[]) => FILE_ID.test(id) || files.some(file => file.id === id);
/** Resolve workspace resource links; the preview fetch enforces access. */
export function artifactFromLink(href: string, files: WorkspaceFile[], tabs: BrowserTab[], workspace: string): ArtifactReference | null {
  try {
    const url = new URL(href, window.location.href);
    // In the desktop app, links to the web workspace point at this same workspace.
    const local = url.origin === window.location.origin || url.origin === shareOrigin();
    if (local) {
      const browserId = url.pathname.match(/^\/v1\/browser\/tabs\/([^/]+)\/?$/);
      if (browserId) {
        const id = decodeURIComponent(browserId[1]);
        return FILE_ID.test(id) || tabs.some(tab => tab.id === id) ? {kind:'browser',id} : null;
      }
      const fileId = url.pathname.match(/^\/v1\/files\/([^/]+)\/?$/);
      if (fileId) {
        const id = decodeURIComponent(fileId[1]);
        return isFileReference(id, files) ? {kind:'file',id} : null;
      }
      const match = url.pathname.match(/^\/([^/]+)\/(files|knowledge)\/([^/]+)\/?$/);
      if (match && decodeURIComponent(match[1]) === workspace) {
        const id = decodeURIComponent(match[3]);
        return match[2] === 'files' ? (isFileReference(id, files) ? {kind:'file',id} : null) : {kind:'knowledge',id};
      }
    }
    const file = files.find(f => href === f.filename || decodeURIComponent(url.pathname) === `/v1/files/${f.id}` || decodeURIComponent(url.pathname).endsWith('/' + f.filename));
    if (file && (local || !/^https?:/i.test(href))) return {kind:'file',id:file.id};
    const tab = tabs.find(t => t.liveUrl === url.href) || tabs.find(t => t.url === url.href);
    if (tab) return {kind:'browser',id:tab.id};
    const live = browserFabricLiveUrl(href);
    return live ? {kind:'browser',id:live} : null;
  } catch { return null; }
}
