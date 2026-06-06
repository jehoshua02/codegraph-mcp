import { extractNamespace, qualify, resolveClassName } from '../php/utils.js';

const RELATIONSHIP_METHODS = new Set([
  'hasMany', 'hasOne', 'belongsTo', 'belongsToMany',
  'morphMany', 'morphOne', 'morphTo', 'morphToMany', 'morphedByMany',
  'hasManyThrough', 'hasOneThrough',
]);

export default {
  name: 'plugin:laravel:eloquent-relationship',
  types: [
    { type: 'HAS_RELATIONSHIP', kind: 'edge', description: 'Eloquent model relationship to another model' },
  ],
  fileFilter: (fp) => fp.endsWith('.php'),
  extract(filePath, content, tree, context) {
    const namespace = extractNamespace(tree.rootNode);
    return { nodes: [], edges: collectRelationships(tree.rootNode, namespace, filePath, context) };
  },
};

function extractRelationship(node, classQn, namespace, filePath, context) {
  if (node.type !== 'member_call_expression') return null;

  const object = node.childForFieldName('object');
  const method = node.childForFieldName('name')?.text;
  if (object?.text !== '$this' || !method || !RELATIONSHIP_METHODS.has(method)) return null;

  const args = node.childForFieldName('arguments');
  if (!args) return null;

  if (method === 'morphTo') {
    return { source: classQn, target: classQn, type: 'HAS_RELATIONSHIP', metadata: { relationship: 'morphTo', method: findEnclosingMethodName(node) } };
  }

  const firstArg = findFirstClassReference(args);
  if (!firstArg) return null;

  const relatedClass = resolveClassName(firstArg, namespace, context, filePath);
  return { source: classQn, target: relatedClass, type: 'HAS_RELATIONSHIP', metadata: { relationship: method, method: findEnclosingMethodName(node) } };
}

function findFirstClassReference(argsNode) {
  for (let i = 0; i < argsNode.childCount; i++) {
    const child = argsNode.child(i);
    if (child.type === 'class_constant_access_expression') {
      const cls = child.childForFieldName('class') ?? child.children.find(c => c.type === 'name' || c.type === 'qualified_name');
      return cls?.text;
    }
    if (child.type === 'argument') {
      for (let j = 0; j < child.childCount; j++) {
        const inner = child.child(j);
        if (inner.type === 'class_constant_access_expression') {
          const cls = inner.childForFieldName('class') ?? inner.children.find(c => c.type === 'name' || c.type === 'qualified_name');
          return cls?.text;
        }
      }
    }
  }
  return null;
}

function findEnclosingMethodName(node) {
  let current = node.parent;
  while (current) {
    if (current.type === 'method_declaration') {
      return current.childForFieldName('name')?.text;
    }
    current = current.parent;
  }
  return null;
}

function collectRelationships(node, namespace, filePath, context) {
  if (node.type === 'namespace_definition') {
    const nameNode = node.childForFieldName('name');
    namespace = nameNode ? nameNode.text : namespace;
  }

  const edges = [];

  if (node.type === 'class_declaration') {
    const className = node.childForFieldName('name')?.text;
    if (className) {
      const classQn = qualify(namespace, className);
      collectInClass(node, classQn, namespace, filePath, context, edges);
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    edges.push(...collectRelationships(node.child(i), namespace, filePath, context));
  }

  return edges;
}

function collectInClass(node, classQn, namespace, filePath, context, edges) {
  if (node.type === 'member_call_expression') {
    const edge = extractRelationship(node, classQn, namespace, filePath, context);
    if (edge) edges.push(edge);
  }
  for (let i = 0; i < node.childCount; i++) {
    collectInClass(node.child(i), classQn, namespace, filePath, context, edges);
  }
}
