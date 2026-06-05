export default {
  name: 'core:call',
  types: [
    { type: 'CALLS', kind: 'edge', description: 'Symbol calls another symbol' },
  ],
  fileFilter: (fp) => fp.endsWith('.php'),
  extract(filePath, content, tree, context) {
    const edges = [];
    const namespace = extractNamespace(tree.rootNode);
    walkForCalls(tree.rootNode, namespace, filePath, edges, context);
    return { nodes: [], edges };
  },
};

function extractNamespace(rootNode) {
  for (const child of rootNode.children) {
    if (child.type === 'namespace_definition') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) return nameNode.text;
    }
  }
  return '';
}

function qualify(namespace, name) {
  return namespace ? `${namespace}\\${name}` : name;
}

function resolveClassName(name, namespace, context, filePath) {
  if (name.includes('\\')) return name.replace(/^\\/, '');
  if (context?.importMap) {
    const resolved = context.importMap.get(`${filePath}::${name}`);
    if (resolved) return resolved;
  }
  return qualify(namespace, name);
}

function findEnclosingSymbol(node, namespace) {
  let current = node.parent;
  while (current) {
    if (current.type === 'method_declaration') {
      const methodName = current.childForFieldName('name')?.text;
      let classNode = current.parent?.parent;
      if (classNode && (classNode.type === 'class_declaration' || classNode.type === 'trait_declaration' || classNode.type === 'interface_declaration' || classNode.type === 'enum_declaration')) {
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

function walkForCalls(node, namespace, filePath, edges, context) {
  if (node.type === 'namespace_definition') {
    const nameNode = node.childForFieldName('name');
    namespace = nameNode ? nameNode.text : namespace;
  }

  if (node.type === 'scoped_call_expression') {
    const scope = node.childForFieldName('scope')?.text;
    const name = node.childForFieldName('name')?.text;
    if (scope && name && scope !== 'self' && scope !== 'static' && scope !== 'parent') {
      const caller = findEnclosingSymbol(node, namespace);
      const target = `${resolveClassName(scope, namespace, context, filePath)}::${name}`;
      if (caller) edges.push({ source: caller, target, type: 'CALLS' });
    }
  } else if (node.type === 'member_call_expression') {
    const name = node.childForFieldName('name')?.text;
    const object = node.childForFieldName('object');
    if (name && object?.text === '$this') {
      const caller = findEnclosingSymbol(node, namespace);
      if (caller) {
        const classQn = caller.split('::')[0];
        edges.push({ source: caller, target: `${classQn}::${name}`, type: 'CALLS' });
      }
    }
  } else if (node.type === 'function_call_expression') {
    const funcNode = node.childForFieldName('function');
    if (funcNode && (funcNode.type === 'name' || funcNode.type === 'qualified_name')) {
      const caller = findEnclosingSymbol(node, namespace);
      const target = resolveClassName(funcNode.text, namespace, context, filePath);
      if (caller) edges.push({ source: caller, target, type: 'CALLS' });
    }
  } else if (node.type === 'object_creation_expression') {
    const classNode = node.childForFieldName('class');
    if (classNode && (classNode.type === 'name' || classNode.type === 'qualified_name')) {
      const caller = findEnclosingSymbol(node, namespace);
      const target = resolveClassName(classNode.text, namespace, context, filePath);
      if (caller) edges.push({ source: caller, target: `${target}::__construct`, type: 'CALLS' });
    }
  }

  for (const child of node.children) {
    walkForCalls(child, namespace, filePath, edges, context);
  }
}
