import { eq } from 'drizzle-orm';
import { db, schema } from '@desigual-os/database';
import { getAutomationsQueue, registerAutomationJob, removeAutomationJob } from '@desigual-os/orchestrator';
import { createLogger } from '@desigual-os/logging';

const logger = createLogger({ service: 'worker:reconciliar-automacoes' });

/**
 * O BANCO DIZ QUE ESTÁ LIGADA, O REDIS NÃO SABE DELA.
 *
 * Uma automação vive partida em dois lugares. O `enabled` e o `schedule` moram
 * no Postgres, que é durável; o agendamento de verdade é um repeatable job do
 * BullMQ, que mora no Redis, que é efêmero. Registrar só acontecia em dois
 * momentos (criar a automação, e editar a agenda ou reativar), e NADA nunca
 * reconciliava os dois depois disso.
 *
 * A consequência não é hipotética: foi medida em 09/10/2026 pela desigualos-f9,
 * que encontrou a automação "ASDA" marcada como ATIVA na tela e com
 * `next_run_at` nulo. O Redis desta máquina tinha sido perdido, e com ele todos
 * os repeatables. O Postgres continuou dizendo `enabled = true` pra sempre, a
 * tela continuou mostrando "ativa", e nada ia disparar nunca mais. Não havia
 * caminho de conserto: o PATCH só registra quando a agenda muda ou quando a
 * automação SAI de desligada, e uma automação que nunca deixou de estar ligada
 * não passa por nenhum dos dois.
 *
 * É o defeito de 03/09/2026 visto do outro lado. Lá sobrou repeatable sem
 * automação; aqui falta repeatable pra automação que existe. Por isso esta
 * função trata OS DOIS SENTIDOS: é a mesma dessincronia, e consertar só uma
 * ponta deixaria a outra voltando.
 *
 * Roda no boot do worker e de tempos em tempos, porque perder o Redis não é um
 * evento que alguém avisa: é um reinício de container, uma troca de REDIS_URL,
 * uma política de evicção. O agendamento precisa voltar sozinho, e não quando
 * alguém reparar que um relatório parou de chegar.
 */
export interface ResultadoDaReconciliacao {
  /** Automações ligadas que estavam sem repeatable e foram reagendadas. */
  reagendadas: string[];
  /** Repeatables que não correspondiam a nenhuma automação ligada e saíram. */
  orfaosRemovidos: string[];
  /** Automações cujo cron o BullMQ recusou. Ficam de fora, nomeadas, sem derrubar o resto. */
  invalidas: Array<{ id: string; nome: string; erro: string }>;
}

export interface AutomacaoLigada {
  id: string;
  nome: string;
  schedule: string;
}

/** `id` é OPCIONAL de propósito: é assim que o `RepeatableJob` do BullMQ o
 *  declara, e aceitar aqui o mesmo formato evita uma conversão no caminho,
 *  que é onde um `?? ''` se esconderia e viraria remoção de job sem dono. */
export interface RepeatableRegistrado {
  id?: string | null | undefined;
  pattern?: string | null | undefined;
}

export interface PlanoDeReconciliacao {
  /** Automações ligadas sem repeatable: precisam ser registradas. */
  registrar: AutomacaoLigada[];
  /** Repeatables sem automação ligada correspondente: precisam sair. */
  remover: Array<{ id: string; pattern: string }>;
}

/**
 * A DECISÃO, separada da escrita, porque é aqui que mora o risco.
 *
 * Comparar duas listas e concluir "esta falta, esta sobra" é a parte que pode
 * errar silenciosamente, e errar nos dois sentidos custa caro: registrar o que
 * já existe duplicaria disparo, remover o que deveria ficar desligaria uma
 * automação que a pessoa criou. Como função pura, cada caso vira um teste em
 * vez de uma inspeção no Redis.
 *
 * Repeatable sem `id` é ignorado em vez de removido: sem id não dá pra saber
 * de quem ele é, e apagar o que não se identificou é pior que deixar sobrando.
 *
 * O QUE ELA NÃO FAZ, pra ninguém contar com o que não está aqui: não tira
 * repeatable DUPLICADO da mesma automação ligada (resquício de troca de
 * schedule). Isso seria outra decisão, a de qual dos dois patterns é o certo,
 * e esta função não tem como saber: o banco guarda só o schedule atual, e o
 * duplicado pode ser tanto o antigo quanto um registro concorrente legítimo.
 * `proximasExecucoes` já trata esse caso escolhendo o que dispara antes, que é
 * o que a pessoa vai ver acontecer.
 */
export function planejarReconciliacao(
  ligadas: AutomacaoLigada[],
  registrados: RepeatableRegistrado[],
): PlanoDeReconciliacao {
  const idsRegistrados = new Set(registrados.map((j) => j.id).filter((id): id is string => Boolean(id)));
  const idsLigados = new Set(ligadas.map((a) => a.id));

  return {
    registrar: ligadas.filter((a) => !idsRegistrados.has(a.id)),
    remover: registrados
      .filter((j): j is RepeatableRegistrado & { id: string } => Boolean(j.id) && !idsLigados.has(j.id!))
      .map((j) => ({ id: j.id, pattern: j.pattern ?? '' })),
  };
}

export async function reconciliarAutomacoes(): Promise<ResultadoDaReconciliacao> {
  const resultado: ResultadoDaReconciliacao = { reagendadas: [], orfaosRemovidos: [], invalidas: [] };

  const ligadas = await db
    .select({
      id: schema.automations.id,
      nome: schema.automations.name,
      schedule: schema.automations.schedule,
    })
    .from(schema.automations)
    .where(eq(schema.automations.enabled, true));

  const registrados = await getAutomationsQueue().getRepeatableJobs();
  const plano = planejarReconciliacao(ligadas, registrados);

  // SENTIDO 1: está no banco como ligada e não está no agendador.
  for (const automacao of plano.registrar) {
    try {
      // `registerAutomationJob` é idempotente (jobId = automation.id), então
      // uma corrida com a API registrando ao mesmo tempo não duplica nada.
      await registerAutomationJob(automacao.id, automacao.schedule);
      resultado.reagendadas.push(automacao.id);
    } catch (error) {
      /**
       * Cron inválido NÃO para a reconciliação. A API valida ao criar, mas uma
       * automação pode ter entrado por migração, seed ou escrita direta no
       * banco. Derrubar o laço aqui faria uma automação ruim impedir o
       * reagendamento de todas as outras, que é o oposto do que esta função
       * existe pra fazer.
       */
      resultado.invalidas.push({
        id: automacao.id,
        nome: automacao.nome,
        erro: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // SENTIDO 2: está no agendador e não deveria (desligada ou apagada).
  for (const orfao of plano.remover) {
    try {
      // Precisa do MESMO pattern do registro: o BullMQ identifica o repeatable
      // pela combinação {pattern, jobId}, não só pelo jobId.
      await removeAutomationJob(orfao.id, orfao.pattern);
      resultado.orfaosRemovidos.push(orfao.id);
    } catch (error) {
      logger.warn({ automationId: orfao.id, error }, 'não consegui remover repeatable órfão');
    }
  }

  const mexeuEmAlgo =
    resultado.reagendadas.length > 0 || resultado.orfaosRemovidos.length > 0 || resultado.invalidas.length > 0;

  /**
   * Silêncio quando nada mudou, e isso é de propósito: esta função roda de
   * tempos em tempos, e uma linha de log a cada passagem dizendo "0 e 0"
   * ensinaria a pular o log justamente no dia em que ele disser outra coisa.
   */
  if (mexeuEmAlgo) {
    logger.warn(
      {
        reagendadas: resultado.reagendadas.length,
        orfaosRemovidos: resultado.orfaosRemovidos.length,
        invalidas: resultado.invalidas,
        ligadasNoBanco: ligadas.length,
      },
      'automações estavam fora de sincronia com o agendador',
    );
  }

  return resultado;
}
