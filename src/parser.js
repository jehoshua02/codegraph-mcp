import TreeSitter from 'web-tree-sitter';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

let initialized = false;
const languages = new Map();

async function init() {
  if (initialized) return;
  await TreeSitter.init();
  initialized = true;
}

async function getLanguage(language) {
  if (languages.has(language)) return languages.get(language);

  await init();

  if (language === 'php') {
    const wasmPaths = [
      join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'tree-sitter-php', 'tree-sitter-php.wasm'),
      join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'tree-sitter-php', 'tree-sitter-php_php.wasm'),
    ];
    let wasmPath = wasmPaths.find(p => existsSync(p));
    if (!wasmPath) throw new Error('tree-sitter-php WASM not found at: ' + wasmPaths.join(', '));
    const lang = await TreeSitter.Language.load(wasmPath);
    languages.set(language, lang);
    return lang;
  }

  throw new Error(`Unsupported language: ${language}`);
}

let parserInstance = null;

export async function parse(content, language) {
  const lang = await getLanguage(language);
  if (!parserInstance) {
    await init();
    parserInstance = new TreeSitter();
  }
  parserInstance.setLanguage(lang);
  return parserInstance.parse(content);
}

export function languageForFile(filePath) {
  if (filePath.endsWith('.php')) return 'php';
  return null;
}
