'use client';

import { PageHeader } from '@/components/ui/page-header';
import { Secao } from '@/components/control/primitives';
import { LinhaDoTempo } from '@/components/control/linha-do-tempo';
import { FeedDeAtividade } from '@/components/control/feed-de-atividade';
import { ResumoDaAtividade } from '@/components/control/resumo-da-atividade';

/**
 * ATIVIDADE — o que a OPERAÇÃO fez.
 *
 * A tela lia `/executions`, que são os turnos do Bento ("o agente respondeu
 * uma pergunta"). Útil, mas é a atividade do SISTEMA. O que a equipe fez —
 * tarefa criada no ClickUp, conhecimento registrado pelo Claude — vivia em
 * `operational_events`, e em 02/10/2026 eram 902 linhas sem nenhuma tela.
 *
 * Agora a operação vem primeiro e o motor fica abaixo, nomeado pelo que é.
 */
export default function ActivityPage() {
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Atividade"
        description="O que aconteceu na operação: quem fez, em qual cliente, por qual ferramenta e quando."
      />

      {/* O resumo vem antes da lista: quem abre a tela quer saber o TAMANHO do
          que aconteceu antes de ler item por item. */}
      <div className="mb-6">
        <ResumoDaAtividade />
      </div>

      <Secao titulo="Na operação">
        <LinhaDoTempo limite={60} />
      </Secao>

      {/*
        * O motor continua visível, e separado. Misturar "o Bento respondeu uma
        * pergunta" com "a Tammy criou uma tarefa" na mesma lista faz as duas
        * coisas parecerem a mesma, e elas não são.
        */}
      <Secao titulo="Pedidos à inteligência">
        <FeedDeAtividade limite={20} />
      </Secao>
    </div>
  );
}
