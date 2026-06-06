import { extractNamespace, qualify, resolveClassName } from '../php/utils.js';

export default {
  name: 'plugin:laravel:job-dispatch',
  types: [
    { type: 'DISPATCHES_JOB', kind: 'edge', description: 'Dispatches a queued job' },
  ],
  fileFilter: (fp) => fp.endsWith('.php'),
  extract(filePath, content, tree, context) {
    const namespace = extractNamespace(tree.rootNode);
    return { nodes: [], edges: collectJobDispatches(tree.rootNode, namespace, filePath, context) };
  },
};

function findEnclosingSymbol(node, namespace) {
  let current = node.parent;
  while (current) {
    if (current.type === 'method_declaration') {
      const methodName = current.childForFieldName('name')?.text;
      let classNode = current.parent;
      while (classNode && classNode.type === 'declaration_list') classNode = classNode.parent;
      if (classNode && (classNode.type === 'class_declaration' || classNode.type === 'trait_declaration')) {
        const className = classNode.childForFieldName('name')?.text;
        if (className && methodName) return `${qualify(namespace, className)}::${methodName}`;
      }
    }
    if (current.type === 'function_definition') {
      const name = current.childForFieldName('name')?.text;
      if (name) return qualify(namespace, name);
    }
    current = current.parent;
  }
  return null;
}

function resolveJobHandle(jobClass) {
  return [`${jobClass}::handle`, `${jobClass}::_handle`];
}

function findObjectCreation(argsNode) {
  for (let i = 0; i < argsNode.childCount; i++) {
    const child = argsNode.child(i);
    if (child.type === 'object_creation_expression') return child;
    if (child.type === 'argument') {
      for (let j = 0; j < child.childCount; j++) {
        if (child.child(j).type === 'object_creation_expression') return child.child(j);
      }
    }
  }
  return null;
}

function classNameFromObjectCreation(node) {
  return node.childForFieldName('class') ?? node.childForFieldName('name') ?? node.children.find(c => c.type === 'name' || c.type === 'qualified_name');
}

function extractJobDispatch(node, namespace, filePath, context) {
  // FooJob::dispatch(...)
  if (node.type === 'scoped_call_expression') {
    const scope = node.childForFieldName('scope')?.text;
    const method = node.childForFieldName('name')?.text;
    if (scope && method === 'dispatch' && scope !== 'Bus' && scope !== 'Queue') {
      const caller = findEnclosingSymbol(node, namespace);
      if (!caller) return [];
      const jobClass = resolveClassName(scope, namespace, context, filePath);
      return resolveJobHandle(jobClass).map(target => ({
        source: caller, target, type: 'DISPATCHES_JOB', metadata: { pattern: 'static', job: jobClass },
      }));
    }
  }

  // dispatch(new FooJob(...)) or Bus::dispatch(new FooJob(...))
  const isHelperDispatch = node.type === 'function_call_expression' && node.childForFieldName('function')?.text === 'dispatch';
  const isBusDispatch = node.type === 'scoped_call_expression' && node.childForFieldName('name')?.text === 'dispatch' && ['Bus', 'Queue'].includes(node.childForFieldName('scope')?.text);

  if (isHelperDispatch || isBusDispatch) {
    const args = node.childForFieldName('arguments');
    if (!args) return [];
    const creation = findObjectCreation(args);
    if (!creation) return [];
    const classNode = classNameFromObjectCreation(creation);
    if (!classNode) return [];
    const caller = findEnclosingSymbol(node, namespace);
    if (!caller) return [];
    const jobClass = resolveClassName(classNode.text, namespace, context, filePath);
    const pattern = isHelperDispatch ? 'helper' : 'bus';
    return resolveJobHandle(jobClass).map(target => ({
      source: caller, target, type: 'DISPATCHES_JOB', metadata: { pattern, job: jobClass },
    }));
  }

  return [];
}

function collectJobDispatches(node, namespace, filePath, context) {
  if (node.type === 'namespace_definition') {
    const nameNode = node.childForFieldName('name');
    namespace = nameNode ? nameNode.text : namespace;
  }

  const edges = extractJobDispatch(node, namespace, filePath, context);

  for (let i = 0; i < node.childCount; i++) {
    edges.push(...collectJobDispatches(node.child(i), namespace, filePath, context));
  }

  return edges;
}
