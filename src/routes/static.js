import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { MIME_TYPES, PATHS } from '../config.js';
import { sendNotFound } from '../utils/http.js';

export async function servePublic({ res, pathname }) {
  const safePath = pathname.replace(/^\/public\//, '');
  const filePath = join(PATHS.PUBLIC_ROOT, safePath);
  if (!filePath.startsWith(PATHS.PUBLIC_ROOT)) {
    return sendNotFound(res);
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      return sendNotFound(res);
    }
    const content = await readFile(filePath);
    const type = MIME_TYPES[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') return sendNotFound(res);
    throw error;
  }
}
