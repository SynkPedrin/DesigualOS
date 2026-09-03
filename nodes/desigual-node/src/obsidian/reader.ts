import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

export interface VaultSearchResult {
  path: string;
  snippet: string;
}

/**
 * Busca local sob demanda no vault Obsidian deste Mac (regra de ouro 1:
 * nunca sincronizar o vault pro servidor central). Só recorta o que bate
 * com a query e devolve o trecho, nunca o arquivo inteiro nem o vault todo.
 */
export async function searchVault(vaultPath: string, query: string, maxResults = 5): Promise<VaultSearchResult[]> {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 2);

  if (terms.length === 0) {
    return [];
  }

  const results: VaultSearchResult[] = [];
  for await (const filePath of walkMarkdownFiles(vaultPath)) {
    if (results.length >= maxResults) break;

    const content = await readFile(filePath, 'utf8');
    const lowerContent = content.toLowerCase();
    const matchedTerm = terms.find((term) => lowerContent.includes(term));
    if (!matchedTerm) continue;

    const matchIndex = lowerContent.indexOf(matchedTerm);
    const start = Math.max(0, matchIndex - 120);
    const end = Math.min(content.length, matchIndex + 240);

    results.push({
      path: relative(vaultPath, filePath),
      snippet: content.slice(start, end).trim(),
    });
  }

  return results;
}

async function* walkMarkdownFiles(dir: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMarkdownFiles(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield fullPath;
    }
  }
}
