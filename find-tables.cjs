#!/usr/bin/env node
'use strict';

const Database = require('./node_modules/better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '.codegraph/graph.db');
const db = new Database(DB_PATH, { readonly: true });

// BFS config
const EDGE_TYPES = ['CALLS', 'DISPATCHES_JOB', 'TRIGGERS_OBSERVER', 'DISPATCHES_EVENT', 'HANDLES_EVENT'];
const WRITE_METHODS = new Set(['save','create','update','fill','delete','destroy','updateOrCreate','firstOrCreate','insert','upsert','forceCreate','createOrFirst','saveOrFail','updateOrFail','deleteOrFail']);
const DEPTH_LIMIT = 10;

const ENTRY_POINTS = [
  'App\\Jobs\\PackageReadySubmit::_handle',
  'App\\Services\\PackageReady\\AbstractPackageReadyService::handleBasedOnPackageReadyStatus',
  'App\\Services\\PackageReady\\AbstractPackageReadyService::handle',
  'App\\Services\\PackageReady\\PackageReadyService::handleDealCreation',
  'App\\Services\\PackageReady\\PackageReadyService::handlePackageReadyRecord',
  'App\\Jobs\\AutoSubmit::_handle',
  'App\\Jobs\\AutoSubmitNewDeal::_handle',
  'App\\Jobs\\Decisioning\\DecisioningPackageReadyHandler::_handle',
];

// Prepare queries
const stmtOutbound = db.prepare(`
  SELECT e.target_id, n.qualified_name
  FROM edges e
  JOIN nodes n ON n.id = e.target_id
  WHERE e.source_id = ? AND e.type IN (${EDGE_TYPES.map(() => '?').join(',')})
`);

const stmtNodeByName = db.prepare(`SELECT id, qualified_name FROM nodes WHERE qualified_name = ?`);

const stmtMapsToTable = db.prepare(`
  SELECT e.target_id, n.qualified_name as table_name
  FROM edges e
  JOIN nodes n ON n.id = e.target_id
  WHERE e.source_id = ? AND e.type = 'MAPS_TO_TABLE'
`);

// BFS
const visited = new Map(); // qualifiedName -> nodeId
const queue = [];

for (const ep of ENTRY_POINTS) {
  const node = stmtNodeByName.get(ep);
  if (node) {
    if (!visited.has(node.qualified_name)) {
      visited.set(node.qualified_name, node.id);
      queue.push({ id: node.id, name: node.qualified_name, depth: 0 });
    }
  } else {
    console.error(`  [WARN] Entry point not found: ${ep}`);
  }
}

while (queue.length > 0) {
  const { id, name, depth } = queue.shift();
  if (depth >= DEPTH_LIMIT) continue;

  const targets = stmtOutbound.all(id, ...EDGE_TYPES);
  for (const t of targets) {
    if (!visited.has(t.qualified_name)) {
      visited.set(t.qualified_name, t.target_id);
      queue.push({ id: t.target_id, name: t.qualified_name, depth: depth + 1 });
    }
  }
}

console.log(`\nTotal nodes visited: ${visited.size}`);

// Find model classes
const modelClasses = new Set();
const writeCallModels = new Set();

for (const [qname] of visited) {
  // Direct model methods
  if (qname.startsWith('App\\Models\\')) {
    const cls = qname.includes('::') ? qname.split('::')[0] : qname;
    modelClasses.add(cls);
  }

  // Write method calls on any class
  if (qname.includes('::')) {
    const [cls, method] = qname.split('::');
    if (WRITE_METHODS.has(method)) {
      writeCallModels.add(cls);
      if (cls.startsWith('App\\Models\\')) modelClasses.add(cls);
    }
  }
}

console.log(`\nModel classes found: ${modelClasses.size}`);
console.log(`Write-method callers (non-model): ${[...writeCallModels].filter(c => !c.startsWith('App\\Models\\')).join(', ') || 'none'}`);

// Resolve tables
const tableMap = new Map(); // table -> Set<modelClass>

// Look up MAPS_TO_TABLE for each model class node
for (const cls of modelClasses) {
  // Try to find the class node (may be stored as class name or with a method like ::__class)
  let classNode = stmtNodeByName.get(cls);
  if (!classNode) {
    // Try with ::__class or any method to get the id
    const stmtFuzzy = db.prepare(`SELECT id, qualified_name FROM nodes WHERE qualified_name LIKE ? LIMIT 1`);
    classNode = stmtFuzzy.get(cls + '%');
  }

  if (!classNode) {
    console.error(`  [WARN] No node for model class: ${cls}`);
    continue;
  }

  // Use the class-level id (strip method part if needed)
  // Try direct MAPS_TO_TABLE from this node
  let tables = stmtMapsToTable.all(classNode.id);

  // If classNode was a method, try the class root
  if (tables.length === 0 && classNode.qualified_name.includes('::')) {
    const rootName = classNode.qualified_name.split('::')[0];
    const rootNode = stmtNodeByName.get(rootName);
    if (rootNode) tables = stmtMapsToTable.all(rootNode.id);
  }

  if (tables.length > 0) {
    for (const t of tables) {
      if (!tableMap.has(t.table_name)) tableMap.set(t.table_name, new Set());
      tableMap.get(t.table_name).add(cls);
    }
  } else {
    // No explicit MAPS_TO_TABLE — note it
    if (!tableMap.has('(unmapped)')) tableMap.set('(unmapped)', new Set());
    tableMap.get('(unmapped)').add(cls);
  }
}

// Also check write-method callers that are models but may have been missed
// Already handled above; additionally scan all visited for write calls on models
for (const [qname] of visited) {
  if (!qname.includes('::')) continue;
  const parts = qname.split('::');
  const method = parts[parts.length - 1];
  if (WRITE_METHODS.has(method)) {
    const cls = parts.slice(0, -1).join('::');
    if (cls.startsWith('App\\Models\\') && !modelClasses.has(cls)) {
      modelClasses.add(cls);
      // look up tables
      const classNode = stmtNodeByName.get(cls);
      if (classNode) {
        const tables = stmtMapsToTable.all(classNode.id);
        for (const t of tables) {
          if (!tableMap.has(t.table_name)) tableMap.set(t.table_name, new Set());
          tableMap.get(t.table_name).add(cls);
        }
      }
    }
  }
}

// Print results
console.log('\n========== DATABASE TABLES WRITTEN TO ==========\n');
const sorted = [...tableMap.entries()].filter(([t]) => t !== '(unmapped)').sort(([a], [b]) => a.localeCompare(b));
for (const [table, models] of sorted) {
  console.log(`  ${table}`);
  for (const m of [...models].sort()) {
    console.log(`    <- ${m}`);
  }
}

const unmapped = tableMap.get('(unmapped)');
if (unmapped && unmapped.size > 0) {
  console.log('\n--- Model classes with no MAPS_TO_TABLE edge ---');
  for (const m of [...unmapped].sort()) console.log(`  ${m}`);
}

console.log('\n=================================================\n');

// Also dump all visited App\Models entries for completeness
console.log('--- All App\\Models\\* methods in trace ---');
for (const [qname] of [...visited].filter(([q]) => q.startsWith('App\\Models\\')).sort()) {
  console.log(`  ${qname}`);
}

db.close();
