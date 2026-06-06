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
    const nodes = [];
    const edges = [];
    collectRoutes(tree.rootNode, namespace, filePath, context, nodes, edges, null);
    return { nodes, edges };
  },
};

function extractStringValue(node) {
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
  if (stringArg && groupController) {
    if (stringArg.includes('@')) {
      const [cls, method] = stringArg.split('@');
      return { controllerClass: resolveClassName(cls, namespace, context, filePath), method };
    }
    return { controllerClass: groupController, method: stringArg };
  }

  if (stringArg && stringArg.includes('@')) {
    const [cls, method] = stringArg.split('@');
    return { controllerClass: resolveClassName(cls, namespace, context, filePath), method };
  }

  return { controllerClass: null, method: null };
}

function makeRoute(httpMethod, path, controllerClass, method, filePath, node) {
  const routeQn = `route::${httpMethod}::${path}`;
  return {
    node: { type: 'Route', name: path, qualified_name: routeQn, file_path: filePath, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1, metadata: { http_method: httpMethod.toUpperCase(), path } },
    edge: { source: routeQn, target: `${controllerClass}::${method ?? '__invoke'}`, type: 'ROUTE_HANDLES' },
  };
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

function extractGroupController(node, namespace, context, filePath) {
  if (node.type !== 'scoped_call_expression' && node.type !== 'member_call_expression') return null;
  const method = node.childForFieldName('name')?.text;
  if (method === 'controller') {
    const args = getArgs(node);
    const classConst = findInArgs(args, 'class_constant_access_expression');
    if (classConst) return extractClassFromNode(classConst, namespace, context, filePath);
  }
  const object = node.childForFieldName('object');
  if (object) return extractGroupController(object, namespace, context, filePath);
  return null;
}

function collectRoutes(node, namespace, filePath, context, nodes, edges, groupController) {
  if (node.type === 'namespace_definition') {
    const nameNode = node.childForFieldName('name');
    namespace = nameNode ? nameNode.text : namespace;
  }

  if (isRouteCall(node)) {
    const method = node.childForFieldName('name')?.text;
    const args = getArgs(node);

    if (HTTP_METHODS.has(method)) {
      const path = extractStringValue(args[0]);
      if (path) {
        const { controllerClass, method: handlerMethod } = resolveHandler(args, namespace, context, filePath, groupController);
        if (controllerClass) {
          const route = makeRoute(method, path, controllerClass, handlerMethod, filePath, node);
          nodes.push(route.node);
          edges.push(route.edge);
        }
      }
    } else if (RESOURCE_METHODS.has(method)) {
      const path = extractStringValue(args[0]);
      const classConst = findInArgs(args.slice(1), 'class_constant_access_expression');
      if (path && classConst) {
        const controllerClass = extractClassFromNode(classConst, namespace, context, filePath);
        if (controllerClass) {
          for (const r of extractResourceRoutes(method, path, controllerClass, filePath, node)) {
            nodes.push(r.node);
            edges.push(r.edge);
          }
        }
      }
    } else if (method === 'group' || method === 'controller') {
      const controller = extractGroupController(node, namespace, context, filePath) ?? groupController;
      const closure = findClosure(node);
      if (closure) {
        collectRoutes(closure, namespace, filePath, context, nodes, edges, controller);
        return;
      }
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    collectRoutes(node.child(i), namespace, filePath, context, nodes, edges, groupController);
  }
}

function findClosure(node) {
  const args = node.childForFieldName('arguments');
  if (!args) return null;
  for (let i = 0; i < args.childCount; i++) {
    const child = args.child(i);
    if (child.type === 'anonymous_function_creation_expression' || child.type === 'anonymous_function') return child;
    if (child.type === 'argument') {
      for (let j = 0; j < child.childCount; j++) {
        const t = child.child(j).type;
        if (t === 'anonymous_function_creation_expression' || t === 'anonymous_function') return child.child(j);
      }
    }
  }
  return null;
}
