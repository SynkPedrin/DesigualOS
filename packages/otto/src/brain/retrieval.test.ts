import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkBrainHealth,
  loadBrainIndex,
  retrieveRelevantKnowledge,
} from './retrieval.js';

/**
 * Fixture real em tmpdir: nada de mock de filesystem. O retrieval é código
 * de borda (IO + parse), então o teste exercita o caminho inteiro.
 */

let brainDir: string;

function writeDoc(relativePath: string, content: string): void {
  const absolutePath = join(brainDir, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, 'utf-8');
}

beforeEach(() => {
  brainDir = mkdtempSync(join(tmpdir(), 'otto-brain-'));

  writeDoc(
    'funil-de-demanda.md',
    `---
id: funil-demanda
titulo: "Funil de Demanda"
escopo: estrategia
dominio: marketing
intencoes: [funil, demanda, conversao]
---
# Funil de Demanda

Como estruturar funis de demanda para captar e converter leads em clientes.
`,
  );

  writeDoc(
    'arquitetura-de-marca.md',
    `---
titulo: "Arquitetura de Marca"
dominio: branding
intencoes: [marca, posicionamento]
---
# Arquitetura de Marca

Princípios de brand architecture e posicionamento de marca.
`,
  );

  writeDoc(
    join('STUDIO-BRAIN', '03_CREATIVE_SYSTEMS', 'sistemas.md'),
    `---
titulo: "Sistemas Criativos do Studio"
intencoes: [criativo, carrossel]
---
# Sistemas Criativos

## Direção de arte
Como o Studio monta carrosséis e peças visuais com direção de arte consistente.
`,
  );

  writeDoc('sem-frontmatter.md', '# Nota solta\n\nConteúdo sem frontmatter sobre métricas.');
  // Arquivo vazio: não pode entrar no índice.
  writeDoc('vazia.md', '');
});

afterEach(() => {
  rmSync(brainDir, { recursive: true, force: true });
});

describe('loadBrainIndex', () => {
  it('indexa *.md da raiz e STUDIO-BRAIN recursivo, ignorando arquivos vazios', () => {
    const index = loadBrainIndex(brainDir);
    expect(index.docs).toHaveLength(4);
    const paths = index.docs.map((doc) => doc.path);
    expect(paths).toContain('funil-de-demanda.md');
    expect(paths.some((path) => path.startsWith('STUDIO-BRAIN'))).toBe(true);
    expect(paths).not.toContain('vazia.md');
  });

  it('parseia frontmatter (titulo, intencoes, dominio)', () => {
    const index = loadBrainIndex(brainDir);
    const funil = index.docs.find((doc) => doc.path === 'funil-de-demanda.md');
    expect(funil?.titulo).toBe('Funil de Demanda');
    expect(funil?.frontmatter.intencoes).toEqual(['funil', 'demanda', 'conversao']);
    expect(funil?.frontmatter.dominio).toBe('marketing');
    expect(funil?.headings).toContain('Funil de Demanda');
  });

  it('extrai headings de docs sem frontmatter', () => {
    const index = loadBrainIndex(brainDir);
    const solta = index.docs.find((doc) => doc.path === 'sem-frontmatter.md');
    expect(solta?.headings).toContain('Nota solta');
  });

  it('BL-09: lê o frontmatter real do STUDIO-BRAIN (type/domain/topic + tags em bloco)', () => {
    writeFileSync(
      join(brainDir, 'STUDIO-BRAIN', 'doc-vocab-studio.md'),
      `---
type: guide
domain: generation
topic: Fidelidade Multi Referência
status: active
tags:
  - fidelidade
  - multi-referencia
  - flux
---
# Fidelidade Multi Referência

Conteúdo sobre fidelidade em pipelines Flux.
`,
      'utf-8',
    );
    // O cache do índice é por mtime: arquivo novo entra na leitura seguinte.
    const index = loadBrainIndex(brainDir);
    const doc = index.docs.find((d) => d.path === 'STUDIO-BRAIN/doc-vocab-studio.md');
    expect(doc?.frontmatter.dominio).toBe('generation');
    expect(doc?.titulo).toBe('Fidelidade Multi Referência');
    expect(doc?.frontmatter.intencoes).toEqual(expect.arrayContaining(['fidelidade', 'multi-referencia', 'flux']));
  });
});

describe('retrieveRelevantKnowledge', () => {
  it('retorna o doc certo pro briefing, com snippet', () => {
    const index = loadBrainIndex(brainDir);
    const results = retrieveRelevantKnowledge(index, 'preciso montar um funil de conversão de demanda', 3);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.doc.path).toBe('funil-de-demanda.md');
    expect(results[0]?.snippet.length).toBeGreaterThan(0);
  });

  it('casa termo sem acento com conteúdo acentuado', () => {
    const index = loadBrainIndex(brainDir);
    const results = retrieveRelevantKnowledge(index, 'estrategia de marca e posicionamento', 3);
    expect(results.map((entry) => entry.doc.path)).toContain('arquitetura-de-marca.md');
  });

  it('retorna vazio pra query sem termos relevantes', () => {
    const index = loadBrainIndex(brainDir);
    expect(retrieveRelevantKnowledge(index, 'a e o', 3)).toEqual([]);
  });
});

describe('retrieveRelevantKnowledge: parametros de profundidade', () => {
  it('aceita number como antes (compatibilidade dos chamadores antigos)', () => {
    const index = loadBrainIndex(brainDir);
    const positional = retrieveRelevantKnowledge(index, 'carrossel criativo', 1);
    const asOptions = retrieveRelevantKnowledge(index, 'carrossel criativo', { maxDocs: 1 });
    expect(positional).toEqual(asOptions);
    expect(positional).toHaveLength(1);
  });

  it('maxDocs limita quantos docs entram no prompt', () => {
    const index = loadBrainIndex(brainDir);
    expect(retrieveRelevantKnowledge(index, 'marca funil carrossel metricas', { maxDocs: 2 })).toHaveLength(2);
  });

  it('snippetLength encurta o trecho de cada doc', () => {
    const index = loadBrainIndex(brainDir);
    const long = retrieveRelevantKnowledge(index, 'funil de demanda conversao', { snippetLength: 400 });
    const short = retrieveRelevantKnowledge(index, 'funil de demanda conversao', { snippetLength: 40 });
    expect(short[0]?.doc.path).toBe(long[0]?.doc.path);
    expect(short[0]!.snippet.length).toBeLessThanOrEqual(40);
    expect(short[0]!.snippet.length).toBeLessThan(long[0]!.snippet.length);
  });

  it('includeStudioBrain=false tira o subvault do Studio da busca', () => {
    const index = loadBrainIndex(brainDir);
    const query = 'sistemas criativos de carrossel do studio';

    const withStudio = retrieveRelevantKnowledge(index, query, { includeStudioBrain: true });
    expect(withStudio.some((entry) => entry.doc.path.startsWith('STUDIO-BRAIN'))).toBe(true);

    const withoutStudio = retrieveRelevantKnowledge(index, query, { includeStudioBrain: false });
    expect(withoutStudio.some((entry) => entry.doc.path.startsWith('STUDIO-BRAIN'))).toBe(false);
  });

  it('o filtro de escopo nao mexe no indice: o cache segue com o vault inteiro', () => {
    const index = loadBrainIndex(brainDir);
    retrieveRelevantKnowledge(index, 'carrossel', { includeStudioBrain: false });
    // Um retrieval restrito não pode "sumir" com docs pro próximo turno.
    expect(loadBrainIndex(brainDir).docs).toHaveLength(4);
    expect(
      retrieveRelevantKnowledge(loadBrainIndex(brainDir), 'sistemas criativos carrossel', {
        includeStudioBrain: true,
      }).some((entry) => entry.doc.path.startsWith('STUDIO-BRAIN')),
    ).toBe(true);
  });

  it('default segue igual ao de antes (5 docs, snippet 400, vault inteiro)', () => {
    const index = loadBrainIndex(brainDir);
    expect(retrieveRelevantKnowledge(index, 'marca funil carrossel metricas')).toEqual(
      retrieveRelevantKnowledge(index, 'marca funil carrossel metricas', {
        maxDocs: 5,
        snippetLength: 400,
        includeStudioBrain: true,
      }),
    );
  });
});

describe('checkBrainHealth', () => {
  it('reporta ok com contagem de docs', () => {
    const health = checkBrainHealth(brainDir);
    expect(health.status).toBe('ok');
    expect(health.docCount).toBe(4);
  });

  it('detecta brain ausente', () => {
    const health = checkBrainHealth(join(brainDir, 'nao-existe'));
    expect(health.status).toBe('missing');
    expect(health.docCount).toBe(0);
  });

  it('detecta brain vazio', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'otto-brain-empty-'));
    try {
      const health = checkBrainHealth(emptyDir);
      expect(health.status).toBe('empty');
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('piso de relevancia (bug de producao 10/09/2026)', () => {
  it('tema EXTERNO ao vault nao puxa documento interno por palavra generica', () => {
    // O pedido real foi "copy para um carrossel de 5 slides sobre IA na China" e a resposta
    // veio com a rotina interna da agencia, porque "carrossel"/"automacao" casam em quase
    // todo documento do Brain. Com o piso de seletividade, o termo distintivo ("china") nao
    // casa em nada e o resto nao e suficiente pra justificar injecao.
    const index = loadBrainIndex(brainDir);
    const docs = retrieveRelevantKnowledge(index, 'inteligencia artificial na china mercado asiatico', { maxDocs: 5 });
    for (const d of docs) {
      // Se algo entrar, tem que ser por termo seletivo de verdade, nunca por palavra comum.
      expect(d.score).toBeGreaterThan(0);
    }
    // O caso que importa: nao pode devolver o vault inteiro so por palavra generica.
    expect(docs.length).toBeLessThan(index.docs.length);
  });

  it('consulta com topicos DISTINTOS do vault continua funcionando (regressao da 1a tentativa)', () => {
    // A primeira versao exigia 2+ termos casados por documento e zerava este caso, onde
    // cada documento cobre legitimamente UM topico.
    const index = loadBrainIndex(brainDir);
    expect(retrieveRelevantKnowledge(index, 'marca funil carrossel metricas', { maxDocs: 2 })).toHaveLength(2);
  });
});
