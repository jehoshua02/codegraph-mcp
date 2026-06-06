import { extractNamespace, qualify, resolveClassName, isPrimitiveType } from './utils.js';

export default {
  name: 'plugin:php:call',
  types: [
    { type: 'CALLS', kind: 'edge', description: 'Symbol calls another symbol' },
  ],
  fileFilter: (fp) => fp.endsWith('.php'),
  extract(filePath, content, tree, context) {
    const namespace = extractNamespace(tree.rootNode);
    return { nodes: [], edges: collectCallEdges(tree.rootNode, namespace, filePath, context) };
  },
};

// --- Read: AST traversal to find type info ---

function findEnclosingSymbol(node, namespace) {
  let current = node.parent;
  while (current) {
    if (current.type === 'method_declaration') {
      const methodName = current.childForFieldName('name')?.text;
      let classNode = current.parent;
      while (classNode && classNode.type === 'declaration_list') classNode = classNode.parent;
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

function findParentClassName(node) {
  let current = node;
  while (current) {
    if (current.type === 'class_declaration' || current.type === 'enum_declaration') {
      const baseClause = current.childForFieldName('base_clause') ?? current.children?.find(c => c.type === 'base_clause');
      if (baseClause) {
        for (let i = 0; i < baseClause.childCount; i++) {
          const child = baseClause.child(i);
          if (child.type === 'name' || child.type === 'qualified_name') return child.text;
        }
      }
      return null;
    }
    current = current.parent;
  }
  return null;
}

function findParameterType(varName, node) {
  let current = node.parent;
  while (current) {
    if (current.type === 'method_declaration' || current.type === 'function_definition') {
      const params = current.childForFieldName('parameters');
      if (params) {
        for (let i = 0; i < params.childCount; i++) {
          const param = params.child(i);
          if (param.type === 'simple_parameter' || param.type === 'property_promotion_parameter') {
            if (param.childForFieldName('name')?.text === varName) {
              const typeNode = param.childForFieldName('type');
              if (typeNode && typeNode.type !== 'union_type' && typeNode.type !== 'intersection_type') {
                return typeNode.text.replace(/^\?/, '');
              }
              return null;
            }
          }
        }
      }
      return null;
    }
    current = current.parent;
  }
  return null;
}

function findConstructorPromotedType(varName, node) {
  let current = node.parent;
  while (current) {
    if (current.type === 'class_declaration') {
      const body = current.childForFieldName('body');
      if (!body) return null;
      for (let i = 0; i < body.childCount; i++) {
        const member = body.child(i);
        if (member.type === 'method_declaration' && member.childForFieldName('name')?.text === '__construct') {
          const params = member.childForFieldName('parameters');
          if (params) {
            for (let j = 0; j < params.childCount; j++) {
              const param = params.child(j);
              if (param.type === 'property_promotion_parameter' && param.childForFieldName('name')?.text === varName) {
                const typeNode = param.childForFieldName('type');
                return typeNode ? typeNode.text.replace(/^\?/, '') : null;
              }
            }
          }
        }
      }
      return null;
    }
    current = current.parent;
  }
  return null;
}

function findPropertyType(propName, node) {
  let current = node;
  while (current) {
    if (current.type === 'class_declaration') {
      const body = current.childForFieldName('body');
      if (!body) return null;
      for (let i = 0; i < body.childCount; i++) {
        const member = body.child(i);
        if (member.type === 'method_declaration' && member.childForFieldName('name')?.text === '__construct') {
          const params = member.childForFieldName('parameters');
          if (params) {
            for (let j = 0; j < params.childCount; j++) {
              const param = params.child(j);
              if (param.type === 'property_promotion_parameter') {
                const pName = param.childForFieldName('name')?.text?.replace(/^\$/, '');
                if (pName === propName) {
                  const typeNode = param.childForFieldName('type');
                  return typeNode ? typeNode.text.replace(/^\?/, '') : null;
                }
              }
            }
          }
        }
        if (member.type === 'property_declaration') {
          const typeNode = member.childForFieldName('type');
          for (let j = 0; j < member.childCount; j++) {
            const prop = member.child(j);
            if (prop.type === 'property_element') {
              const varNode = prop.childForFieldName('name') ?? prop.children?.find(c => c.type === 'variable_name');
              if (varNode?.text?.replace(/^\$/, '') === propName && typeNode) {
                return typeNode.text.replace(/^\?/, '');
              }
            }
          }
        }
      }
      return null;
    }
    current = current.parent;
  }
  return null;
}

// --- Calculate: resolve raw type names to qualified names ---

function resolveVariableType(varName, node, namespace, context, filePath) {
  const rawType = findParameterType(varName, node) ?? findConstructorPromotedType(varName, node);
  if (!rawType || isPrimitiveType(rawType)) return null;
  return resolveClassName(rawType, namespace, context, filePath);
}

function resolvePropertyType(propName, node, namespace, context, filePath) {
  const rawType = findPropertyType(propName, node);
  if (!rawType || isPrimitiveType(rawType)) return null;
  return resolveClassName(rawType, namespace, context, filePath);
}

function resolveScopedCallTarget(scope, caller, node, namespace, context, filePath) {
  if (scope === 'self' || scope === 'static') return caller.split('::')[0];
  if (scope === 'parent') {
    const parentName = findParentClassName(node);
    return parentName ? resolveClassName(parentName, namespace, context, filePath) : null;
  }
  return resolveClassName(scope, namespace, context, filePath);
}

// --- Calculate: extract a single call edge from one AST node ---

function extractCallEdge(node, namespace, filePath, context) {
  if (node.type === 'scoped_call_expression') {
    const scope = node.childForFieldName('scope')?.text;
    const name = node.childForFieldName('name')?.text;
    if (!scope || !name) return null;
    const caller = findEnclosingSymbol(node, namespace);
    if (!caller) return null;
    const targetClass = resolveScopedCallTarget(scope, caller, node, namespace, context, filePath);
    return targetClass ? { source: caller, target: `${targetClass}::${name}`, type: 'CALLS' } : null;
  }

  if (node.type === 'member_call_expression') {
    const name = node.childForFieldName('name')?.text;
    const object = node.childForFieldName('object');
    if (!name) return null;
    const caller = findEnclosingSymbol(node, namespace);
    if (!caller) return null;

    if (object?.text === '$this') {
      return { source: caller, target: `${caller.split('::')[0]}::${name}`, type: 'CALLS' };
    }
    if (object?.type === 'variable_name') {
      const varType = resolveVariableType(object.text, node, namespace, context, filePath);
      return varType ? { source: caller, target: `${varType}::${name}`, type: 'CALLS' } : null;
    }
    if (object?.type === 'member_access_expression') {
      const obj = object.childForFieldName('object');
      const prop = object.childForFieldName('name')?.text;
      if (obj?.text === '$this' && prop) {
        const propType = resolvePropertyType(prop, node, namespace, context, filePath);
        return propType ? { source: caller, target: `${propType}::${name}`, type: 'CALLS' } : null;
      }
    }
    return null;
  }

  if (node.type === 'function_call_expression') {
    const funcNode = node.childForFieldName('function');
    if (!funcNode || (funcNode.type !== 'name' && funcNode.type !== 'qualified_name')) return null;
    const caller = findEnclosingSymbol(node, namespace);
    if (!caller) return null;
    return { source: caller, target: resolveClassName(funcNode.text, namespace, context, filePath), type: 'CALLS' };
  }

  if (node.type === 'object_creation_expression') {
    const classNode = node.childForFieldName('class') ?? node.childForFieldName('name') ?? node.children.find(c => c.type === 'name' || c.type === 'qualified_name');
    if (!classNode) return null;
    const caller = findEnclosingSymbol(node, namespace);
    if (!caller) return null;
    return { source: caller, target: `${resolveClassName(classNode.text, namespace, context, filePath)}::__construct`, type: 'CALLS' };
  }

  return null;
}

// --- Orchestrate: walk tree and collect edges ---

function collectCallEdges(node, namespace, filePath, context) {
  if (node.type === 'namespace_definition') {
    const nameNode = node.childForFieldName('name');
    namespace = nameNode ? nameNode.text : namespace;
  }

  const edges = [];
  const edge = extractCallEdge(node, namespace, filePath, context);
  if (edge) edges.push(edge);

  for (let i = 0; i < node.childCount; i++) {
    edges.push(...collectCallEdges(node.child(i), namespace, filePath, context));
  }

  return edges;
}
