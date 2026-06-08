import { extractNamespace, resolveClassName } from '../php/utils.js';

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'any', 'match']);
const RESOURCE_METHODS = new Set(['resource', 'apiResource']);

export default {
  name: 'plugin:laravel:route',
  types: [
    { type: 'Route', kind: 'node', description: 'HTTP route definition' },
    { type: 'ROUTE_HANDLES', kind: 'edge', description: 'Route dispatches to a controller method' },
  ],
  fileFilter: (fp) => fp.endsWith('.php'),
  extract(filePath, content, tree, context) {
    const namespace = extractNamespace(tree.rootNode);
    const closureVars = collectClosureVariables(tree.rootNode);
    const closureVarIds = new Set([...closureVars.values()].map(n => nodeKey(n)));
    const nodes = [];
    const edges = [];
    const arrayVars = collectArrayVariables(tree.rootNode);
    collectRoutes(tree.rootNode, namespace, filePath, context, nodes, edges, { controller: null, prefix: '' }, closureVars, closureVarIds);
    collectDynamicRoutes(tree.rootNode, namespace, filePath, context, nodes, edges, { controller: null, prefix: '' }, arrayVars);
    return { nodes, edges };
  },
};

function extractStringValue(node) {
  if (!node) return null;
  if (node.type === 'string') return node.text.replace(/^['"]|['"]$/g, '');
  if (node.type === 'encapsed_string') return node.text.replace(/^"|"$/g, '');
  if (node.type === 'argument') {
    for (let i = 0; i < node.childCount; i++) {
      const v = extractStringValue(node.child(i));
      if (v !== null) return v;
    }
  }
  return null;
}

function getArgs(node) {
  const args = node.childForFieldName('arguments');
  if (!args) return [];
  return args.children.filter(c => c.isNamed);
}

function findInArgs(args, type) {
  for (const arg of args) {
    if (arg.type === type) return arg;
    if (arg.type === 'argument') {
      for (let i = 0; i < arg.childCount; i++) {
        if (arg.child(i).type === type) return arg.child(i);
      }
    }
  }
  return null;
}

function extractClassFromNode(node, namespace, context, filePath) {
  const cls = node.childForFieldName('class') ?? node.children.find(c => c.type === 'name' || c.type === 'qualified_name');
  return cls ? resolveClassName(cls.text, namespace, context, filePath) : null;
}

function parseControllerArray(arrayNode, namespace, context, filePath) {
  const elements = [];
  for (let i = 0; i < arrayNode.childCount; i++) {
    const child = arrayNode.child(i);
    if (child.type === 'array_element_initializer') {
      for (let j = 0; j < child.childCount; j++) elements.push(child.child(j));
    } else {
      elements.push(child);
    }
  }

  let controllerClass = null;
  let method = null;
  for (const el of elements) {
    if (el.type === 'class_constant_access_expression') {
      controllerClass = extractClassFromNode(el, namespace, context, filePath);
    } else if (el.type === 'string') {
      method = el.text.replace(/^['"]|['"]$/g, '');
    }
  }
  return { controllerClass, method };
}

function resolveHandler(args, namespace, context, filePath, groupController) {
  const handlerArgs = args.slice(1);
  const arrayNode = findInArgs(handlerArgs, 'array_creation_expression');
  if (arrayNode) {
    return parseControllerArray(arrayNode, namespace, context, filePath);
  }

  const classConst = findInArgs(handlerArgs, 'class_constant_access_expression');
  if (classConst) {
    return { controllerClass: extractClassFromNode(classConst, namespace, context, filePath), method: '__invoke' };
  }

  const stringArg = extractStringValue(handlerArgs[0]);
  if (stringArg && stringArg.includes('@')) {
    const [cls, method] = stringArg.split('@');
    return { controllerClass: resolveClassName(cls, namespace, context, filePath), method };
  }
  if (stringArg && groupController) {
    return { controllerClass: groupController, method: stringArg };
  }

  return { controllerClass: null, method: null };
}

function hasClosure(args) {
  for (const arg of args) {
    if (arg.type === 'anonymous_function' || arg.type === 'anonymous_function_creation_expression') return true;
    if (arg.type === 'argument') {
      for (let i = 0; i < arg.childCount; i++) {
        const t = arg.child(i).type;
        if (t === 'anonymous_function' || t === 'anonymous_function_creation_expression') return true;
      }
    }
  }
  return false;
}

function joinPath(prefix, path) {
  if (!prefix) return path;
  const p = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const s = path.startsWith('/') ? path : '/' + path;
  return p + s;
}

function makeRoute(httpMethod, path, filePath, node, target) {
  const routeQn = `route::${httpMethod}::${path}`;
  const routeNode = { type: 'Route', name: path, qualified_name: routeQn, file_path: filePath, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1, metadata: { http_method: httpMethod.toUpperCase(), path } };
  const edge = target ? { source: routeQn, target, type: 'ROUTE_HANDLES' } : null;
  return { node: routeNode, edge };
}

function extractResourceRoutes(methodName, path, controllerClass, filePath, node) {
  const methods = methodName === 'apiResource'
    ? ['index', 'store', 'show', 'update', 'destroy']
    : ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy'];

  return methods.map(m => {
    const httpMethod = m === 'store' ? 'POST' : m === 'update' ? 'PUT' : m === 'destroy' ? 'DELETE' : 'GET';
    const routeQn = `route::${methodName === 'apiResource' ? 'api.' : ''}${path}.${m}`;
    return {
      node: { type: 'Route', name: `${path}.${m}`, qualified_name: routeQn, file_path: filePath, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1, metadata: { http_method: httpMethod, path } },
      edge: { source: routeQn, target: `${controllerClass}::${m}`, type: 'ROUTE_HANDLES' },
    };
  });
}

function isRouteCall(node) {
  if (node.type === 'scoped_call_expression') {
    const scope = node.childForFieldName('scope')?.text;
    return scope === 'Route' || scope?.endsWith('Route');
  }
  if (node.type === 'member_call_expression') {
    return isRouteChain(node.childForFieldName('object'));
  }
  return false;
}

function isRouteChain(node) {
  if (!node) return false;
  if (node.type === 'scoped_call_expression') {
    const scope = node.childForFieldName('scope')?.text;
    return scope === 'Route' || scope?.endsWith('Route');
  }
  if (node.type === 'member_call_expression') {
    return isRouteChain(node.childForFieldName('object'));
  }
  return false;
}

function extractGroupContext(node, namespace, context, filePath, currentGroup) {
  let controller = currentGroup.controller;
  let prefix = currentGroup.prefix;

  extractChainContext(node, namespace, context, filePath, (method, args) => {
    if (method === 'controller') {
      const classConst = findInArgs(args, 'class_constant_access_expression');
      if (classConst) controller = extractClassFromNode(classConst, namespace, context, filePath);
    } else if (method === 'prefix') {
      const p = extractStringValue(args[0]);
      if (p) prefix = joinPath(prefix, p);
    } else if (method === 'group' && args.length > 0) {
      const arrayNode = findInArgs(args, 'array_creation_expression');
      if (arrayNode) {
        const extracted = extractArrayConfig(arrayNode);
        if (extracted.prefix) prefix = joinPath(prefix, extracted.prefix);
        if (extracted.controller) {
          controller = resolveClassName(extracted.controller, namespace, context, filePath);
        }
      }
    }
  });

  return { controller, prefix };
}

function extractChainContext(node, namespace, context, filePath, callback) {
  if (node.type === 'scoped_call_expression') {
    const method = node.childForFieldName('name')?.text;
    if (method) callback(method, getArgs(node));
  } else if (node.type === 'member_call_expression') {
    const object = node.childForFieldName('object');
    if (object) extractChainContext(object, namespace, context, filePath, callback);
    const method = node.childForFieldName('name')?.text;
    if (method) callback(method, getArgs(node));
  }
}

function extractArrayConfig(arrayNode) {
  const result = { prefix: null, controller: null };
  for (let i = 0; i < arrayNode.childCount; i++) {
    const child = arrayNode.child(i);
    if (child.type === 'array_element_initializer') {
      const strings = [];
      let classConst = null;
      for (let j = 0; j < child.childCount; j++) {
        const el = child.child(j);
        if (el.type === 'string') strings.push(el.text.replace(/^['"]|['"]$/g, ''));
        if (el.type === 'class_constant_access_expression') classConst = el;
      }
      if (strings.length >= 2) {
        const key = strings[0];
        const value = strings[1];
        if (key === 'prefix') result.prefix = value;
      }
      if (strings.length >= 1 && classConst) {
        const key = strings[0];
        if (key === 'controller') {
          const cls = (classConst.childForFieldName('class') ?? classConst.children.find(c => c.type === 'name'))?.text;
          if (cls) result.controller = cls;
        }
      }
    }
  }
  return result;
}

function collectClosureVariables(rootNode) {
  const vars = new Map();
  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i);
    if (child.type === 'expression_statement') {
      const expr = child.child(0);
      if (expr?.type === 'assignment_expression') {
        const left = expr.childForFieldName('left');
        const right = expr.childForFieldName('right');
        if (left?.type === 'variable_name' && (right?.type === 'anonymous_function' || right?.type === 'anonymous_function_creation_expression')) {
          vars.set(left.text, right);
        }
      }
    }
  }
  return vars;
}

function findClosure(node, closureVars) {
  const args = node.childForFieldName('arguments');
  if (!args) return null;
  for (let i = 0; i < args.childCount; i++) {
    const child = args.child(i);
    if (child.type === 'anonymous_function_creation_expression' || child.type === 'anonymous_function') return child;
    if (child.type === 'argument') {
      for (let j = 0; j < child.childCount; j++) {
        const inner = child.child(j);
        if (inner.type === 'anonymous_function_creation_expression' || inner.type === 'anonymous_function') return inner;
        if (inner.type === 'variable_name' && closureVars?.has(inner.text)) return closureVars.get(inner.text);
      }
    }
    if (child.type === 'variable_name' && closureVars?.has(child.text)) return closureVars.get(child.text);
  }
  return null;
}

function nodeKey(node) {
  return `${node.startIndex}:${node.endIndex}`;
}

function isClosureVariable(node, closureVarKeys) {
  if (!closureVarKeys) return false;
  if (node.type === 'anonymous_function' || node.type === 'anonymous_function_creation_expression') {
    return closureVarKeys.has(nodeKey(node));
  }
  return false;
}

function collectRoutes(node, namespace, filePath, context, nodes, edges, group, closureVars, closureVarIds, insideGroupClosure = false) {
  if (!insideGroupClosure && isClosureVariable(node, closureVarIds)) return;

  if (node.type === 'namespace_definition') {
    const nameNode = node.childForFieldName('name');
    namespace = nameNode ? nameNode.text : namespace;
  }

  if (isRouteCall(node)) {
    const method = node.childForFieldName('name')?.text;
    const args = getArgs(node);

    if (HTTP_METHODS.has(method)) {
      const rawPath = extractStringValue(args[0]);
      if (rawPath) {
        const path = joinPath(group.prefix, rawPath);
        const { controllerClass, method: handlerMethod } = resolveHandler(args, namespace, context, filePath, group.controller);

        if (controllerClass) {
          const route = makeRoute(method, path, filePath, node, `${controllerClass}::${handlerMethod ?? '__invoke'}`);
          nodes.push(route.node);
          if (route.edge) edges.push(route.edge);
        } else if (hasClosure(args.slice(1))) {
          const route = makeRoute(method, path, filePath, node, null);
          route.node.metadata.handler = 'Closure';
          nodes.push(route.node);
        }
      }
    } else if (RESOURCE_METHODS.has(method)) {
      const rawPath = extractStringValue(args[0]);
      const classConst = findInArgs(args.slice(1), 'class_constant_access_expression');
      if (rawPath && classConst) {
        const path = joinPath(group.prefix, rawPath);
        const controllerClass = extractClassFromNode(classConst, namespace, context, filePath);
        if (controllerClass) {
          for (const r of extractResourceRoutes(method, path, controllerClass, filePath, node)) {
            nodes.push(r.node);
            edges.push(r.edge);
          }
        }
      }
    } else if (method === 'group' || method === 'controller' || method === 'prefix' || method === 'middleware') {
      const newGroup = extractGroupContext(node, namespace, context, filePath, group);
      const closure = findClosure(node, closureVars);
      if (closure) {
        collectRoutes(closure, namespace, filePath, context, nodes, edges, newGroup, closureVars, closureVarIds, true);
        return;
      }
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    collectRoutes(node.child(i), namespace, filePath, context, nodes, edges, group, closureVars, closureVarIds);
  }
}

function collectArrayVariables(rootNode) {
  const vars = new Map();
  function walk(node) {
    if (node.type === 'expression_statement') {
      const expr = node.child(0);
      if (expr?.type === 'assignment_expression') {
        const left = expr.childForFieldName('left');
        const right = expr.childForFieldName('right');
        if (left?.type === 'variable_name' && right?.type === 'array_creation_expression') {
          const strings = [];
          findStrings(right, strings);
          if (strings.length > 0) vars.set(left.text, strings);
        }
      }
    }
    for (let i = 0; i < node.childCount; i++) walk(node.child(i));
  }
  walk(rootNode);
  return vars;
}

function findStrings(node, results) {
  if (node.type === 'string') {
    results.push(node.text.replace(/^['"]|['"]$/g, ''));
  }
  for (let i = 0; i < node.childCount; i++) findStrings(node.child(i), results);
}

function studly(str) {
  return str.split(/[\s_-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

function collectDynamicRoutes(rootNode, namespace, filePath, context, nodes, edges, group, arrayVars) {
  function walk(node, currentGroup) {
    if (node.type === 'namespace_definition') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) namespace = nameNode.text;
    }

    // Detect Route::group and track prefix
    if (isRouteCall(node)) {
      const method = node.childForFieldName('name')?.text;
      if (method === 'group' || method === 'prefix' || method === 'middleware' || method === 'controller') {
        const newGroup = extractGroupContext(node, namespace, context, filePath, currentGroup);
        const args = node.childForFieldName('arguments');
        if (args) {
          for (let i = 0; i < args.childCount; i++) walk(args.child(i), newGroup);
        }
        return;
      }
    }

    // Detect collect($var)->each(closure) where closure contains Route calls
    if (node.type === 'member_call_expression') {
      const method = node.childForFieldName('name')?.text;
      const obj = node.childForFieldName('object');
      if (method === 'each' && obj?.type === 'function_call_expression' && obj.childForFieldName('function')?.text === 'collect') {
        const collectArgs = obj.childForFieldName('arguments');
        const eachArgs = node.childForFieldName('arguments');
        if (collectArgs && eachArgs) {
          const varRef = findVariableInArgs(collectArgs);
          const arrayValues = varRef ? arrayVars.get(varRef) : null;
          if (arrayValues) {
            const closure = findClosureInArgs(eachArgs);
            if (closure && hasRouteCall(closure)) {
              for (const key of arrayValues) {
                const route = deriveRouteFromKey(key, closure, namespace, filePath, context, currentGroup);
                if (route) {
                  nodes.push(route.node);
                  if (route.edge) edges.push(route.edge);
                }
              }
              return;
            }
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) walk(node.child(i), currentGroup);
  }

  walk(rootNode, group);
}

function findVariableInArgs(argsNode) {
  for (let i = 0; i < argsNode.childCount; i++) {
    const child = argsNode.child(i);
    if (child.type === 'variable_name') return child.text;
    if (child.type === 'argument') {
      for (let j = 0; j < child.childCount; j++) {
        if (child.child(j).type === 'variable_name') return child.child(j).text;
      }
    }
  }
  return null;
}

function findClosureInArgs(argsNode) {
  for (let i = 0; i < argsNode.childCount; i++) {
    const child = argsNode.child(i);
    if (child.type === 'anonymous_function' || child.type === 'anonymous_function_creation_expression') return child;
    if (child.type === 'argument') {
      for (let j = 0; j < child.childCount; j++) {
        const t = child.child(j).type;
        if (t === 'anonymous_function' || t === 'anonymous_function_creation_expression') return child.child(j);
      }
    }
  }
  return null;
}

function hasRouteCall(node) {
  if (node.type === 'scoped_call_expression') {
    const scope = node.childForFieldName('scope')?.text;
    const method = node.childForFieldName('name')?.text;
    if (scope === 'Route' && HTTP_METHODS.has(method)) return true;
  }
  for (let i = 0; i < node.childCount; i++) {
    if (hasRouteCall(node.child(i))) return true;
  }
  return false;
}

function findRouteMethodInClosure(node) {
  if (node.type === 'scoped_call_expression') {
    const scope = node.childForFieldName('scope')?.text;
    const method = node.childForFieldName('name')?.text;
    if (scope === 'Route' && HTTP_METHODS.has(method)) return method;
  }
  for (let i = 0; i < node.childCount; i++) {
    const found = findRouteMethodInClosure(node.child(i));
    if (found) return found;
  }
  return null;
}

function deriveRouteFromKey(routingKey, closure, namespace, filePath, context, group) {
  const httpMethod = findRouteMethodInClosure(closure) || 'post';
  const url = routingKey.replace(/\./g, '/');
  const path = joinPath(group.prefix, url);

  const parts = routingKey.split('.');
  const method = parts.pop();
  const prefix = parts.join(' ');
  const controllerName = studly(prefix) + 'EventController';
  let controllerClass = resolveClassName('EventConsumer\\' + controllerName, namespace, context, filePath);
  if (!controllerClass.startsWith('App\\')) controllerClass = 'App\\Http\\Controllers\\' + controllerClass;

  const routeQn = `route::${httpMethod}::${path}`;
  return {
    node: { type: 'Route', name: path, qualified_name: routeQn, file_path: filePath, start_line: closure.startPosition.row + 1, end_line: closure.endPosition.row + 1, metadata: { http_method: httpMethod.toUpperCase(), path, dynamic: true } },
    edge: { source: routeQn, target: `${controllerClass}::${method}`, type: 'ROUTE_HANDLES' },
  };
}
