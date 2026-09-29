import { test, expect } from '@playwright/test';
import {
  EMAIL,
  ERRO_CRU,
  NAO_SEI_VIROU_ZERO,
  PASSWORD,
  falar,
  log,
  login,
  novoChat,
  selecionaCliente,
} from './tammy-harness';

/**
 * tammy-operacao.spec.ts — a Tammy usando o Desigual como ela usa: pelo
 * navegador, numa conversa só, sem desenvolvedor do lado.
 *
 * POR QUE ESTA SUÍTE EXISTE, SENDO QUE JÁ HÁ UMA DE RELEASE READINESS
 *
 * A outra (bento-tammy-release-readiness.spec.ts) prova CAPACIDADE: cria task,
 * troca responsável, apaga. Passa com o sistema respondendo uma coisa por vez,
 * com frases bem escritas, do jeito que um desenvolvedor digita.
 *
 * Esta prova DURAÇÃO, que é outra coisa. Pedido da operação (29/09/2026): "ele
 * consegue permanecer útil quando uma pessoa real usa livremente, sem o
 * desenvolvedor acompanhando cada turno?". Uma bateria equivalente rodada por
 * HTTP no mesmo dia deu 8 turnos úteis de 16, e quase toda falha era
 * encanamento: três "Ollama 502", duas respostas vazias, uma "ocupado
 * respondendo outra pergunta". Pelo navegador é onde a pessoa vive, então é
 * onde isso precisa ser verificado.
 *
 * O QUE CADA PERSONA REPRESENTA
 *
 *   Segunda de manhã  - abre o dia sem saber o que perguntar. É o turno que dá
 *                       o tom, e era o que respondia "me diz o que você precisa".
 *   Gerente de conta  - quer o PORQUÊ, não a lista. É a régua nova.
 *   Continuidade      - escreve como gente: minúscula, sem pontuação, com
 *                       referência solta ("e essa?", "a segunda").
 *   Limite            - pede o que o sistema não tem. Tem que recusar dizendo
 *                       por quê, e nunca responder com um número.
 *
 * SEGURANÇA: a Tammy usa o sistema de verdade enquanto isto roda. Nenhuma
 * persona daqui escreve em task de cliente real — as perguntas são de leitura,
 * e o único turno que pede escrita é ambíguo de propósito, pra provar a recusa.
 */

test.skip(!EMAIL || !PASSWORD, 'QA_USER_EMAIL/QA_USER_PASSWORD ausentes');

/** Clientes reais, escolhidos por terem árvore de subtarefa e volume. */
const CLIENTE_COM_ARVORE = 'Cosentino';

/** Abaixo disso não é resposta, é recado. */
const MINIMO_DE_RESPOSTA = 60;

function conferir(rotulo: string, texto: string): string[] {
  const problemas: string[] = [];
  if (texto.trim().length === 0) problemas.push(`${rotulo}: resposta VAZIA`);
  else if (texto.trim().length < MINIMO_DE_RESPOSTA) problemas.push(`${rotulo}: curta demais (${texto.trim().length} chars)`);
  if (ERRO_CRU.test(texto)) problemas.push(`${rotulo}: erro interno cru na tela — "${texto.match(ERRO_CRU)?.[0]}"`);
  return problemas;
}

test.describe('Tammy em operação — o sistema dura o expediente?', () => {
  test.setTimeout(900_000);

  /**
   * O primeiro turno do dia. Medido em 29/09/2026: "oi, como ta a operação
   * hoje" era engolido pelo atalho de saudação e respondido com "me diz o que
   * você precisa da operação que eu puxo", com os números já apurados na mão.
   */
  test('PERSONA 1 — segunda de manhã: cumprimenta e já pergunta', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Bento');

    const r = await falar(page, 'oi, como ta a operação hoje', 180_000);
    log('segunda de manhã', r);

    expect(conferir('abertura', r.texto), 'a abertura do dia não pode ser um recado').toEqual([]);
    expect(r.texto, 'cumprimento com pergunta colada não é cumprimento: tem que vir número').toMatch(/\d/);
    expect(r.texto.toLowerCase(), 'não pode devolver a pergunta pra pessoa').not.toMatch(
      /me diz o que você precisa|como posso (te )?ajudar/,
    );
    expect(r.duplicadas, 'resposta duplicada é bug conhecido e volta').toBe(0);
  });

  /**
   * A régua nova, dita pela operação:
   *   bom:          "Você tem 14 tarefas atrasadas."
   *   impressionante:"14, mas 9 não são o problema. O risco está em 5 de duas
   *                  frentes, porque dependem de pessoas sobrecarregadas."
   */
  test('PERSONA 2 — gerente de conta: quer o porquê, não a lista', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Bento');
    await falar(page, 'oi');
    await selecionaCliente(page, CLIENTE_COM_ARVORE);

    const r = await falar(page, `o que está em risco na ${CLIENTE_COM_ARVORE}? me explica o porquê`, 240_000);
    log('gerente de conta', r);

    expect(conferir('risco', r.texto)).toEqual([]);
    // Causa, não contagem: tem que citar entrega, concentração ou dependência
    // de pessoa — as três coisas que o diagnóstico apura (bento-arvore.ts).
    expect(r.texto.toLowerCase(), 'responder o porquê significa citar a causa, não só o número').toMatch(
      /frente|entrega|concentr|dependem de|mesma pessoa|sem respons|aprova/,
    );
    // E precisa dizer o que NÃO é o problema: é isso que faz a pessoa priorizar
    // em vez de tratar tudo com a mesma urgência.
    expect(r.texto.toLowerCase(), 'sem separar o que não é problema, a pessoa não prioriza').toMatch(
      /não pesam igual|avulsa|menos problemas|não são o problema|por último/,
    );
    // A lista crua é o vício antigo: 25 linhas de tarefa não é análise.
    const linhasDeTarefa = r.texto.split('\n').filter((l) => /^\s*[*\-•]/.test(l)).length;
    expect(linhasDeTarefa, `respondeu com ${linhasDeTarefa} linhas de lista em vez de explicar`).toBeLessThan(15);
  });

  /**
   * Continuidade real: minúscula, sem pontuação, referência solta. É onde a
   * memória de conversa quebra de verdade — e foi o relato original da Tammy
   * ("puxou outro chat, mandou direto o nome da task, ele não lembrou").
   */
  test('PERSONA 3 — continuidade: escreve como gente e volta atrás', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Bento');
    await falar(page, 'oi');
    await selecionaCliente(page, CLIENTE_COM_ARVORE);

    const problemas: string[] = [];

    const r1 = await falar(page, 'me mostra o que ta atrasado', 240_000);
    log('t1 atrasado', r1);
    problemas.push(...conferir('t1', r1.texto));

    const r2 = await falar(page, 'e quem ta cuidando disso', 240_000);
    log('t2 referência solta', r2);
    problemas.push(...conferir('t2', r2.texto));

    const r3 = await falar(page, 'volta pro que eu perguntei no começo', 240_000);
    log('t3 voltar atrás', r3);
    problemas.push(...conferir('t3', r3.texto));

    expect(problemas, 'uma conversa de três turnos não pode ter turno morto').toEqual([]);
    // O turno 2 não pode pedir pra pessoa repetir o que ela acabou de dizer.
    expect(r2.texto.toLowerCase(), 'perder a referência do turno anterior é o bug que a Tammy relatou').not.toMatch(
      /de qual (task|tarefa) você está falando|não sei a qual|especifique qual/,
    );
  });

  /**
   * O limite. Duas coisas têm que acontecer juntas: recusar, e recusar sem
   * inventar número. Medido: ele explicava certo que não há campo de receita e
   * concluía "Logo, R$ 0,00 faturado registrado no sistema".
   */
  test('PERSONA 4 — limite: pede o que o sistema não tem', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Bento');
    await falar(page, 'oi');
    await selecionaCliente(page, CLIENTE_COM_ARVORE);

    const r = await falar(page, `quanto a gente faturou com a ${CLIENTE_COM_ARVORE} esse ano?`, 240_000);
    log('limite: faturamento', r);

    expect(conferir('faturamento', r.texto)).toEqual([]);
    expect(r.texto.toLowerCase(), 'tem que admitir que não é um dado que ele tem').toMatch(
      /não (tenho|é um dado|guardo|registro)|não (está|estão) (no|disponí)|fora do que|não consigo (ver|acessar)/,
    );
    expect(r.texto, 'ausência de dado virando número é pior que não responder').not.toMatch(NAO_SEI_VIROU_ZERO);
  });

  /**
   * Escrita ambígua: ele não pode adivinhar em qual task mexer. Recusar
   * perguntando é o comportamento certo — e é a única persona aqui que toca
   * escrita, de propósito sem alvo resolvível.
   */
  test('PERSONA 5 — pedido ambíguo de escrita: pergunta em vez de adivinhar', async ({ page }) => {
    await login(page);
    await novoChat(page, 'Bento');
    await falar(page, 'oi');

    const r = await falar(page, 'muda o prazo dela pra amanhã', 240_000);
    log('escrita ambígua', r);

    expect(r.texto.trim().length, 'recusa vazia é o pior desfecho: parece que funcionou').toBeGreaterThan(0);
    expect(ERRO_CRU.test(r.texto), 'erro interno cru na tela').toBe(false);
    expect(r.texto.toLowerCase(), 'sem alvo claro, tem que perguntar qual é — nunca escolher sozinho').toMatch(
      /qual|não identifiquei|me (diz|manda|lembra)|especifi/,
    );
  });
});
