export default {
  name: 'core:inheritance',
  types: [
    { type: 'EXTENDS', kind: 'edge', description: 'Class extends another class' },
    { type: 'IMPLEMENTS', kind: 'edge', description: 'Class implements an interface' },
    { type: 'USES_TRAIT', kind: 'edge', description: 'Class uses a trait' },
  ],
  fileFilter: (fp) => fp.endsWith('.php'),
  extract(filePath, content, tree, context) {
    const edges = [];
    const namespace = extractNamespace(tree.rootNode);
    walkForInheritance(tree.rootNode, namespace, filePath, edges, context);
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

function walkForInheritance(node, namespace, filePath, edges, context) {
  if (node.type === 'namespace_definition') {
    const nameNode = node.childForFieldName('name');
    namespace = nameNode ? nameNode.text : namespace;
  }

  if (node.type === 'class_declaration' || node.type === 'interface_declaration' || node.type === 'enum_declaration') {
    const name = node.childForFieldName('name')?.text;
    if (!name) return;
    const qn = qualify(namespace, name);

    const baseClause = node.childForFieldName('base_clause') ?? node.children.find(c => c.type === 'base_clause');
    if (baseClause) {
      for (const child of baseClause.children) {
        if (child.type === 'name' || child.type === 'qualified_name') {
          edges.push({ source: qn, target: resolveClassName(child.text, namespace, context, filePath), type: 'EXTENDS' });
        }
      }
    }

    for (const child of node.children) {
      if (child.type === 'class_interface_clause') {
        for (const iface of child.children) {
          if (iface.type === 'name' || iface.type === 'qualified_name') {
            edges.push({ source: qn, target: resolveClassName(iface.text, namespace, context, filePath), type: 'IMPLEMENTS' });
          }
        }
      }
    }

    const body = node.childForFieldName('body');
    if (body) {
      for (const member of body.children) {
        if (member.type === 'use_declaration') {
          for (const traitChild of member.children) {
            if (traitChild.type === 'name' || traitChild.type === 'qualified_name') {
              edges.push({ source: qn, target: resolveClassName(traitChild.text, namespace, context, filePath), type: 'USES_TRAIT' });
            }
          }
        }
      }
    }
  }

  for (const child of node.children) {
    walkForInheritance(child, namespace, filePath, edges, context);
  }
}
