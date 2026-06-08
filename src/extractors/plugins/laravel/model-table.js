import { extractNamespace, qualify } from '../php/utils.js';

export default {
  name: 'plugin:laravel:model-table',
  types: [
    { type: 'MAPS_TO_TABLE', kind: 'edge', description: 'Eloquent model maps to a database table' },
  ],
  fileFilter: (fp) => fp.endsWith('.php'),
  extract(filePath, content, tree, context) {
    const namespace = extractNamespace(tree.rootNode);
    return { nodes: [], edges: collectModelTableMappings(tree.rootNode, namespace, filePath) };
  },
};

function collectModelTableMappings(rootNode, namespace, filePath) {
  const edges = [];
  walkForClasses(rootNode, namespace, filePath, edges);
  return edges;
}

function walkForClasses(node, namespace, filePath, edges) {
  if (node.type === 'namespace_definition') {
    const nameNode = node.childForFieldName('name');
    if (nameNode) namespace = nameNode.text;
  }

  if (node.type === 'class_declaration') {
    const name = node.childForFieldName('name')?.text;
    if (!name) return;

    if (!extendsModel(node)) return;

    const classQn = qualify(namespace, name);
    const body = node.childForFieldName('body');
    if (!body) return;

    const table = extractTableName(body) ?? deriveTableName(name);
    if (table) {
      edges.push({ source: classQn, target: `table::${table}`, type: 'MAPS_TO_TABLE', metadata: { table } });
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    walkForClasses(node.child(i), namespace, filePath, edges);
  }
}

function extendsModel(classNode) {
  const baseClause = classNode.childForFieldName('base_clause') ?? classNode.children?.find(c => c.type === 'base_clause');
  if (!baseClause) return false;
  for (let i = 0; i < baseClause.childCount; i++) {
    const child = baseClause.child(i);
    if (child.type === 'name' || child.type === 'qualified_name') {
      const text = child.text;
      if (text === 'Model' || text.endsWith('Model') || text === 'Pivot' || text === 'Authenticatable') return true;
    }
  }
  return false;
}

function extractTableName(body) {
  let tableValue = null;
  const constants = new Map();

  // First pass: collect all constants
  for (let i = 0; i < body.childCount; i++) {
    const member = body.child(i);
    if (member.type === 'const_declaration') {
      for (let j = 0; j < member.childCount; j++) {
        const el = member.child(j);
        if (el.type === 'const_element') {
          const name = el.childForFieldName('name')?.text ?? el.children?.find(c => c.type === 'name')?.text;
          const value = findStringValue(el);
          if (name && value) constants.set(name, value);
        }
      }
    }
  }

  // Second pass: find $table property
  for (let i = 0; i < body.childCount; i++) {
    const member = body.child(i);
    if (member.type === 'property_declaration') {
      const propName = findPropertyName(member);
      if (propName === 'table') {
        const stringVal = findStringInProperty(member);
        if (stringVal) return stringVal;
        const constRef = findSelfConstRef(member);
        if (constRef) return constants.get(constRef) || null;
      }
    }
  }

  return tableValue;
}

function findPropertyName(propertyDecl) {
  for (let i = 0; i < propertyDecl.childCount; i++) {
    const child = propertyDecl.child(i);
    if (child.type === 'property_element') {
      const varNode = child.childForFieldName('name') ?? child.children?.find(c => c.type === 'variable_name');
      return varNode?.text?.replace(/^\$/, '');
    }
  }
  return null;
}

function findStringInProperty(propertyDecl) {
  for (let i = 0; i < propertyDecl.childCount; i++) {
    const child = propertyDecl.child(i);
    if (child.type === 'property_element') {
      return findStringValue(child);
    }
  }
  return null;
}

function findStringValue(node) {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type === 'string') return child.text.replace(/^['"]|['"]$/g, '');
    const nested = findStringValue(child);
    if (nested) return nested;
  }
  return null;
}

function findSelfConstRef(propertyDecl) {
  for (let i = 0; i < propertyDecl.childCount; i++) {
    const child = propertyDecl.child(i);
    if (child.type === 'property_element') {
      for (let j = 0; j < child.childCount; j++) {
        const el = child.child(j);
        if (el.type === 'class_constant_access_expression') {
          let scope = null;
          let name = null;
          for (let k = 0; k < el.childCount; k++) {
            const part = el.child(k);
            if (part.type === 'relative_scope' || part.type === 'name') {
              if (!scope) scope = part.text;
              else name = part.text;
            }
            if (part.type === 'name' && scope) name = part.text;
          }
          if ((scope === 'self' || scope === 'static') && name) return name;
        }
      }
    }
  }
  return null;
}

function deriveTableName(className) {
  return className
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    + 's';
}
