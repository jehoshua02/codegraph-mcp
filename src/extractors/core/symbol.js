export default {
  name: 'core:symbol',
  types: [
    { type: 'Class', kind: 'node', description: 'Class declaration' },
    { type: 'Method', kind: 'node', description: 'Method declaration' },
    { type: 'Function', kind: 'node', description: 'Function declaration' },
    { type: 'Interface', kind: 'node', description: 'Interface declaration' },
    { type: 'Trait', kind: 'node', description: 'Trait declaration' },
    { type: 'Enum', kind: 'node', description: 'Enum declaration' },
    { type: 'Constant', kind: 'node', description: 'Constant declaration' },
    { type: 'Property', kind: 'node', description: 'Property declaration' },
    { type: 'HAS_METHOD', kind: 'edge', description: 'Class/Interface/Trait has method' },
    { type: 'HAS_PROPERTY', kind: 'edge', description: 'Class has property' },
  ],
  fileFilter: (fp) => fp.endsWith('.php'),
  extract(filePath, content, tree, context) {
    const nodes = [];
    const edges = [];
    const namespace = extractNamespace(tree.rootNode);

    walkNode(tree.rootNode, namespace, filePath, nodes, edges, context);

    return { nodes, edges };
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

function walkNode(node, namespace, filePath, nodes, edges, context) {
  switch (node.type) {
    case 'class_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (!name) break;
      const qn = qualify(namespace, name);
      nodes.push({ type: 'Class', name, qualified_name: qn, file_path: filePath, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1 });
      edges.push({ source: filePath, target: qn, type: 'DEFINES' });
      extractMembers(node, qn, filePath, nodes, edges);
      break;
    }
    case 'interface_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (!name) break;
      const qn = qualify(namespace, name);
      nodes.push({ type: 'Interface', name, qualified_name: qn, file_path: filePath, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1 });
      edges.push({ source: filePath, target: qn, type: 'DEFINES' });
      extractMembers(node, qn, filePath, nodes, edges);
      break;
    }
    case 'trait_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (!name) break;
      const qn = qualify(namespace, name);
      nodes.push({ type: 'Trait', name, qualified_name: qn, file_path: filePath, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1 });
      edges.push({ source: filePath, target: qn, type: 'DEFINES' });
      extractMembers(node, qn, filePath, nodes, edges);
      break;
    }
    case 'enum_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (!name) break;
      const qn = qualify(namespace, name);
      nodes.push({ type: 'Enum', name, qualified_name: qn, file_path: filePath, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1 });
      edges.push({ source: filePath, target: qn, type: 'DEFINES' });
      break;
    }
    case 'function_definition': {
      const name = node.childForFieldName('name')?.text;
      if (!name) break;
      const qn = qualify(namespace, name);
      nodes.push({ type: 'Function', name, qualified_name: qn, file_path: filePath, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1, metadata: { params: extractParams(node) } });
      edges.push({ source: filePath, target: qn, type: 'DEFINES' });
      break;
    }
    case 'const_declaration': {
      for (const element of node.children) {
        if (element.type === 'const_element') {
          const name = element.childForFieldName('name')?.text;
          if (!name) continue;
          const qn = qualify(namespace, name);
          nodes.push({ type: 'Constant', name, qualified_name: qn, file_path: filePath, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1 });
          edges.push({ source: filePath, target: qn, type: 'DEFINES' });
        }
      }
      break;
    }
  }

  for (const child of node.children) {
    if (child.type === 'namespace_definition') {
      const nsName = child.childForFieldName('name');
      const ns = nsName ? nsName.text : namespace;
      const body = child.childForFieldName('body');
      if (body) {
        for (const c of body.children) walkNode(c, ns, filePath, nodes, edges, context);
      } else {
        for (let i = child.children.indexOf(nsName ?? child.children[0]) + 1; i < child.children.length; i++) {
          walkNode(child.children[i], ns, filePath, nodes, edges, context);
        }
      }
    } else {
      walkNode(child, namespace, filePath, nodes, edges, context);
    }
  }
}

function extractMembers(classNode, classQn, filePath, nodes, edges) {
  const body = classNode.childForFieldName('body');
  if (!body) return;

  for (const member of body.children) {
    if (member.type === 'method_declaration') {
      const name = member.childForFieldName('name')?.text;
      if (!name) continue;
      const qn = `${classQn}::${name}`;
      const visibility = extractVisibility(member);
      nodes.push({ type: 'Method', name, qualified_name: qn, file_path: filePath, start_line: member.startPosition.row + 1, end_line: member.endPosition.row + 1, metadata: { visibility, params: extractParams(member), static: hasModifier(member, 'static') } });
      edges.push({ source: classQn, target: qn, type: 'HAS_METHOD' });
    } else if (member.type === 'property_declaration') {
      for (const prop of member.children) {
        if (prop.type === 'property_element') {
          const varNode = prop.childForFieldName('name') ?? prop.children.find(c => c.type === 'variable_name');
          const name = varNode?.text?.replace(/^\$/, '');
          if (!name) continue;
          const qn = `${classQn}::$${name}`;
          nodes.push({ type: 'Property', name, qualified_name: qn, file_path: filePath, start_line: member.startPosition.row + 1, end_line: member.endPosition.row + 1, metadata: { visibility: extractVisibility(member), static: hasModifier(member, 'static') } });
          edges.push({ source: classQn, target: qn, type: 'HAS_PROPERTY' });
        }
      }
    } else if (member.type === 'const_declaration') {
      for (const element of member.children) {
        if (element.type === 'const_element') {
          const name = element.childForFieldName('name')?.text;
          if (!name) continue;
          const qn = `${classQn}::${name}`;
          nodes.push({ type: 'Constant', name, qualified_name: qn, file_path: filePath, start_line: member.startPosition.row + 1, end_line: member.endPosition.row + 1, metadata: { visibility: extractVisibility(member) } });
        }
      }
    }
  }
}

function extractVisibility(node) {
  for (const child of node.children) {
    if (child.type === 'visibility_modifier') return child.text;
  }
  return 'public';
}

function hasModifier(node, modifier) {
  for (const child of node.children) {
    if (child.type === 'static_modifier' && modifier === 'static') return true;
    if (child.type === 'abstract_modifier' && modifier === 'abstract') return true;
    if (child.type === 'final_modifier' && modifier === 'final') return true;
  }
  return false;
}

function extractParams(node) {
  const params = node.childForFieldName('parameters');
  if (!params) return [];
  return params.children
    .filter(c => c.type === 'simple_parameter' || c.type === 'property_promotion_parameter')
    .map(p => {
      const name = p.childForFieldName('name')?.text?.replace(/^\$/, '');
      const type = p.childForFieldName('type')?.text;
      return { name, type: type ?? null };
    });
}
