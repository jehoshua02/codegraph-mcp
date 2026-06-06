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
    collectRoutes(tree.rootNode, namespace, filePath, context, nodes, edges);
    return { nodes, edges };
  },
};

function extractRouteArgs(node) {
  const args = node.childForFieldName('arguments');
  if (!args) return [];
  return args.children.filter(c => c.type === 'argument' || c.type === 'string' || c.type === 'array_creation_expression' || c.type === 'class_constant_access_expression' || c.type === 'encapsed_string');
}

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

function findArrayInArgs(args) {
  for (const arg of args) {
    if (arg.type === 'array_creation_expression') return arg;
    if (arg.type === 'argument') {
      for (let i = 0; i < arg.childCount; i++) {
        if (arg.child(i).type === 'array_creation_expression') return arg.child(i);
      }
    }
  }
  return null;
}

function findClassConstantInArgs(args) {
  for (const arg of args) {
    if (arg.type === 'class_constant_access_expression') return arg;
    if (arg.type === 'argument') {
      for (let i = 0; i < arg.childCount; i++) {
        if (arg.child(i).type === 'class_constant_access_expression') return arg.child(i);
      }
    }
  }
  return null;
}

function parseControllerArray(arrayNode, namespace, context, filePath) {
  const elements = [];
  for (let i = 0; i < arrayNode.childCount; i++) {
    const child = arrayNode.child(i);
    if (child.type === 'array_element_initializer') {
      for (let j = 0; j < child.childCount; j++) {
        elements.push(child.child(j));
      }
    } else {
      elements.push(child);
    }
  }

  let controllerClass = null;
  let method = null;

  for (const el of elements) {
    if (el.type === 'class_constant_access_expression') {
      const cls = el.childForFieldName('class') ?? el.children.find(c => c.type === 'name' || c.type === 'qualified_name');
      if (cls) controllerClass = resolveClassName(cls.text, namespace, context, filePath);
    } else if (el.type === 'string') {
      method = el.text.replace(/^['"]|['"]$/g, '');
    }
  }

  return { controllerClass, method };
}

function extractRoute(node, namespace, filePath, context) {
  if (node.type !== 'scoped_call_expression' && node.type !== 'member_call_expression') return null;

  const methodNode = node.childForFieldName('name');
  const methodName = methodNode?.text;
  if (!methodName) return null;

  const isHttpMethod = HTTP_METHODS.has(methodName);
  const isResource = RESOURCE_METHODS.has(methodName);

  if (!isHttpMethod && !isResource) return null;

  const scope = node.childForFieldName('scope') ?? node.childForFieldName('object');
  if (!scope) return null;
  const scopeText = scope.text;
  if (scopeText !== 'Route' && !scopeText.endsWith('Route')) return null;

  const args = extractRouteArgs(node);
  const path = extractStringValue(args[0]);

  if (isResource && path) {
    const classConst = findClassConstantInArgs(args.slice(1));
    if (!classConst) return null;
    const cls = classConst.childForFieldName('class') ?? classConst.children.find(c => c.type === 'name' || c.type === 'qualified_name');
    if (!cls) return null;
    const controllerClass = resolveClassName(cls.text, namespace, context, filePath);

    const resourceMethods = methodName === 'apiResource'
      ? ['index', 'store', 'show', 'update', 'destroy']
      : ['index', 'create', 'store', 'show', 'edit', 'update', 'destroy'];

    const nodes = [];
    const edges = [];
    for (const m of resourceMethods) {
      const routeQn = `route::${methodName === 'apiResource' ? 'api.' : ''}${path}.${m}`;
      nodes.push({ type: 'Route', name: `${path}.${m}`, qualified_name: routeQn, file_path: filePath, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1, metadata: { http_method: m === 'store' ? 'POST' : m === 'update' ? 'PUT' : m === 'destroy' ? 'DELETE' : 'GET', path } });
      edges.push({ source: routeQn, target: `${controllerClass}::${m}`, type: 'ROUTE_HANDLES' });
    }
    return { nodes, edges };
  }

  if (isHttpMethod && path) {
    const handlerArray = findArrayInArgs(args.slice(1));
    const classConst = findClassConstantInArgs(args.slice(1));

    let controllerClass = null;
    let method = null;

    if (handlerArray) {
      const parsed = parseControllerArray(handlerArray, namespace, context, filePath);
      controllerClass = parsed.controllerClass;
      method = parsed.method;
    } else if (classConst) {
      const cls = classConst.childForFieldName('class') ?? classConst.children.find(c => c.type === 'name' || c.type === 'qualified_name');
      if (cls) {
        controllerClass = resolveClassName(cls.text, namespace, context, filePath);
        method = '__invoke';
      }
    }

    if (!controllerClass) return null;

    const routeQn = `route::${methodName}::${path}`;
    return {
      nodes: [{ type: 'Route', name: path, qualified_name: routeQn, file_path: filePath, start_line: node.startPosition.row + 1, end_line: node.endPosition.row + 1, metadata: { http_method: methodName.toUpperCase(), path } }],
      edges: [{ source: routeQn, target: `${controllerClass}::${method ?? '__invoke'}`, type: 'ROUTE_HANDLES' }],
    };
  }

  return null;
}

function collectRoutes(node, namespace, filePath, context, nodes, edges) {
  if (node.type === 'namespace_definition') {
    const nameNode = node.childForFieldName('name');
    namespace = nameNode ? nameNode.text : namespace;
  }

  const result = extractRoute(node, namespace, filePath, context);
  if (result) {
    nodes.push(...result.nodes);
    edges.push(...result.edges);
  }

  for (let i = 0; i < node.childCount; i++) {
    collectRoutes(node.child(i), namespace, filePath, context, nodes, edges);
  }
}
