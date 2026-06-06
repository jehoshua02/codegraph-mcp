#!/usr/bin/env node

import { index } from './indexer.js';
import { resolve } from 'path';

const command = process.argv[2];
const targetDir = resolve(process.argv[3] || '.');
const dbPath = resolve(process.argv[4] || '.codegraph/graph.db');
const project = process.argv[5] || undefined;

if (command === 'index') {
  const result = await index(targetDir, dbPath, { project });
  console.log(`Indexed ${result.project}: ${result.fileCount} files → ${result.nodeCount} nodes, ${result.edgeCount} edges in ${result.elapsed}s`);
} else {
  console.log('Usage: codegraph-mcp index [directory] [db-path] [project-name]');
}
