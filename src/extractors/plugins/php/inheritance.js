import { extractNamespace, qualify, resolveClassName } from './utils.js';

export default {
  name: 'plugin:php:inheritance',
  types: [
    { type: 'EXTENDS', kind: 'edge', description: 'Class extends another class' },
    { type: 'IMPLEMENTS', kind: 'edge', description: 'Class implements an interface' },
    { type: 'USES_TRAIT', kind: 'edge', description: 'Class uses a trait' },
  ],
  fileFilter: (fp) => fp.endsWith('.php'),
  extract(filePath, content, tree, context) {
    if (!content.includes('extends') && !content.includes('implements') && !content.includes('use ')) return { nodes: [], edges: [] };
    const namespace = extractNamespace(tree.rootNode);
    return { nodes: [], edges: collectInheritanceEdges(tree.rootNode, namespace, filePath, context) };
  },
};

function extractExtendsEdges(node, qn, namespace, context, filePath) {
  const baseClause = node.childForFieldName('base_clause') ?? node.children.find(c => c.type === 'base_clause');
  if (!baseClause) return [];
  return baseClause.children
    .filter(c => c.type === 'name' || c.type === 'qualified_name')
    .map(c => ({ source: qn, target: resolveClassName(c.text, namespace, context, filePath), type: 'EXTENDS' }));
}

function extractImplementsEdges(node, qn, namespace, context, filePath) {
  const edges = [];
  for (const child of node.children) {
    if (child.type === 'class_interface_clause') {
      for (const iface of child.children) {
        if (iface.type === 'name' || iface.type === 'qualified_name') {
          edges.push({ source: qn, target: resolveClassName(iface.text, namespace, context, filePath), type: 'IMPLEMENTS' });
        }
      }
    }
  }
  return edges;
}

function extractTraitUseEdges(node, qn, namespace, context, filePath) {
  const body = node.childForFieldName('body');
  if (!body) return [];
  const edges = [];
  for (let i = 0; i < body.childCount; i++) {
    const member = body.child(i);
    if (member.type === 'use_declaration') {
      for (const traitChild of member.children) {
        if (traitChild.type === 'name' || traitChild.type === 'qualified_name') {
          edges.push({ source: qn, target: resolveClassName(traitChild.text, namespace, context, filePath), type: 'USES_TRAIT' });
        }
      }
    }
  }
  return edges;
}

function extractDeclarationEdges(node, namespace, filePath, context) {
  if (node.type !== 'class_declaration' && node.type !== 'interface_declaration' && node.type !== 'enum_declaration') return [];
  const name = node.childForFieldName('name')?.text;
  if (!name) return [];
  const qn = qualify(namespace, name);

  return [
    ...extractExtendsEdges(node, qn, namespace, context, filePath),
    ...extractImplementsEdges(node, qn, namespace, context, filePath),
    ...extractTraitUseEdges(node, qn, namespace, context, filePath),
  ];
}

function collectInheritanceEdges(node, namespace, filePath, context) {
  if (node.type === 'namespace_definition') {
    const nameNode = node.childForFieldName('name');
    namespace = nameNode ? nameNode.text : namespace;
  }

  const edges = extractDeclarationEdges(node, namespace, filePath, context);

  for (const child of node.children) {
    edges.push(...collectInheritanceEdges(child, namespace, filePath, context));
  }

  return edges;
}
