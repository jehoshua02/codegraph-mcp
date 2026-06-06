import { discoverFiles, readFiles } from './reader.js';
import { parse, languageForFile } from './parser.js';
import { openDb, initSchema, clearGraph, insertNodes, insertEdges, registerTypes, buildNodeIdMap } from './db.js';

import fileExtractor from './extractors/core/file.js';
import phpExtractors from './extractors/plugins/php/index.js';

const BUILT_IN_EXTRACTORS = [fileExtractor, ...phpExtractors];

export async function index(rootDir, dbPath, pluginExtractors = []) {
  const start = performance.now();
  const extractors = [...BUILT_IN_EXTRACTORS, ...pluginExtractors];

  const db = openDb(dbPath);
  initSchema(db);
  clearGraph(db);

  for (const ext of extractors) {
    registerTypes(db, ext.name, ext.types);
  }

  const filePaths = await discoverFiles(rootDir);
  const files = await readFiles(filePaths);

  const allNodes = [];
  const allEdges = [];
  const context = { importMap: new Map() };

  // Parse all files and collect trees
  const parsed = [];
  for (const { filePath, content } of files) {
    const language = languageForFile(filePath);
    if (!language) continue;
    const tree = await parse(content, language);
    parsed.push({ filePath, content, tree, language });
  }

  // Pass 1: extract imports to build resolution map
  for (const { filePath, content, tree } of parsed) {
    for (const ext of extractors) {
      if (!ext.fileFilter(filePath)) continue;
      const result = ext.extract(filePath, content, tree, context);
      if (result.imports) {
        for (const imp of result.imports) {
          context.importMap.set(`${filePath}::${imp.alias}`, imp.qualified_name);
        }
      }
    }
  }

  // Pass 2: run all extractors (single pass per file, tree already parsed)
  for (const { filePath, content, tree } of parsed) {
    for (const ext of extractors) {
      if (!ext.fileFilter(filePath)) continue;
      const result = ext.extract(filePath, content, tree, context);
      if (result.nodes) allNodes.push(...result.nodes);
      if (result.edges) allEdges.push(...result.edges);
    }
  }

  // Write to DB in a single transaction
  const insertAll = db.transaction(() => {
    insertNodes(db, allNodes);
    const nodeIdMap = buildNodeIdMap(db);
    for (const row of db.prepare('SELECT id, qualified_name FROM nodes').iterate()) {
      nodeIdMap.set(row.qualified_name, row.id);
    }
    insertEdges(db, allEdges, nodeIdMap);
  });
  insertAll();

  const elapsed = ((performance.now() - start) / 1000).toFixed(2);
  const nodeCount = db.prepare('SELECT COUNT(*) as count FROM nodes').get().count;
  const edgeCount = db.prepare('SELECT COUNT(*) as count FROM edges').get().count;
  db.close();

  return { elapsed, nodeCount, edgeCount, fileCount: files.length };
}
