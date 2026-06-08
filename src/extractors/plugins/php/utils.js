export function extractNamespace(rootNode) {
  for (let i = 0; i < rootNode.childCount; i++) {
    const child = rootNode.child(i);
    if (child.type === 'namespace_definition') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) return nameNode.text;
    }
  }
  return '';
}

export function qualify(namespace, name) {
  return namespace ? `${namespace}\\${name}` : name;
}

export function resolveClassName(name, namespace, context, filePath) {
  if (name.startsWith('\\')) return name.slice(1);
  if (context?.importMap) {
    const resolved = context.importMap.get(`${filePath}::${name}`);
    if (resolved) return resolved;
    const firstPart = name.split('\\')[0];
    const resolvedPrefix = context.importMap.get(`${filePath}::${firstPart}`);
    if (resolvedPrefix) return name.replace(firstPart, resolvedPrefix);
  }
  return qualify(namespace, name);
}

const PRIMITIVES = new Set(['string', 'int', 'float', 'bool', 'array', 'object', 'mixed', 'void', 'null', 'callable', 'iterable', 'never', 'true', 'false']);

export function isPrimitiveType(type) {
  return PRIMITIVES.has(type.toLowerCase());
}

export function extractVisibility(node) {
  for (const child of node.children) {
    if (child.type === 'visibility_modifier') return child.text;
  }
  return 'public';
}

export function hasModifier(node, modifier) {
  for (const child of node.children) {
    if (child.type === 'static_modifier' && modifier === 'static') return true;
    if (child.type === 'abstract_modifier' && modifier === 'abstract') return true;
    if (child.type === 'final_modifier' && modifier === 'final') return true;
  }
  return false;
}

export function extractParams(node) {
  const params = node.childForFieldName('parameters');
  if (!params) return [];
  return params.children
    .filter(c => c.type === 'simple_parameter' || c.type === 'property_promotion_parameter')
    .map(p => {
      const name = p.childForFieldName('name')?.text?.replace(/^\$/, '');
      const type = p.childForFieldName('type')?.text;
      return { name, type: type ?? null };
    });
}
