import { extractNamespace, resolveClassName } from '../php/utils.js';

export default {
  name: 'plugin:laravel:event-listener',
  types: [
    { type: 'LISTENS_TO', kind: 'edge', description: 'Listener handles an event' },
  ],
  fileFilter: (fp) => fp.endsWith('.php'),
  extract(filePath, content, tree, context) {
    const namespace = extractNamespace(tree.rootNode);
    return { nodes: [], edges: collectEventListenerMappings(tree.rootNode, namespace, filePath, context) };
  },
};

function collectEventListenerMappings(rootNode, namespace, filePath, context) {
  const edges = [];
  walkForListenProperty(rootNode, namespace, filePath, context, edges);
  return edges;
}

function walkForListenProperty(node, namespace, filePath, context, edges) {
  if (node.type === 'namespace_definition') {
    const nameNode = node.childForFieldName('name');
    namespace = nameNode ? nameNode.text : namespace;
  }

  if (node.type === 'property_declaration') {
    const nameNode = findPropertyName(node);
    if (nameNode === 'listen') {
      const value = findPropertyValue(node);
      if (value?.type === 'array_creation_expression') {
        parseListenArray(value, namespace, filePath, context, edges);
      }
    }
  }

  for (let i = 0; i < node.childCount; i++) {
    walkForListenProperty(node.child(i), namespace, filePath, context, edges);
  }
}

function findPropertyName(propertyDecl) {
  for (let i = 0; i < propertyDecl.childCount; i++) {
    const child = propertyDecl.child(i);
    if (child.type === 'property_element') {
      const varNode = child.childForFieldName('name') ?? child.children?.find(c => c.type === 'variable_name');
      const name = varNode?.text?.replace(/^\$/, '');
      if (name) return name;
    }
  }
  return null;
}

function findPropertyValue(propertyDecl) {
  for (let i = 0; i < propertyDecl.childCount; i++) {
    const child = propertyDecl.child(i);
    if (child.type === 'property_element') {
      for (let j = 0; j < child.childCount; j++) {
        if (child.child(j).type === 'array_creation_expression') return child.child(j);
      }
    }
  }
  return null;
}

function parseListenArray(arrayNode, namespace, filePath, context, edges) {
  for (let i = 0; i < arrayNode.childCount; i++) {
    const child = arrayNode.child(i);
    if (child.type === 'array_element_initializer') {
      const mapping = parseEventListenerPair(child, namespace, filePath, context);
      if (mapping) edges.push(...mapping);
    }
  }
}

function parseEventListenerPair(elementNode, namespace, filePath, context) {
  let eventClass = null;
  let listenerClasses = [];

  for (let i = 0; i < elementNode.childCount; i++) {
    const child = elementNode.child(i);
    if (child.type === 'class_constant_access_expression' && !eventClass) {
      eventClass = resolveClassConstant(child, namespace, context, filePath);
    } else if (child.type === 'array_creation_expression') {
      listenerClasses = extractClassConstants(child, namespace, context, filePath);
    }
  }

  if (!eventClass || listenerClasses.length === 0) return null;

  return listenerClasses.map(listener => ({
    source: listener,
    target: eventClass,
    type: 'LISTENS_TO',
    metadata: { listener, event: eventClass },
  }));
}

function resolveClassConstant(node, namespace, context, filePath) {
  const cls = node.childForFieldName('class') ?? node.children?.find(c => c.type === 'name' || c.type === 'qualified_name');
  return cls ? resolveClassName(cls.text, namespace, context, filePath) : null;
}

function extractClassConstants(arrayNode, namespace, context, filePath) {
  const classes = [];
  for (let i = 0; i < arrayNode.childCount; i++) {
    const child = arrayNode.child(i);
    if (child.type === 'class_constant_access_expression') {
      const cls = resolveClassConstant(child, namespace, context, filePath);
      if (cls) classes.push(cls);
    } else if (child.type === 'array_element_initializer') {
      for (let j = 0; j < child.childCount; j++) {
        const inner = child.child(j);
        if (inner.type === 'class_constant_access_expression') {
          const cls = resolveClassConstant(inner, namespace, context, filePath);
          if (cls) classes.push(cls);
        }
      }
    }
  }
  return classes;
}
