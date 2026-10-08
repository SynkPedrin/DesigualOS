import type { MeResponse } from '@/lib/api/contracts';
import type { NavItem } from './nav-items';

/**
 * O CONTEXTO DE NAVEGAÇÃO, decidido UMA vez e por identidade estável.
 *
 * Nasceu de um defeito real (05/10/2026): a sidebar e a faixa de contexto
 * reconheciam a provedora por REGEX NO NOME (`/desigual/i`) — um tenant
 * chamado "Desigual Advocacia" viraria "casa" para a navegação, e uma
 * provedora renomeada viraria "tenant". Nome é dado de apresentação, não
 * identidade.
 *
 * A identidade estável vem do /me: `eh_provider` (papel de plataforma E
 * pertencer à provedora — nunca só o papel) e `organizacao_ativa.eh_provedora`
 * (o id comparado ao PROVIDER_ORGANIZATION_ID, no servidor). Campo ausente
 * (API antiga, /me ainda carregando) conta como NÃO-tenant: esconder um item
 * a mais por um instante é melhor que piscar tela que a pessoa não pode ver.
 */
export function estaDentroDeTenant(
  me: Pick<MeResponse, 'eh_provider' | 'organizacao_ativa'> | undefined | null,
): boolean {
  return me?.eh_provider === true && me?.organizacao_ativa?.eh_provedora === false;
}

export interface FiltroDeNavegacao {
  isMaster: boolean;
  ehProvider: boolean;
  dentroDeTenant: boolean;
  /**
   * Workspace Builder (§5-13, 06/10/2026): módulos que /me/workspace devolveu
   * pra esta pessoa. Omitido ou `null` = SEM RESTRIÇÃO (mesmo item que já
   * aparecia antes deste campo existir) — diferente dos outros gates deste
   * filtro: esconder um item PERMITIDO por um instante durante o carregamento
   * não protege nada (não é dado sensível entre tenants, é só um item de
   * produto), e tratar como restritivo quebraria toda chamada existente de
   * `itensVisiveisNaNavegacao` que ainda não conhece este campo. Vira
   * restritivo SÓ quando chega um Set de verdade.
   */
  modulosHabilitados?: ReadonlySet<string> | null;
}

/**
 * OS MESMOS GATES DA SIDEBAR, em função pura — sidebar e ⌘K filtram daqui.
 *
 * A command palette filtrava SÓ `masterOnly`: tudo que a navegação esconde por
 * `administracao`, `providerOnly` ou contexto continuava alcançável pelo ⌘K —
 * a segunda porta sem a regra da primeira, o formato exato dos vazamentos de
 * 05/10/2026. Item escondido NÃO apaga a rota: quem tem o link direto e a
 * permissão continua chegando.
 */
export function itensVisiveisNaNavegacao(items: NavItem[], filtro: FiltroDeNavegacao): NavItem[] {
  return items.filter(
    (item) =>
      !item.administracao &&
      (!item.masterOnly || filtro.isMaster) &&
      (!item.providerOnly || filtro.ehProvider) &&
      (item.contexto !== 'provider' || !filtro.dentroDeTenant) &&
      (item.contexto !== 'tenant' || filtro.dentroDeTenant) &&
      (!item.modulo || filtro.isMaster || filtro.modulosHabilitados == null || filtro.modulosHabilitados.has(item.modulo)),
  );
}

export interface BlocosDeConfiguracao {
  /** A ficha da empresa ativa (nome, identificador, marca, assistente). Só faz
   *  sentido quando a organização ativa é um TENANT — na casa da provedora a
   *  gestão da empresa continua sendo /organizations/[id], e duplicar a ficha
   *  inteira em Configurações seria duas portas pro mesmo ajuste. */
  empresa: boolean;
  /** Os 22 itens técnicos. Só no contexto da provedora: um master de tenant
   *  não precisa de fila, embedding nem episódio de agente na tela dele. */
  administracao: boolean;
}

/**
 * QUAIS BLOCOS A TELA DE CONFIGURAÇÕES MOSTRA, decidido pela mesma identidade
 * estável da navegação. Função pura para o gate ser testado sem renderizar —
 * e para a tela e o bloco de Administração nunca divergirem.
 */
export function blocosVisiveisNasConfiguracoes(
  me: Pick<MeResponse, 'eh_provider' | 'organizacao_ativa'> | undefined | null,
): BlocosDeConfiguracao {
  return {
    empresa: me?.organizacao_ativa?.eh_provedora === false,
    administracao: me?.eh_provider === true && !estaDentroDeTenant(me),
  };
}
