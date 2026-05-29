import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

const BASE_DIR = process.env.LOCAL_FILES_BASE_DIR || '/Users/tonyye/Downloads/PRD合集';

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  size?: number;
  extension?: string;
}

function isPathSafe(requestedPath: string): boolean {
  if (requestedPath.includes('..')) return false;
  const resolved = path.resolve(BASE_DIR, requestedPath);
  return resolved.startsWith(path.resolve(BASE_DIR));
}

async function buildTree(dirPath: string, relativePath: string, depth: number): Promise<FileNode[]> {
  if (depth <= 0) return [];

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const nodes: FileNode[] = [];

  for (const entry of entries) {
    // Skip hidden files
    if (entry.name.startsWith('.')) continue;

    const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    const entryAbsPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      const children = await buildTree(entryAbsPath, entryRelPath, depth - 1);
      nodes.push({
        name: entry.name,
        path: entryRelPath,
        type: 'directory',
        children,
      });
    } else {
      const ext = path.extname(entry.name).toLowerCase().slice(1);
      let size: number | undefined;
      try {
        const stat = await fs.stat(entryAbsPath);
        size = stat.size;
      } catch {
        // ignore stat errors
      }
      nodes.push({
        name: entry.name,
        path: entryRelPath,
        type: 'file',
        size,
        extension: ext || undefined,
      });
    }
  }

  return nodes;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const requestedPath = searchParams.get('path') || '';
  const content = searchParams.get('content') === 'true';
  const depth = Math.min(parseInt(searchParams.get('depth') || '2', 10), 5);

  // Security: reject path traversal
  if (!isPathSafe(requestedPath)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const absolutePath = path.resolve(BASE_DIR, requestedPath);

  // If content=true, return file content
  if (content) {
    try {
      const stat = await fs.stat(absolutePath);
      if (!stat.isFile()) {
        return NextResponse.json({ error: 'Not a file' }, { status: 400 });
      }

      const ext = path.extname(absolutePath).toLowerCase();

      // For binary files (images), return raw
      if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) {
        const buffer = await fs.readFile(absolutePath);
        const contentType =
          ext === '.png' ? 'image/png' :
          ext === '.svg' ? 'image/svg+xml' :
          ext === '.gif' ? 'image/gif' :
          ext === '.webp' ? 'image/webp' :
          'image/jpeg';
        return new NextResponse(buffer, {
          headers: { 'Content-Type': contentType },
        });
      }

      // PDF: return raw binary
      if (ext === '.pdf') {
        const buffer = await fs.readFile(absolutePath);
        return new NextResponse(buffer, {
          headers: { 'Content-Type': 'application/pdf' },
        });
      }

      // Text-based files: return JSON with content
      const text = await fs.readFile(absolutePath, 'utf-8');
      return NextResponse.json({ content: text, path: requestedPath, size: stat.size });
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
  }

  // Otherwise return directory tree
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isDirectory()) {
      // Single file info
      const ext = path.extname(absolutePath).toLowerCase().slice(1);
      return NextResponse.json({
        name: path.basename(absolutePath),
        path: requestedPath,
        type: 'file',
        size: stat.size,
        extension: ext || undefined,
      });
    }

    const children = await buildTree(absolutePath, requestedPath, depth);
    return NextResponse.json({
      name: path.basename(absolutePath) || 'Root',
      path: requestedPath,
      type: 'directory',
      children,
    });
  } catch {
    return NextResponse.json({ error: 'Path not found' }, { status: 404 });
  }
}
