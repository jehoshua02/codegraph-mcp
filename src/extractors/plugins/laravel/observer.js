import { extractNamespace, qualify, resolveClassName } from '../php/utils.js';

export default {
  name: 'plugin:laravel:observer',
  types: [
    { type: 'OBSERVES', kind: 'edge', description: 'Observer watches a model' },
    { type: 'TRIGGERS_OBSERVER', kind: 'edge', description: 'Model lifecycle event triggers an observer method' },
  ],
  fileFilter: (fp) => fp.endsWith('.php'),
  extract(filePath, content, tree, context) {
    const namespace = extractNamespace(tree.rootNode);
    return { nodes: [], edges: collectObserverRegistrations(tree.rootNode, namespace, filePath, context) };
  },
  postExtract(nodes, edges) {
    deriveObserverTriggers(nodes, edges);
  },
};

function findEnclosingClass(node, namespace) {
  let current = node.parent;
  while (current) {
    if (current.type === 'class_declaration') {
      const name = current.childForFieldName('name')?.text;
      if (name) return qualify(namespace, name);
    }
    current = current.parent;
  }
  return null;
}

function extractObserverClass(argsNode, namespace, context, filePath) {
  for (let i = 0; i < argsNode.childCount; i++) {
    const child = argsNode.child(i);

    // ObserverClass::class
    if (child.type === 'class_constant_access_expression') {
      return resolveClassConstant(child, namespace, context, filePath);
    }

    // new ObserverClass or new ObserverClass()
    if (child.type === 'object_creation_expression') {
      return resolveObjectCreation(child, namespace, context, filePath);
    }

    // Inside argument wrapper
    if (child.type === 'argument') {
      for (let j = 0; j < child.childCount; j++) {
        const inner = child.child(j);
        if (inner.type === 'class_constant_access_expression') {
          return resolveClassConstant(inner, namespace, context, filePath);
        }
        if (inner.type === 'object_creation_expression') {
          return resolveObjectCreation(inner, namespace, context, filePath);
        }
        // App::make(ObserverClass::class)
        if (inner.type === 'scoped_call_expression' || inner.type === 'member_call_expression') {
          const innerArgs = inner.childForFieldName('arguments');
          if (innerArgs) {
            const resolved = extractObserverClass(innerArgs, namespace, context, filePath);
            if (resolved) return resolved;
          }
        }
      }
    }
  }
  return null;
}

function resolveClassConstant(node, namespace, context, filePath) {
  const cls = node.childForFieldName('class') ?? node.children?.find(c => c.type === 'name' || c.type === 'qualified_name');
  return cls ? resolveClassName(cls.text, namespace, context, filePath) : null;
}

function resolveObjectCreation(node, namespace, context, filePath) {
  const cls = node.childForFieldName('class') ?? node.childForFieldName('name') ?? node.children?.find(c => c.type === 'name' || c.type === 'qualified_name');
  return cls ? resolveClassName(cls.text, namespace, context, filePath) : null;
}

function extractObserverEdge(node, namespace, filePath, context) {
  // Model::observe(...) or static::observe(...)
  const isScoped = node.type === 'scoped_call_expression';
  const isMember = node.type === 'member_call_expression';
  if (!isScoped && !isMember) return null;

  const method = node.childForFieldName('name')?.text;
  if (method !== 'observe') return null;

  const args = node.childForFieldName('arguments');
  if (!args) return null;

  const observerClass = extractObserverClass(args, namespace, context, filePath);
  if (!observerClass) return null;

  let modelClass = null;
  if (isScoped) {
    const scope = node.childForFieldName('scope')?.text;
    if (scope === 'static' || scope === 'self') {
      modelClass = findEnclosingClass(node, namespace);
    } else if (scope) {
      modelClass = resolveClassName(scope, namespace, context, filePath);
    }
  }

  if (!modelClass) return null;

  return { source: observerClass, target: modelClass, type: 'OBSERVES', metadata: { observer: observerClass, model: modelClass } };
}

function collectObserverRegistrations(node, namespace, filePath, context) {
  if (node.type === 'namespace_definition') {
    const nameNode = node.childForFieldName('name');
    namespace = nameNode ? nameNode.text : namespace;
  }

  const edges = [];
  const edge = extractObserverEdge(node, namespace, filePath, context);
  if (edge) edges.push(edge);

  for (let i = 0; i < node.childCount; i++) {
    edges.push(...collectObserverRegistrations(node.child(i), namespace, filePath, context));
  }

  return edges;
}

const ELOQUENT_EVENTS = new Set([
  'creating', 'created', 'updating', 'updated', 'saving', 'saved',
  'deleting', 'deleted', 'restoring', 'restored', 'retrieved', 'replicating',
  'forceDeleting', 'forceDeleted',
]);

function deriveObserverTriggers(nodes, edges) {
  const observesEdges = edges.filter(e => e.type === 'OBSERVES');
  if (observesEdges.length === 0) return;

  const methodsByClass = new Map();
  for (const node of nodes) {
    if (node.type === 'Method' && node.qualified_name?.includes('::')) {
      const [classQn] = node.qualified_name.split('::');
      if (!methodsByClass.has(classQn)) methodsByClass.set(classQn, []);
      methodsByClass.get(classQn).push(node);
    }
  }

  for (const edge of observesEdges) {
    const observerClass = edge.source;
    const modelClass = edge.target;
    const methods = methodsByClass.get(observerClass) || [];

    for (const method of methods) {
      if (ELOQUENT_EVENTS.has(method.name)) {
        edges.push({
          source: modelClass,
          target: method.qualified_name,
          type: 'TRIGGERS_OBSERVER',
          metadata: { event: method.name, observer: observerClass, model: modelClass },
        });
      }
    }
  }
}
