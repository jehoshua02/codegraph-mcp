export default {
  name: 'plugin:php:import',
  types: [
    { type: 'IMPORTS', kind: 'edge', description: 'File imports a symbol via use statement' },
  ],
  fileFilter: (fp) => fp.endsWith('.php'),
  extract(filePath, content, tree) {
    const edges = [];
    const imports = [];

    for (const child of tree.rootNode.children) {
      if (child.type === 'namespace_use_declaration') {
        collectUseDeclaration(child, filePath, edges, imports);
      } else if (child.type === 'namespace_definition') {
        const body = child.childForFieldName('body');
        const searchIn = body ? body.children : child.children;
        for (const c of searchIn) {
          if (c.type === 'namespace_use_declaration') {
            collectUseDeclaration(c, filePath, edges, imports);
          }
        }
      }
    }

    return { nodes: [], edges, imports };
  },
};

function parseUseClause(clause, prefix) {
  const nameNode = clause.childForFieldName('name') ?? clause.children.find(c => c.type === 'namespace_name' || c.type === 'qualified_name' || c.type === 'name');
  if (!nameNode) return null;

  const fullName = prefix ? `${prefix}\\${nameNode.text}` : nameNode.text;
  const aliasNode = clause.childForFieldName('alias');
  const alias = aliasNode ? aliasNode.text : fullName.split('\\').pop();

  return { qualified_name: fullName, alias };
}

function collectUseDeclaration(node, filePath, edges, imports) {
  let prefix = '';
  const prefixNode = node.children.find(c => c.type === 'namespace_name');
  if (prefixNode && node.children.some(c => c.type === 'namespace_use_group')) {
    prefix = prefixNode.text;
  }

  for (const child of node.children) {
    if (child.type === 'namespace_use_clause') {
      const parsed = parseUseClause(child, '');
      if (parsed) {
        edges.push({ source: filePath, target: parsed.qualified_name, type: 'IMPORTS' });
        imports.push(parsed);
      }
    } else if (child.type === 'namespace_use_group') {
      for (const clause of child.children) {
        if (clause.type === 'namespace_use_clause') {
          const parsed = parseUseClause(clause, prefix);
          if (parsed) {
            edges.push({ source: filePath, target: parsed.qualified_name, type: 'IMPORTS' });
            imports.push(parsed);
          }
        }
      }
    }
  }
}
