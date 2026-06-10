import { discoverFiles, readFiles } from './reader.js';
import { parse, languageForFile } from './parser.js';
import { openDb, initSchema, clearProject, insertNodes, insertEdges, registerTypes, buildNodeIdMap } from './db.js';
import { basename } from 'path';

import fileExtractor from './extractors/core/file.js';
import phpExtractors from './extractors/plugins/php/index.js';
import laravelExtractors from './extractors/plugins/laravel/index.js';

const BUILT_IN_EXTRACTORS = [fileExtractor, ...phpExtractors, ...laravelExtractors];

async function parseFiles(files) {
  const parsed = [];
  for (const { filePath, content } of files) {
    const language = languageForFile(filePath);
    if (!language) continue;
    const tree = await parse(content, language);
    parsed.push({ filePath, content, tree, language });
  }
  return parsed;
}

function buildImportMap(parsed, extractors, context) {
  const importExtractors = extractors.filter(ext => ext.name.includes('import'));
  for (const { filePath, content, tree } of parsed) {
    for (const ext of importExtractors) {
      if (!ext.fileFilter(filePath)) continue;
      const result = ext.extract(filePath, content, tree, context);
      if (result.imports) {
        for (const imp of result.imports) {
          context.importMap.set(`${filePath}::${imp.alias}`, imp.qualified_name);
        }
      }
    }
  }
}

function extractGraph(parsed, extractors, context) {
  const nodes = [];
  const edges = [];
  for (const { filePath, content, tree } of parsed) {
    for (const ext of extractors) {
      if (!ext.fileFilter(filePath)) continue;
      const result = ext.extract(filePath, content, tree, context);
      if (result.nodes) nodes.push(...result.nodes);
      if (result.edges) edges.push(...result.edges);
    }
  }
  return { nodes, edges };
}

function persistGraph(db, nodes, edges) {
  const insertAll = db.transaction(() => {
    insertNodes(db, nodes);
    const nodeIdMap = buildNodeIdMap(db);
    for (const row of db.prepare('SELECT id, qualified_name FROM nodes').iterate()) {
      nodeIdMap.set(row.qualified_name, row.id);
    }
    insertEdges(db, edges, nodeIdMap);
  });
  insertAll();
}

function getGraphCounts(db) {
  return {
    nodeCount: db.prepare('SELECT COUNT(*) as count FROM nodes').get().count,
    edgeCount: db.prepare('SELECT COUNT(*) as count FROM edges').get().count,
  };
}

function runPostExtract(extractors, nodes, edges) {
  for (const ext of extractors) {
    if (typeof ext.postExtract === 'function') {
      ext.postExtract(nodes, edges);
    }
  }
}

function resolveInheritedMethods(nodes, edges) {
  const nodesByQn = new Map();
  for (const n of nodes) {
    if (n.qualified_name) nodesByQn.set(n.qualified_name, n);
  }

  const parentMap = new Map();
  for (const e of edges) {
    if (e.type === 'EXTENDS' || e.type === 'USES_TRAIT') {
      if (!parentMap.has(e.source)) parentMap.set(e.source, []);
      parentMap.get(e.source).push(e.target);
    }
  }

  const inferredMethods = nodes.filter(n => n.metadata?.inferred && n.type === 'Method' && n.qualified_name?.includes('::'));

  for (const method of inferredMethods) {
    const [classQn, methodName] = method.qualified_name.split('::');
    const resolved = findMethodInAncestors(classQn, methodName, parentMap, nodesByQn, new Set());
    if (resolved) {
      edges.push({
        source: method.qualified_name,
        target: resolved,
        type: 'CALLS',
        metadata: { inherited: true },
      });
    }
  }
}

function findMethodInAncestors(classQn, methodName, parentMap, nodesByQn, visited) {
  if (visited.has(classQn)) return null;
  visited.add(classQn);

  const parents = parentMap.get(classQn) || [];
  for (const parent of parents) {
    const candidateQn = `${parent}::${methodName}`;
    const candidate = nodesByQn.get(candidateQn);
    if (candidate && !candidate.metadata?.inferred) return candidateQn;
    const deeper = findMethodInAncestors(parent, methodName, parentMap, nodesByQn, visited);
    if (deeper) return deeper;
  }
  return null;
}

function deduplicateNodes(nodes) {
  const seen = new Map();
  return nodes.filter(n => {
    if (!n.qualified_name) return true;
    if (seen.has(n.qualified_name)) return false;
    seen.set(n.qualified_name, true);
    return true;
  });
}

function inferMissingNodes(nodes, edges) {
  const known = new Set(nodes.map(n => n.qualified_name).filter(Boolean));
  const inferred = [];
  const seen = new Set();

  for (const edge of edges) {
    for (const qn of [edge.source, edge.target]) {
      if (!qn || known.has(qn) || seen.has(qn)) continue;
      if (qn.includes('::')) {
        const [classQn, methodName] = qn.split('::');
        const name = methodName.startsWith('$') ? methodName.replace(/^\$/, '') : methodName;
        const type = methodName.startsWith('$') ? 'Property' : 'Method';
        inferred.push({ type, name, qualified_name: qn, file_path: '', start_line: null, end_line: null, metadata: { inferred: true } });
        seen.add(qn);
      }
    }
  }

  return inferred;
}

export async function index(rootDir, dbPath, { project, pluginExtractors = [] } = {}) {
  const start = performance.now();
  const projectName = project || basename(rootDir);
  const extractors = [...BUILT_IN_EXTRACTORS, ...pluginExtractors];

  const db = openDb(dbPath);
  initSchema(db);
  clearProject(db, projectName);

  for (const ext of extractors) {
    registerTypes(db, ext.name, ext.types);
  }

  const filePaths = await discoverFiles(rootDir);
  const files = await readFiles(filePaths);
  const parsed = await parseFiles(files);

  const context = { importMap: new Map(), project: projectName };
  buildImportMap(parsed, extractors, context);

  const { nodes, edges } = extractGraph(parsed, extractors, context);
  nodes.unshift({ type: 'Project', name: projectName, qualified_name: `project::${projectName}`, file_path: rootDir, start_line: null, end_line: null });

  runPostExtract(extractors, nodes, edges);
  const inferred = inferMissingNodes(nodes, edges);
  nodes.push(...inferred);
  resolveInheritedMethods(nodes, edges);

  const dedupedNodes = deduplicateNodes(nodes);
  persistGraph(db, dedupedNodes, edges);
  const counts = getGraphCounts(db);
  db.close();

  const elapsed = ((performance.now() - start) / 1000).toFixed(2);
  return { project: projectName, elapsed, ...counts, fileCount: files.length };
}
