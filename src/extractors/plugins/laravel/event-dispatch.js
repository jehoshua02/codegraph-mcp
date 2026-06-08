import { extractNamespace, qualify, resolveClassName } from '../php/utils.js';

export default {
  name: 'plugin:laravel:event-dispatch',
  types: [
    { type: 'DISPATCHES_EVENT', kind: 'edge', description: 'Dispatches an event' },
  ],
  fileFilter: (fp) => fp.endsWith('.php'),
  extract(filePath, content, tree, context) {
    const namespace = extractNamespace(tree.rootNode);
    return { nodes: [], edges: collectEventDispatches(tree.rootNode, namespace, filePath, context) };
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

function extractEventDispatch(node, namespace, filePath, context) {
  // event(new FooEvent(...))
  if (node.type === 'function_call_expression') {
    const funcNode = node.childForFieldName('function');
    if (funcNode?.text === 'event') {
      const args = node.childForFieldName('arguments');
      if (!args) return null;
      const creation = findObjectCreation(args);
      if (!creation) return null;
      const classNode = classNameFromObjectCreation(creation);
      if (!classNode) return null;
      const caller = findEnclosingSymbol(node, namespace);
      if (!caller) return null;
      const eventClass = resolveClassName(classNode.text, namespace, context, filePath);
      return { source: caller, target: eventClass, type: 'DISPATCHES_EVENT', metadata: { pattern: 'helper', event: eventClass } };
    }
  }

  // Event::dispatch(new FooEvent(...)) or Event::fire(new FooEvent(...))
  if (node.type === 'scoped_call_expression') {
    const scope = node.childForFieldName('scope')?.text;
    const method = node.childForFieldName('name')?.text;
    if ((scope === 'Event' || scope === 'event') && (method === 'dispatch' || method === 'fire')) {
      const args = node.childForFieldName('arguments');
      if (!args) return null;
      const creation = findObjectCreation(args);
      if (!creation) return null;
      const classNode = classNameFromObjectCreation(creation);
      if (!classNode) return null;
      const caller = findEnclosingSymbol(node, namespace);
      if (!caller) return null;
      const eventClass = resolveClassName(classNode.text, namespace, context, filePath);
      return { source: caller, target: eventClass, type: 'DISPATCHES_EVENT', metadata: { pattern: 'facade', event: eventClass } };
    }

    // FooEvent::dispatch(...)
    if (method === 'dispatch' && scope !== 'Bus' && scope !== 'Queue') {
      const caller = findEnclosingSymbol(node, namespace);
      if (!caller) return null;
      const eventClass = resolveClassName(scope, namespace, context, filePath);
      if (eventClass.includes('Job')) return null;
      return { source: caller, target: eventClass, type: 'DISPATCHES_EVENT', metadata: { pattern: 'static', event: eventClass } };
    }
  }

  return null;
}

function collectEventDispatches(node, namespace, filePath, context) {
  if (node.type === 'namespace_definition') {
    const nameNode = node.childForFieldName('name');
    namespace = nameNode ? nameNode.text : namespace;
  }

  const edges = [];
  const edge = extractEventDispatch(node, namespace, filePath, context);
  if (edge) edges.push(edge);

  for (let i = 0; i < node.childCount; i++) {
    edges.push(...collectEventDispatches(node.child(i), namespace, filePath, context));
  }

  return edges;
}
