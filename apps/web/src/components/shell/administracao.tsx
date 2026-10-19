'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { NAV_ITEMS } from './nav-items';
import { estaDentroDeTenant } from './nav-visibility';
import { useMe } from '@/hooks/use-me';
import { useIsMaster } from '@/hooks/use-is-master';

/**
 * ADMINISTRAÇÃO — a porta das ferramentas técnicas.
 *
 * Existe porque esconder não pode virar sumir. Em 02/10/2026 a navegação saiu
 * de 30 itens para 9: Sinais, Decisões, Agentes, Monitoramento, Qualidade do
 * dado, Auditoria e outros quinze deixaram de aparecer para quem usa o produto
 * para trabalhar.
 *
 * NENHUMA ROTA FOI APAGADA, e é por isso que este bloco precisa existir: sem
 * ele, vinte e duas telas continuariam funcionando e ninguém chegaria nelas a
 * não ser digitando o endereço. Esconder sem dar caminho é perder a
 * funcionalidade com passos extras.
 *
 * SÓ NO CONTEXTO DA PROVEDORA. Um administrador de empresa cliente não
 * precisa ver fila, embedding nem episódio de agente — e mostrar isso a ele
 * seria o oposto do que este bloco tenta fazer. Apertado em 05/10/2026: antes
 * bastava ser master, então o master DE UM TENANT via as ferramentas da
 * plataforma; agora o bloco exige provedor NA CASA (fora de qualquer tenant).
 * As rotas continuam de pé para quem tem o link e a permissão — a defesa real
 * é do servidor.
 */
export function Administracao() {
  const { isMaster } = useIsMaster();
  const { data: me } = useMe();
  const ehProvider = me?.eh_provider === true;

  if (!ehProvider || estaDentroDeTenant(me)) return null;

  const tecnicas = NAV_ITEMS.filter(
    (item) => item.administracao && (!item.masterOnly || isMaster) && (!item.providerOnly || ehProvider),
  );
  if (tecnicas.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="text-[15px] font-medium text-branco-cru">Administração</h2>
      <p className="mt-1 max-w-2xl text-[13px] text-nevoa">
        As ferramentas de quem opera a plataforma. Elas saíram do menu principal para não competir com o trabalho do
        dia, e continuam todas aqui, nos mesmos endereços.
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {tecnicas.map((item) => {
          const Icone = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center justify-between gap-3 rounded-lg border border-grafite-elevado bg-grafite px-3.5 py-2.5 transition-colors hover:border-nevoa/40"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Icone size={15} className="shrink-0 text-nevoa" />
                <span className="truncate text-[14px] text-branco-cru">{item.label}</span>
              </span>
              <ChevronRight size={14} className="shrink-0 text-nevoa/60" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
