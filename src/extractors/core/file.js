export default {
  name: 'core:file',
  types: [
    { type: 'Project', kind: 'node', description: 'Indexed project' },
    { type: 'File', kind: 'node', description: 'Source file' },
    { type: 'CONTAINS_FILE', kind: 'edge', description: 'Project contains a file' },
    { type: 'DEFINES', kind: 'edge', description: 'File defines a symbol' },
  ],
  fileFilter: () => true,
  extract(filePath, content, tree, context) {
    const nodes = [{ type: 'File', name: filePath.split('/').pop(), qualified_name: filePath, file_path: filePath, start_line: 1, end_line: content.split('\n').length }];
    const edges = [];

    if (context?.project) {
      edges.push({ source: `project::${context.project}`, target: filePath, type: 'CONTAINS_FILE' });
    }

    return { nodes, edges };
  },
};
