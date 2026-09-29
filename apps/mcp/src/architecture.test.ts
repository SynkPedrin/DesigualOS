import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * architecture.test.ts — a garantia que a virada de produto exige, travada em
 * código, não em revisão de PR.
 *
 * A missão do control plane é explícita: "nenhuma tool MCP de leitura
 * determinística pode depender do pipeline serial do Bento". O motivo é
 * concreto — o `bento-qa` (o nó que processa uma pergunta por vez, medido pelas
 * duas sessões que trabalharam nisto hoje) é o gargalo do produto ANTERIOR. Se
 * uma tool nova importar `callBento`, `@desigual-os/orchestrator` ou
 * `@desigual-os/agent-runtime` para fazer uma leitura, o control plane herda o
 * mesmo teto de concorrência que a missão pede para não herdar — e a bateria de
 * concorrência (scripts/aceite.mts) provaria isso tarde, com o servidor no ar,
 * em vez de agora, na hora de escrever a tool.
 *
 * Este teste varre TODO arquivo fonte de `apps/mcp` e falha se qualquer um
 * importar um caminho proibido. Ele é estático de propósito: não precisa
 * banco, não precisa rede, e roda em toda alteração.
 */

const SRC = new URL('.', import.meta.url).pathname;

/**
 * Pacotes que implementam ou orquestram o pipeline CONVERSACIONAL serial —
 * o "nó que responde perguntas" que a missão pede para não carregar para o
 * control plane. `mcp-domain` e `tool-gateway` NÃO estão aqui: são domínio
 * puro e adapter de integração, sem fila serial nenhuma.
 */
const PACOTES_PROIBIDOS = [
  '@desigual-os/orchestrator',
  '@desigual-os/agent-runtime',
  '@desigual-os/bento-core',
  '@desigual-os/router',
  '@desigual-os/openai-provider',
];

/** Símbolos específicos do caminho serial, para pegar até um import solto. */
const SIMBOLOS_PROIBIDOS = ['callBento', 'bento-qa', 'BENTO_QA_URL', 'runBentoOpenAiCore'];

function listarArquivosTs(dir: string): string[] {
  const resultado: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules' || nome === 'dist') continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) resultado.push(...listarArquivosTs(caminho));
    else if (nome.endsWith('.ts') && !nome.endsWith('.test.ts')) resultado.push(caminho);
  }
  return resultado;
}

describe('control plane — nenhuma tool depende do pipeline serial do Bento', () => {
  const arquivos = listarArquivosTs(SRC);

  it('há arquivos para varrer — um teste que varre nada não prova nada', () => {
    expect(arquivos.length).toBeGreaterThan(5);
  });

  for (const caminho of listarArquivosTs(SRC)) {
    const nomeRelativo = caminho.replace(SRC, '');
    it(`${nomeRelativo} não importa o pipeline conversacional`, () => {
      const conteudo = readFileSync(caminho, 'utf8');
      for (const pacote of PACOTES_PROIBIDOS) {
        expect(conteudo, `${nomeRelativo} importa "${pacote}" — isso reintroduz o gargalo serial que a missão pede pra não herdar`).not.toContain(pacote);
      }
      for (const simbolo of SIMBOLOS_PROIBIDOS) {
        expect(conteudo, `${nomeRelativo} referencia "${simbolo}" — caminho do bento-qa, o nó de uma pergunta por vez`).not.toContain(simbolo);
      }
    });
  }

  it('as dependências do package.json não incluem o pipeline serial', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
    for (const pacote of PACOTES_PROIBIDOS) {
      expect(Object.keys(pkg.dependencies), `package.json declara dependência de "${pacote}"`).not.toContain(pacote);
    }
  });

  it('DOCUMENTA o caminho real: leitura vai direto a tool-gateway/context-engine/banco', () => {
    // Não é asserção sobre arquivo — é o registro legível do que este teste prova.
    const caminhoReal = ['@desigual-os/tool-gateway', '@desigual-os/context-engine', '@desigual-os/database', '@desigual-os/mcp-domain'];
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> };
    for (const esperado of caminhoReal) {
      expect(Object.keys(pkg.dependencies), `esperava "${esperado}" nas dependências do MCP`).toContain(esperado);
    }
  });
});

/**
 * UM McpServer POR REQUISIÇÃO — a correção da race condition sob concorrência
 * (29/09/2026).
 *
 * O bug real, medido: `montarServidor()` chamado uma vez no boot, e cada
 * requisição chamando `server.connect(transport)` no MESMO objeto. Funcionava
 * em chamadas isoladas, quebrava sob chamadas rápidas em sequência — que é
 * exatamente o que quatro funcionários usando o MCP ao mesmo tempo produz.
 * Achado pela bateria de aceite rodando contra a URL pública, não por leitura
 * de código: uma race condition não aparece em revisão estática.
 */
describe('cada requisição ao /mcp usa um McpServer PRÓPRIO', () => {
  it('server.ts NÃO reusa uma instância de McpServer entre requisições', () => {
    const conteudo = readFileSync(join(SRC, 'server.ts'), 'utf8');
    // A instância de módulo (`const server = montarServidor()` no escopo
    // externo do handler POST /mcp) foi exatamente o bug. A instância correta
    // vive DENTRO do handler, uma por chamada.
    const dentroDoHandler = conteudo.includes('const server = montarServidorPorRequisicao();');
    expect(dentroDoHandler, 'o server precisa ser criado dentro do handler POST /mcp, um por requisição').toBe(true);
  });

  it('"trust proxy" está configurado — sem isto o rate limiter rejeita X-Forwarded-For do túnel', () => {
    const conteudo = readFileSync(join(SRC, 'server.ts'), 'utf8');
    expect(conteudo).toContain("app.set('trust proxy'");
  });
});
