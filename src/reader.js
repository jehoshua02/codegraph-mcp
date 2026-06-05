import { readdir, readFile } from 'fs/promises';
import { join, relative } from 'path';
import { languageForFile } from './parser.js';

const IGNORE_DIRS = new Set(['node_modules', 'vendor', '.git', '.codegraph', 'storage', 'bootstrap/cache']);

export async function discoverFiles(rootDir) {
  const files = [];
  await walk(rootDir, rootDir, files);
  return files;
}

async function walk(dir, rootDir, files) {
  const entries = await readdir(dir, { withFileTypes: true });
  const promises = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);

    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name) && !IGNORE_DIRS.has(relPath)) {
        promises.push(walk(fullPath, rootDir, files));
      }
    } else if (entry.isFile() && languageForFile(entry.name)) {
      files.push(fullPath);
    }
  }

  await Promise.all(promises);
}

export async function readFiles(filePaths, batchSize = 100) {
  const results = [];
  for (let i = 0; i < filePaths.length; i += batchSize) {
    const batch = filePaths.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (fp) => {
        const content = await readFile(fp, 'utf-8');
        return { filePath: fp, content };
      })
    );
    results.push(...batchResults);
  }
  return results;
}
