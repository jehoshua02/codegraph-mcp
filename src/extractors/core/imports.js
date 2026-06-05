export default {
  name: 'core:import',
  types: [
    { type: 'IMPORTS', kind: 'edge', description: 'File imports a symbol via use statement' },
  ],
  fileFilter: (fp) => fp.endsWith('.php'),
  extract(filePath, content, tree, context) {
    const edges = [];
    const imports = [];

    for (const child of tree.rootNode.children) {
      if (child.type === 'namespace_use_declaration') {
        extractUseStatements(child, edges, imports, filePath);
      } else if (child.type === 'namespace_definition') {
        const body = child.childForFieldName('body');
        const searchIn = body ? body.children : child.children;
        for (const c of searchIn) {
          if (c.type === 'namespace_use_declaration') {
            extractUseStatements(c, edges, imports, filePath);
          }
        }
      }
    }

    if (context?.importMap) {
      for (const imp of imports) {
        context.importMap.set(`${filePath}::${imp.alias}`, imp.qualified_name);
      }
    }

    return { nodes: [], edges, imports };
  },
};

function extractUseStatements(node, edges, imports, filePath) {
  let prefix = '';
  const prefixNode = node.children.find(c => c.type === 'namespace_name');
  if (prefixNode && node.children.some(c => c.type === 'namespace_use_group')) {
    prefix = prefixNode.text;
  }

  for (const child of node.children) {
    if (child.type === 'namespace_use_clause') {
      const nameNode = child.childForFieldName('name') ?? child.children.find(c => c.type === 'namespace_name' || c.type === 'qualified_name');
      if (!nameNode) continue;

      const fullName = prefix ? `${prefix}\\${nameNode.text}` : nameNode.text;
      const aliasNode = child.childForFieldName('alias');
      const alias = aliasNode ? aliasNode.text : fullName.split('\\').pop();

      edges.push({ source: filePath, target: fullName, type: 'IMPORTS' });
      imports.push({ qualified_name: fullName, alias });
    } else if (child.type === 'namespace_use_group') {
      for (const clause of child.children) {
        if (clause.type === 'namespace_use_clause') {
          const nameNode = clause.childForFieldName('name') ?? clause.children.find(c => c.type === 'namespace_name');
          if (!nameNode) continue;

          const fullName = prefix ? `${prefix}\\${nameNode.text}` : nameNode.text;
          const aliasNode = clause.childForFieldName('alias');
          const alias = aliasNode ? aliasNode.text : fullName.split('\\').pop();

          edges.push({ source: filePath, target: fullName, type: 'IMPORTS' });
          imports.push({ qualified_name: fullName, alias });
        }
      }
    }
  }
}
