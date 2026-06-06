import { extractNamespace, qualify, extractVisibility, hasModifier, extractParams } from './utils.js';

export default {
  name: 'plugin:php:symbol',
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
  extract(filePath, content, tree) {
    const namespace = extractNamespace(tree.rootNode);
    return collectDeclarations(tree.rootNode, namespace, filePath);
  },
};

function makeNode(type, name, qn, filePath, node, metadata) {
  return { type, name, qualified_name: qn, file_path: filePath, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1, ...(metadata ? { metadata } : {}) };
}

function extractClassLikeDeclaration(node, type, namespace, filePath) {
  const name = node.childForFieldName('name')?.text;
  if (!name) return null;
  const qn = qualify(namespace, name);
  const declNode = makeNode(type, name, qn, filePath, node);
  const definesEdge = { source: filePath, target: qn, type: 'DEFINES' };
  const members = type === 'Enum' ? { nodes: [], edges: [] } : extractMembers(node, qn, filePath);
  return {
    nodes: [declNode, ...members.nodes],
    edges: [definesEdge, ...members.edges],
  };
}

function extractFunctionDeclaration(node, namespace, filePath) {
  const name = node.childForFieldName('name')?.text;
  if (!name) return null;
  const qn = qualify(namespace, name);
  return {
    nodes: [makeNode('Function', name, qn, filePath, node, { params: extractParams(node) })],
    edges: [{ source: filePath, target: qn, type: 'DEFINES' }],
  };
}

function extractConstDeclaration(node, namespace, filePath) {
  const nodes = [];
  const edges = [];
  for (const element of node.children) {
    if (element.type === 'const_element') {
      const name = element.childForFieldName('name')?.text;
      if (!name) continue;
      const qn = qualify(namespace, name);
      nodes.push(makeNode('Constant', name, qn, filePath, node));
      edges.push({ source: filePath, target: qn, type: 'DEFINES' });
    }
  }
  return { nodes, edges };
}

function extractMethod(member, classQn, filePath) {
  const name = member.childForFieldName('name')?.text;
  if (!name) return null;
  const qn = `${classQn}::${name}`;
  return {
    node: makeNode('Method', name, qn, filePath, member, { visibility: extractVisibility(member), params: extractParams(member), static: hasModifier(member, 'static') }),
    edge: { source: classQn, target: qn, type: 'HAS_METHOD' },
  };
}

function extractProperty(member, classQn, filePath) {
  const nodes = [];
  const edges = [];
  for (const prop of member.children) {
    if (prop.type === 'property_element') {
      const varNode = prop.childForFieldName('name') ?? prop.children.find(c => c.type === 'variable_name');
      const name = varNode?.text?.replace(/^\$/, '');
      if (!name) continue;
      const qn = `${classQn}::$${name}`;
      nodes.push(makeNode('Property', name, qn, filePath, member, { visibility: extractVisibility(member), static: hasModifier(member, 'static') }));
      edges.push({ source: classQn, target: qn, type: 'HAS_PROPERTY' });
    }
  }
  return { nodes, edges };
}

function extractClassConstant(member, classQn, filePath) {
  const nodes = [];
  for (const element of member.children) {
    if (element.type === 'const_element') {
      const name = element.childForFieldName('name')?.text;
      if (!name) continue;
      const qn = `${classQn}::${name}`;
      nodes.push(makeNode('Constant', name, qn, filePath, member, { visibility: extractVisibility(member) }));
    }
  }
  return { nodes, edges: [] };
}

function extractMembers(classNode, classQn, filePath) {
  const body = classNode.childForFieldName('body');
  if (!body) return { nodes: [], edges: [] };

  const nodes = [];
  const edges = [];

  for (const member of body.children) {
    if (member.type === 'method_declaration') {
      const result = extractMethod(member, classQn, filePath);
      if (result) { nodes.push(result.node); edges.push(result.edge); }
    } else if (member.type === 'property_declaration') {
      const result = extractProperty(member, classQn, filePath);
      nodes.push(...result.nodes);
      edges.push(...result.edges);
    } else if (member.type === 'const_declaration') {
      const result = extractClassConstant(member, classQn, filePath);
      nodes.push(...result.nodes);
    }
  }

  return { nodes, edges };
}

const DECLARATION_TYPES = {
  class_declaration: 'Class',
  interface_declaration: 'Interface',
  trait_declaration: 'Trait',
  enum_declaration: 'Enum',
};

function extractDeclaration(node, namespace, filePath) {
  const type = DECLARATION_TYPES[node.type];
  if (type) return extractClassLikeDeclaration(node, type, namespace, filePath);
  if (node.type === 'function_definition') return extractFunctionDeclaration(node, namespace, filePath);
  if (node.type === 'const_declaration') return extractConstDeclaration(node, namespace, filePath);
  return null;
}

function collectDeclarations(node, namespace, filePath) {
  const nodes = [];
  const edges = [];

  const result = extractDeclaration(node, namespace, filePath);
  if (result) {
    nodes.push(...result.nodes);
    edges.push(...result.edges);
  }

  for (const child of node.children) {
    if (child.type === 'namespace_definition') {
      const nsName = child.childForFieldName('name');
      const ns = nsName ? nsName.text : namespace;
      const body = child.childForFieldName('body');
      if (body) {
        for (const c of body.children) {
          const r = collectDeclarations(c, ns, filePath);
          nodes.push(...r.nodes);
          edges.push(...r.edges);
        }
      } else {
        for (let i = child.children.indexOf(nsName ?? child.children[0]) + 1; i < child.children.length; i++) {
          const r = collectDeclarations(child.children[i], ns, filePath);
          nodes.push(...r.nodes);
          edges.push(...r.edges);
        }
      }
    } else {
      const r = collectDeclarations(child, namespace, filePath);
      nodes.push(...r.nodes);
      edges.push(...r.edges);
    }
  }

  return { nodes, edges };
}
