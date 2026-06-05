export default {
  name: 'core:file',
  types: [
    { type: 'File', kind: 'node', description: 'Source file' },
    { type: 'DEFINES', kind: 'edge', description: 'File defines a symbol' },
  ],
  fileFilter: () => true,
  extract(filePath, content, tree) {
    const nodes = [{ type: 'File', name: filePath.split('/').pop(), qualified_name: filePath, file_path: filePath, start_line: 1, end_line: content.split('\n').length }];
    return { nodes, edges: [] };
  },
};
