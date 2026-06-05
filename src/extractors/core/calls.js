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
  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i);
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

function resolveVariableType(varName, node, namespace, context, filePath) {
  let current = node.parent;
  while (current) {
    if (current.type === 'method_declaration' || current.type === 'function_definition') {
      const params = current.childForFieldName('parameters');
      if (params) {
        for (let i = 0; i < params.childCount; i++) {
          const param = params.child(i);
          if (param.type === 'simple_parameter' || param.type === 'property_promotion_parameter') {
            const paramName = param.childForFieldName('name')?.text;
            if (paramName === varName) {
              const typeNode = param.childForFieldName('type');
              if (typeNode) {
                const typeName = typeNode.type === 'union_type' || typeNode.type === 'intersection_type'
                  ? null
                  : typeNode.text.replace(/^\?/, '');
                if (typeName && !isPrimitiveType(typeName)) {
                  return resolveClassName(typeName, namespace, context, filePath);
                }
              }
              return null;
            }
          }
        }
      }
      break;
    }
    if (current.type === 'class_declaration') {
      const body = current.childForFieldName('body');
      if (body) {
        for (let i = 0; i < body.childCount; i++) {
          const member = body.child(i);
          if (member.type === 'method_declaration') {
            const methodName = member.childForFieldName('name')?.text;
            if (methodName === '__construct') {
              const params = member.childForFieldName('parameters');
              if (params) {
                for (let j = 0; j < params.childCount; j++) {
                  const param = params.child(j);
                  if (param.type === 'property_promotion_parameter') {
                    const paramName = param.childForFieldName('name')?.text;
                    if (paramName === varName) {
                      const typeNode = param.childForFieldName('type');
                      if (typeNode) {
                        const typeName = typeNode.text.replace(/^\?/, '');
                        if (!isPrimitiveType(typeName)) {
                          return resolveClassName(typeName, namespace, context, filePath);
                        }
                      }
                      return null;
                    }
                  }
                }
              }
            }
          }
        }
      }
      break;
    }
    current = current.parent;
  }
  return null;
}

function resolvePropertyType(propExpr, node, namespace, context, filePath) {
  const propName = propExpr.replace('$this->', '');
  let current = node;
  while (current) {
    if (current.type === 'class_declaration') {
      const body = current.childForFieldName('body');
      if (!body) break;
      for (let i = 0; i < body.childCount; i++) {
        const member = body.child(i);
        if (member.type === 'method_declaration' && member.childForFieldName('name')?.text === '__construct') {
          const params = member.childForFieldName('parameters');
          if (params) {
            for (let j = 0; j < params.childCount; j++) {
              const param = params.child(j);
              if (param.type === 'property_promotion_parameter') {
                const paramName = param.childForFieldName('name')?.text?.replace(/^\$/, '');
                if (paramName === propName) {
                  const typeNode = param.childForFieldName('type');
                  if (typeNode) {
                    const typeName = typeNode.text.replace(/^\?/, '');
                    if (!isPrimitiveType(typeName)) return resolveClassName(typeName, namespace, context, filePath);
                  }
                  return null;
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
              const pName = varNode?.text?.replace(/^\$/, '');
              if (pName === propName && typeNode) {
                const typeName = typeNode.text.replace(/^\?/, '');
                if (!isPrimitiveType(typeName)) return resolveClassName(typeName, namespace, context, filePath);
              }
            }
          }
        }
      }
      break;
    }
    current = current.parent;
  }
  return null;
}

function isPrimitiveType(type) {
  const primitives = new Set(['string', 'int', 'float', 'bool', 'array', 'object', 'mixed', 'void', 'null', 'callable', 'iterable', 'never', 'true', 'false']);
  return primitives.has(type.toLowerCase());
}

function findParentClass(node, namespace, context, filePath) {
  let current = node;
  while (current) {
    if (current.type === 'class_declaration' || current.type === 'enum_declaration') {
      const baseClause = current.childForFieldName('base_clause') ?? current.children?.find(c => c.type === 'base_clause');
      if (baseClause) {
        for (let i = 0; i < baseClause.childCount; i++) {
          const child = baseClause.child(i);
          if (child.type === 'name' || child.type === 'qualified_name') {
            return resolveClassName(child.text, namespace, context, filePath);
          }
        }
      }
      return null;
    }
    current = current.parent;
  }
  return null;
}

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

function walkForCalls(node, namespace, filePath, edges, context) {
  if (node.type === 'namespace_definition') {
    const nameNode = node.childForFieldName('name');
    namespace = nameNode ? nameNode.text : namespace;
  }

  if (node.type === 'scoped_call_expression') {
    const scope = node.childForFieldName('scope')?.text;
    const name = node.childForFieldName('name')?.text;
    if (scope && name) {
      const caller = findEnclosingSymbol(node, namespace);
      if (caller) {
        let targetClass;
        if (scope === 'self' || scope === 'static') {
          targetClass = caller.split('::')[0];
        } else if (scope === 'parent') {
          targetClass = findParentClass(node, namespace, context, filePath);
        } else {
          targetClass = resolveClassName(scope, namespace, context, filePath);
        }
        if (targetClass) edges.push({ source: caller, target: `${targetClass}::${name}`, type: 'CALLS' });
      }
    }
  } else if (node.type === 'member_call_expression') {
    const name = node.childForFieldName('name')?.text;
    const object = node.childForFieldName('object');
    if (name) {
      const caller = findEnclosingSymbol(node, namespace);
      if (caller) {
        if (object?.text === '$this') {
          const classQn = caller.split('::')[0];
          edges.push({ source: caller, target: `${classQn}::${name}`, type: 'CALLS' });
        } else if (object?.type === 'variable_name') {
          const varType = resolveVariableType(object.text, node, namespace, context, filePath);
          if (varType) {
            edges.push({ source: caller, target: `${varType}::${name}`, type: 'CALLS' });
          }
        } else if (object?.type === 'member_access_expression') {
          const obj = object.childForFieldName('object');
          const prop = object.childForFieldName('name')?.text;
          if (obj?.text === '$this' && prop) {
            const propType = resolvePropertyType('$this->' + prop, node, namespace, context, filePath);
            if (propType) {
              edges.push({ source: caller, target: `${propType}::${name}`, type: 'CALLS' });
            }
          }
        }
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

  for (let i = 0; i < node.childCount; i++) {
    walkForCalls(node.child(i), namespace, filePath, edges, context);
  }
}
