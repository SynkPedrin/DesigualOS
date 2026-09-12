/**
 * Suíte de aceite dos agentes (Onda 0, item 0.4).
 *
 * Transforma os critérios de aceite da auditoria (seção 4) em casos
 * executáveis com asserções ESTRUTURAIS, nunca comparação de texto exato.
 * Casos que dependem de capacidade inexistente entram como pendente(BL-XX) e
 * passam a rodar quando a onda correspondente entregar.
 *
 * Entrada: um diretório de resultados no formato do baseline-comportamento
 * (um JSON por caso, com trocas[].resposta e trocas[].fontes). Por padrão usa
 * o artifacts/baseline-comportamento-<data> mais recente.
 *
 * Uso:
 *   pnpm --filter @desigual-os/api exec tsx ../../scripts/qa/aceite-agentes.ts [--dir <pasta>] [--strict]
 * Sem --strict sai 0 mesmo com casos vermelhos (modo medição de baseline).
 * Com --strict sai 1 se qualquer caso ativo falhar (modo portão de onda).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

interface Troca {
  pergunta?: string;
  resposta?: string;
  fontes?: unknown;
  status?: string;
}
interface Artefato {
  id: string;
  trocas?: Troca[];
  status?: string;
}
interface Contexto {
  resposta: string; // última resposta do caso
  trocas: Troca[];
  fontes: unknown;
}

type Assercao = (ctx: Contexto) => { ok: boolean; detalhe: string };

// ---------- asserções estruturais ----------

const temNumero: Assercao = ({ resposta }) => ({
  ok: /\d/.test(resposta),
  detalhe: 'resposta contém pelo menos um número (dado real, não genericidade)',
});

const temFonte: Assercao = ({ resposta, fontes }) => ({
  ok: /📎|fonte:/i.test(resposta) || (Array.isArray(fontes) && fontes.length > 0),
  detalhe: 'resposta cita fonte (bloco 📎/fonte: ou sources no execution_step)',
});

const admiteLacuna: Assercao = ({ resposta }) => ({
  ok: /não encontrei|não achei|não tenho|não consta|não está no vault/i.test(resposta),
  detalhe: 'admite explicitamente a lacuna em vez de encher com texto plausível',
});

const propoeProximoPasso: Assercao = ({ resposta }) => ({
  ok: resposta.includes('?') || /próximo passo|posso adiantar|quer que eu|sugiro|recomendo/i.test(resposta),
  detalhe: 'fecha com próximo passo ou recomendação, não com ponto final morto',
});

const temRaciocinioRotulado: Assercao = ({ resposta }) => ({
  ok: /minha leitura/i.test(resposta),
  detalhe: 'camada de raciocínio do agente rotulada ("Minha leitura:"), separada dos fatos',
});

const naoGenerica: Assercao = ({ resposta }) => ({
  ok: resposta.length > 200 && !/tente reformular|não consegui processar/i.test(resposta),
  detalhe: 'resposta tem substância (não é fallback enlatado)',
});

const semUrlInventada: Assercao = ({ resposta, fontes }) => {
  const urls = resposta.match(/https?:\/\/[^\s)]+/g) ?? [];
  const fontesTxt = JSON.stringify(fontes ?? []);
  const inventadas = urls.filter((u) => !fontesTxt.includes(u));
  return {
    ok: inventadas.length === 0,
    detalhe: inventadas.length === 0 ? 'toda URL citada veio de ferramenta/fonte registrada' : `URL sem origem em ferramenta: ${inventadas.join(', ')}`,
  };
};

const fioDaConversa: Assercao = ({ trocas }) => {
  const ultima = trocas[trocas.length - 1]?.resposta ?? '';
  return {
    ok: ultima.length > 0 && !/sobre o quê|qual cliente|do que você|não entendi a que/i.test(ultima),
    detalhe: 'o follow-up é respondido com o fio da pergunta anterior, sem pedir recontextualização',
  };
};

const umaPerguntaSo: Assercao = ({ resposta }) => ({
  ok: (resposta.match(/\?/g) ?? []).length <= 1,
  detalhe: 'no máximo uma pergunta por mensagem',
});

const semPrecoNaoSolicitado: Assercao = ({ resposta }) => ({
  ok: !/R\$\s?\d/.test(resposta),
  detalhe: 'não joga preço antes do diagnóstico',
});

const naoCobrancaVazia: Assercao = ({ resposta }) => ({
  ok: !/viu minha mensagem|conseguiu ver|me retorna/i.test(resposta),
  detalhe: 'follow-up traz valor novo, não cobrança vazia',
});

const mencionaHandoff: Assercao = ({ resposta }) => ({
  ok: /handoff|passo para|repass|humano|resumo do lead|alguém do time|pessoa/i.test(resposta),
  detalhe: 'sinal de compra vira handoff com resumo, não tentativa de fechar sozinha',
});

const identificaEstagio: Assercao = ({ resposta }) => ({
  ok: /estágio|frio|morno|quente|objeção|diagnóstico|follow/i.test(resposta),
  detalhe: 'diagnóstico nomeia o estágio da conversa',
});

const exigeAprovacaoHumana: Assercao = ({ resposta }) => ({
  ok: /aprova|confirma|autoriz/i.test(resposta),
  detalhe: 'ação sensível exige confirmação humana antes',
});

const apontaJarbasSemExecutar: Assercao = ({ resposta }) => ({
  ok: /jarbas/i.test(resposta) && !/ajustei|alterei|mexi no orçamento/i.test(resposta),
  detalhe: 'Meta Ads é recusado e apontado pro Jarbas, sem executar nada',
});

const entregaTrabalhoSemParalisia: Assercao = ({ resposta }) => ({
  ok: resposta.length > 300 && (resposta.match(/\?/g) ?? []).length <= 1,
  detalhe: 'entrega o trabalho (não devolve só pergunta); suposição declarada vale, pergunta solitária não',
});

const temVereditoEDirecao: Assercao = ({ resposta }) => ({
  ok: /aprova|reprov|mata|ajust/i.test(resposta) && resposta.length > 200,
  detalhe: 'revisão tem veredito com argumento e direção concreta',
});

const honestoSemMaterial: Assercao = ({ resposta }) => ({
  ok: /não recebi|não tenho|não consigo|ainda não|não chegou/i.test(resposta),
  detalhe: 'sem material real no turno, admite em vez de inventar peça',
});

const semJargaoInfra: Assercao = ({ resposta }) => ({
  ok: !/servidor|deploy|banco de dados|endpoint|api rest/i.test(resposta),
  detalhe: 'pergunta institucional respondida sem jargão de infraestrutura',
});

const confirmaCriacaoDeTask: Assercao = ({ resposta }) => ({
  ok: /criada|registrada|task criada|tarefa criada/i.test(resposta),
  detalhe: 'a task é criada de verdade e confirmada (hoje impossível no chat, BL-15)',
});

// ---------- registro de casos (auditoria, seção 4) ----------

interface CasoAceite {
  id: string;
  agente: string;
  criterio: string;
  assercoes: Array<[string, Assercao]>;
  pendente?: string[];
}

const CASOS: CasoAceite[] = [
  { id: 'b1', agente: 'bento', criterio: 'visão macro com priorização', assercoes: [['temNumero', temNumero], ['propoeProximoPasso', propoeProximoPasso]] },
  { id: 'b1-prompt', agente: 'bento', criterio: 'raciocínio rotulado (depende do prompt novo, BL-07)', assercoes: [['temRaciocinioRotulado', temRaciocinioRotulado]], pendente: ['BL-07'] },
  { id: 'b2', agente: 'bento', criterio: 'criar task com prazo e prioridade', assercoes: [['confirmaCriacaoDeTask', confirmaCriacaoDeTask]] },
  { id: 'b3', agente: 'bento', criterio: 'editar task (status, responsável)', assercoes: [], pendente: ['BL-01'] },
  { id: 'b4', agente: 'bento', criterio: 'anexo interpretado e subido na task', assercoes: [], pendente: ['BL-05', 'BL-06'] },
  { id: 'b5', agente: 'bento', criterio: 'follow-up com fio de conversa', assercoes: [['fioDaConversa', fioDaConversa]] },
  { id: 'b6', agente: 'bento', criterio: 'pesquisa web sem URL inventada', assercoes: [['semUrlInventada', semUrlInventada]] },
  { id: 'b7', agente: 'bento', criterio: 'institucional com fonte, sem jargão', assercoes: [['temFonte', temFonte], ['semJargaoInfra', semJargaoInfra]] },
  { id: 'b8', agente: 'bento', criterio: 'lacuna declarada + o que existe próximo + sugestão', assercoes: [['admiteLacuna', admiteLacuna], ['propoeProximoPasso', propoeProximoPasso]] },
  { id: 's1', agente: 'suzy', criterio: 'lead frio: uma pergunta de diagnóstico, sem preço', assercoes: [['umaPerguntaSo', umaPerguntaSo], ['semPrecoNaoSolicitado', semPrecoNaoSolicitado]] },
  { id: 's2', agente: 'suzy', criterio: 'objeção de preço: entender a raiz', assercoes: [['naoGenerica', naoGenerica]] },
  { id: 's3', agente: 'suzy', criterio: 'follow-up com valor novo', assercoes: [['naoCobrancaVazia', naoCobrancaVazia], ['propoeProximoPasso', propoeProximoPasso]] },
  { id: 's4', agente: 'suzy', criterio: 'sinal de compra vira handoff', assercoes: [['mencionaHandoff', mencionaHandoff]] },
  { id: 's5', agente: 'suzy', criterio: 'diagnóstico de conversa por estágio', assercoes: [['identificaEstagio', identificaEstagio], ['propoeProximoPasso', propoeProximoPasso]] },
  { id: 's6', agente: 'suzy', criterio: 'Instagram só com confirmação humana', assercoes: [['exigeAprovacaoHumana', exigeAprovacaoHumana]] },
  { id: 's7', agente: 'suzy', criterio: 'Meta Ads é do Jarbas', assercoes: [['apontaJarbasSemExecutar', apontaJarbasSemExecutar]] },
  { id: 'o1', agente: 'otto', criterio: 'análise e engenharia de prompt', assercoes: [['naoGenerica', naoGenerica]] },
  { id: 'o2', agente: 'otto', criterio: 'roteiro sem etapa declarada, sem paralisia de funil', assercoes: [['entregaTrabalhoSemParalisia', entregaTrabalhoSemParalisia]] },
  { id: 'o3', agente: 'otto', criterio: 'revisão com veredito e direção', assercoes: [['temVereditoEDirecao', temVereditoEDirecao]] },
  { id: 'o4', agente: 'otto', criterio: 'honestidade sem material real', assercoes: [['honestoSemMaterial', honestoSemMaterial]] },
  { id: 'o5', agente: 'otto', criterio: 'carrossel dentro do timeout (efeito colateral Studio, BL-13)', assercoes: [], pendente: ['BL-13'] },
  { id: 'o6', agente: 'otto', criterio: 'dois jobs simultâneos completam (estrutural, BL-14)', assercoes: [], pendente: ['BL-14'] },
  { id: 'o7', agente: 'otto', criterio: 'seed inalcançável: admite ou entrega real (BL de dado ausente)', assercoes: [['honestoSemMaterial', honestoSemMaterial]] },
];

// ---------- runner ----------

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const dirArg = args.find((a) => a.startsWith('--dir='))?.slice(6) ?? (args[args.indexOf('--dir') + 1] || undefined);

let dir = dirArg;
if (!dir) {
  const candidatos = readdirSync(resolve(REPO, 'artifacts'))
    .filter((d) => d.startsWith('baseline-comportamento-'))
    .sort();
  dir = candidatos.at(-1) ? resolve(REPO, 'artifacts', candidatos.at(-1)!) : undefined;
}
if (!dir || !existsSync(dir)) {
  console.error('BLOQUEADO: nenhum diretório de resultados encontrado. Rode baseline-comportamento.ts antes (ou aponte --dir).');
  process.exit(1);
}

console.log(`Suíte de aceite estrutural sobre ${dir}\n`);

let ativos = 0, verdes = 0, vermelhos = 0, pendentes = 0;

for (const caso of CASOS) {
  if (caso.pendente) {
    pendentes++;
    console.log(`[PENDENTE] ${caso.id} (${caso.agente}) ${caso.criterio} :: aguardando ${caso.pendente.join(', ')}`);
    continue;
  }
  ativos++;
  const arquivo = resolve(dir, `${caso.id}.json`);
  if (!existsSync(arquivo)) {
    vermelhos++;
    console.log(`[FAIL] ${caso.id} (${caso.agente}) ${caso.criterio} :: artefato ausente (${caso.id}.json)`);
    continue;
  }
  const artefato = JSON.parse(readFileSync(arquivo, 'utf8')) as Artefato;
  const trocas = artefato.trocas ?? [];
  const ultima = trocas[trocas.length - 1] ?? {};
  const ctx: Contexto = { resposta: ultima.resposta ?? '', trocas, fontes: ultima.fontes };
  if (ultima.status && ultima.status !== 'completed') {
    vermelhos++;
    console.log(`[FAIL] ${caso.id} (${caso.agente}) ${caso.criterio} :: execução ${ultima.status}`);
    continue;
  }
  const falhas = caso.assercoes
    .map(([nome, fn]) => ({ nome, r: fn(ctx) }))
    .filter((a) => !a.r.ok);
  if (falhas.length === 0) {
    verdes++;
    console.log(`[PASS] ${caso.id} (${caso.agente}) ${caso.criterio}`);
  } else {
    vermelhos++;
    console.log(`[FAIL] ${caso.id} (${caso.agente}) ${caso.criterio}`);
    for (const f of falhas) console.log(`       ${f.nome}: ${f.r.detalhe}`);
  }
}

console.log(`\nPLACAR: ${verdes}/${ativos} ativos verdes, ${vermelhos} vermelhos, ${pendentes} pendentes de capacidade.`);
if (strict && vermelhos > 0) process.exit(1);
