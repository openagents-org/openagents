'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ARTIFACTS = 5;

// Only explicit document links in the final answer are delivery candidates.
// Never scan a directory, code block, or the agent's intermediate tool output.
function localDocumentLinks(content) {
  const text = String(content || '').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '');
  const links = [];
  const pattern = /(?<!!)\[[^\]\n]+\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\s*\)/g;
  for (const match of text.matchAll(pattern)) {
    const href = match[1] || match[2];
    if (/^(?:https?:|data:|javascript:|\/\/)/i.test(href)) continue;
    try {
      let filename = href.startsWith('file:') ? fileURLToPath(href) : decodeURIComponent(href);
      filename = filename.replace(/#.*$/, '').replace(/:(\d+)(?::\d+)?$/, '');
      if (!/\.(html?|md|markdown)$/i.test(filename)) continue;
      if (/^[a-z][a-z\d+.-]*:/i.test(filename) && !path.isAbsolute(filename)) continue;
      if (!links.some(link => link.path === filename)) links.push({ href, path: filename });
    } catch { /* Malformed URLs are ordinary prose, not file reads. */ }
    if (links.length >= MAX_ARTIFACTS) break;
  }
  return links;
}

/** Deliver explicitly linked local outputs with the same access scope as the reply. */
async function publishResponseArtifacts({ content, workingDir, upload, onError = () => {} }) {
  let root;
  const attachments = [];
  let updated = content;
  if (!workingDir) return { content, attachments };
  try { root = await fs.realpath(workingDir); } catch { return { content, attachments }; }
  const seen = new Set();
  for (const link of localDocumentLinks(content)) {
    try {
      const candidate = path.resolve(root, link.path);
      const real = await fs.realpath(candidate);
      const relative = path.relative(root, real);
      if (!relative || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || relative.split(path.sep).some(part => part.startsWith('.'))) continue;
      if (seen.has(real)) continue;
      seen.add(real);
      const handle = await fs.open(real, 'r');
      let bytes;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_BYTES) continue;
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        let count = 0;
        while (count < buffer.length) {
          const result = await handle.read(buffer, count, buffer.length - count, count);
          if (!result.bytesRead) break;
          count += result.bytesRead;
        }
        if (count > MAX_BYTES) continue;
        bytes = buffer.subarray(0, count);
      } finally { await handle.close(); }
      const contentType = /\.html?$/i.test(real) ? 'text/html' : 'text/markdown';
      const result = await upload(relative.split(path.sep).join('/'), bytes.toString('base64'), contentType);
      const id = result.id || result.file_id;
      if (!id) continue;
      attachments.push({ file_id: id, filename: result.filename || relative, content_type: contentType, size: bytes.length });
      // File IDs make repeated filenames unambiguous and avoid exposing device paths.
      updated = updated.split(link.href).join(`/v1/files/${encodeURIComponent(id)}`);
    } catch (error) { onError(error); }
  }
  return { content: updated, attachments };
}
module.exports = { publishResponseArtifacts, localDocumentLinks, MAX_BYTES };
