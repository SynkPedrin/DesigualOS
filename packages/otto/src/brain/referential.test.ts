import { describe, expect, it } from 'vitest';
import { classificarTurno, itensDaLista, resolverReferente } from './referential';
import { documentoPermitido, donoDoDocumento, retrieveRelevantKnowledge, type BrainIndex, type BrainDoc } from './retrieval';
import { CONTEXT_BLOCK_MARKER } from './depth';

/**
 * Regressão do bloqueador final (frontend publicado, 18/09/2026): o Otto
 * entregou três títulos e, no turno seguinte, respondeu "as fontes recuperadas
 * são fragmentadas" e passou a descrever o tom de voz da APAE — outro cliente.
 */

const TRES_TITULOS = `Otto: 1 O paciente esquece que está na clínica
2 O fim da burocracia no primeiro contato
3 Clínica moderna que ainda sabe ouvir`;

const DIALOGO = `CONVERSA RECENTE (para resolver referências; não é fonte de fato):
Usuário: Me dá 3 títulos.
${TRES_TITULOS}`;

describe('referential_second_resolves_second_item', () => {
  it('"me explica o segundo" resolve o item 2 e NÃO chama o vault', () => {
    const t = classificarTurno('me explica o segundo.', true);
    expect(t.classe).toBe('REFERENCIAL');
    expect(t.ordinal).toBe(2);
    expect(t.precisaVault).toBe(false);
    expect(resolverReferente(DIALOGO, t)).toContain('O fim da burocracia no primeiro contato');
  });

  it('referential_first_resolves_first_item', () => {
    const t = classificarTurno('agora usa o primeiro', true);
    expect(t.ordinal).toBe(1);
    expect(resolverReferente(DIALOGO, t)).toContain('O paciente esquece que está na clínica');
  });

  it('o terceiro também', () => {
    const t = classificarTurno('pega o terceiro e transforma em legenda', true);
    expect(resolverReferente(DIALOGO, t)).toContain('Clínica moderna que ainda sabe ouvir');
  });
});

describe('itensDaLista aceita os formatos que o Otto realmente escreve', () => {
  it.each([
    ['numerado com ponto', 'Otto: 1. Alfa\n2. Beta\n3. Gama'],
    ['numerado sem ponto', 'Otto: 1 Alfa\n2 Beta\n3 Gama'],
    ['cabeçalho Post N', 'Otto:\nPost 1\nAlfa\n\nPost 2\nBeta\n\nPost 3\nGama'],
    ['cabeçalho Título N', 'Otto:\nTítulo 1:\nAlfa\n\nTítulo 2:\nBeta\n\nTítulo 3:\nGama'],
  ])('%s', (_nome, texto) => {
    expect(itensDaLista(texto)[1]).toBe('Beta');
  });
});

describe('referential_previous_version / feedback_uses_previous_artifact', () => {
  it.each(['essa versão ficou boa', 'faz essa menor', 'tá com cara de IA', 'muda só o final', 'faz de outro jeito'])(
    '%s -> trabalha o artefato atual, sem vault',
    (m) => {
      const t = classificarTurno(m, true);
      expect(t.precisaVault).toBe(false);
      expect(resolverReferente(DIALOGO, t)).toBeTruthy();
    },
  );

  it('client_version_uses_current_artifact', () => {
    const t = classificarTurno('uma versão pro cliente', true);
    expect(resolverReferente(DIALOGO, t)).toBeTruthy();
  });
});

describe('referential_request_can_use_vault_if_fact_needed', () => {
  it('pedido referencial QUE PEDE FATO ainda consulta o vault', () => {
    const t = classificarTurno('me explica o segundo à luz do posicionamento histórico da marca', true);
    expect(t.classe).toBe('REFERENCIAL');
    expect(t.precisaVault).toBe(true);
  });

  it('pergunta operacional legítima não é bloqueada', () => {
    const t = classificarTurno('qual era o prazo da campanha no ClickUp?', true);
    expect(t.precisaVault).toBe(true);
  });

  it('pedido NOVO continua usando o vault', () => {
    const t = classificarTurno('me dá 3 títulos para um post sobre check-up anual', true);
    expect(t.classe).toBe('PEDIDO_NOVO');
    expect(t.precisaVault).toBe(true);
  });

  it('sem diálogo recente, tudo é pedido novo', () => {
    const t = classificarTurno('me explica o segundo.', false);
    expect(t.classe).toBe('PEDIDO_NOVO');
    expect(t.precisaVault).toBe(true);
  });
});

describe('a query do vault não pode ser a mensagem inteira', () => {
  it('o bloco do orquestrador não entra na classificação', () => {
    const comContexto = `me explica o segundo.${CONTEXT_BLOCK_MARKER}DOSSIÊ DO CLIENTE: APAE\nTom de voz acolhedor e empático...`;
    const t = classificarTurno(comContexto, true);
    expect(t.classe).toBe('REFERENCIAL');
    expect(t.precisaVault, 'o dossiê colado não pode reabrir o vault').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ISOLAMENTO DE CLIENTE
// ---------------------------------------------------------------------------

function doc(path: string, body: string): BrainDoc {
  return {
    path,
    titulo: path,
    frontmatter: { intencoes: [] },
    headings: [],
    body,
    mtimeMs: 0,
    sizeBytes: body.length,
  };
}

const INDEX: BrainIndex = {
  brainPath: '/vault',
  loadedAt: 0,
  docs: [
    doc('STUDIO-BRAIN/06_CLIENTS/apae/tom-de-voz.md', 'tom de voz acolhedor empático persona da apae'),
    doc('STUDIO-BRAIN/06_CLIENTS/elite/tom-de-voz.md', 'tom de voz da elite sofisticado persona'),
    doc('piramide-de-conteudo.md', 'tom de voz é um conceito geral de conteúdo e persona'),
  ],
};

describe('donoDoDocumento / documentoPermitido', () => {
  it('identifica o dono pelo caminho', () => {
    expect(donoDoDocumento('STUDIO-BRAIN/06_CLIENTS/apae/tom-de-voz.md')).toBe('apae');
    expect(donoDoDocumento('piramide-de-conteudo.md')).toBeNull();
  });

  it('conhecimento geral passa para qualquer turno', () => {
    expect(documentoPermitido('piramide-de-conteudo.md', 'Elite')).toBe(true);
    expect(documentoPermitido('piramide-de-conteudo.md', null)).toBe(true);
  });

  it('unknown_client_does_not_fallback_to_another_client', () => {
    expect(documentoPermitido('STUDIO-BRAIN/06_CLIENTS/apae/tom-de-voz.md', null)).toBe(false);
  });

  it('nome composto ainda casa com a pasta do próprio dono', () => {
    expect(documentoPermitido('STUDIO-BRAIN/06_CLIENTS/elite/x.md', 'Elite Construtora')).toBe(true);
  });
});

describe('elite_never_retrieves_apae', () => {
  it('turno da Elite NÃO recebe documento da APAE', () => {
    const r = retrieveRelevantKnowledge(INDEX, 'tom de voz persona', { clientSlug: 'Elite' });
    const paths = r.map((x) => x.doc.path);
    expect(paths.some((p) => p.includes('apae')), `vazou: ${paths.join(', ')}`).toBe(false);
  });

  it('e recebe o próprio material', () => {
    const r = retrieveRelevantKnowledge(INDEX, 'tom de voz persona', { clientSlug: 'Elite' });
    expect(r.map((x) => x.doc.path).some((p) => p.includes('elite'))).toBe(true);
  });

  it('client_a_vault_never_enters_client_b_prompt (o inverso também)', () => {
    const r = retrieveRelevantKnowledge(INDEX, 'tom de voz persona', { clientSlug: 'APAE' });
    expect(r.map((x) => x.doc.path).some((p) => p.includes('elite'))).toBe(false);
  });

  it('no_cross_client_fallback: sem cliente, só conhecimento geral', () => {
    const r = retrieveRelevantKnowledge(INDEX, 'tom de voz persona', {});
    const paths = r.map((x) => x.doc.path);
    expect(paths.every((p) => !p.includes('06_CLIENTS')), `vazou: ${paths.join(', ')}`).toBe(true);
    expect(paths).toContain('piramide-de-conteudo.md');
  });

  it('client_switch_updates_retrieval_scope', () => {
    const a = retrieveRelevantKnowledge(INDEX, 'tom de voz persona', { clientSlug: 'Elite' });
    const b = retrieveRelevantKnowledge(INDEX, 'tom de voz persona', { clientSlug: 'APAE' });
    expect(a.map((x) => x.doc.path)).not.toEqual(b.map((x) => x.doc.path));
  });
});

describe('reference_resolution_does_not_make_claim_factual', () => {
  it('a diretiva resolve QUAL item, não afirma que o conteúdo é verdade', () => {
    const t = classificarTurno('me explica o segundo.', true);
    const d = resolverReferente(DIALOGO, t)!;
    expect(d).toContain('Fale sobre ELE');
    expect(d.toLowerCase()).not.toMatch(/verdade|confirmado|fato comprovado/);
  });

  it('pedido de dado dura (data do evento) mantém o vault ligado', () => {
    const t = classificarTurno('coloca a data exata do evento no título', true);
    expect(t.precisaVault).toBe(true);
  });
});
