'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence } from 'framer-motion';
import { useMe } from '@/hooks/use-me';
import { useMyWorkspace } from '@/hooks/use-my-workspace';
import { useAnnouncementEvent, useAnnouncements, registrarEventoDoAnuncio, type Anuncio } from '@/hooks/use-announcements';
import { useUiStore } from '@/stores/ui-store';
import { useTour } from '@/components/tour/tour-provider';
import { AnnouncementModal } from './announcement-modal';

/**
 * QUANDO UM ANÚNCIO ABRE SOZINHO. Mora no AppShell (área logada: nunca na tela
 * de login, nunca em página pública) e só age depois que:
 *  1. a sessão e o perfil chegaram (`/me`) e o workspace — com os módulos — também;
 *  2. o servidor listou os anúncios elegíveis (a elegibilidade é decidida lá);
 *  3. não há outro modal crítico aberto (tutorial de boas-vindas, Studio, um
 *     diálogo qualquer com aria-modal) nem um tutorial guiado em andamento.
 *
 * Aí REIVINDICA a apresentação no servidor ('shown'): só a primeira chamada por
 * pessoa ganha. Duas abas abertas ao mesmo tempo, ou o celular e o computador,
 * nunca mostram o anúncio duas vezes. Quem já estava logado no lançamento vê na
 * próxima vez que a lista for buscada (entrar, recarregar ou voltar à aba).
 */

function haOutroModalCritico(): boolean {
  return Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
}

export function AnnouncementHost() {
  const router = useRouter();
  const { data: me } = useMe();
  const workspace = useMyWorkspace();
  const pronto = Boolean(me?.id) && workspace.isSuccess;
  const anuncios = useAnnouncements(pronto);
  const evento = useAnnouncementEvent();
  const tour = useTour();
  const studioAberto = useUiStore((s) => s.studioModalOpen);
  const [aberto, setAberto] = useState<Anuncio | null>(null);
  // Outro modal estava aberto: tenta de novo daqui a pouco (sem isto, o anúncio só voltaria na próxima entrada).
  const [tentativa, setTentativa] = useState(0);
  const reivindicando = useRef(false);
  const rebuscar = useRef(anuncios.refetch);
  rebuscar.current = anuncios.refetch;
  const lista = anuncios.data;

  // Volta à aba depois de um tempo: pergunta de novo (é assim que quem já estava logado no lançamento vê).
  useEffect(() => {
    const aoVoltar = () => { if (document.visibilityState === 'visible' && pronto) void rebuscar.current(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => document.removeEventListener('visibilitychange', aoVoltar);
  }, [pronto]);

  useEffect(() => {
    if (!pronto || aberto || reivindicando.current || tour.ativo || studioAberto) return;
    const candidato = lista?.find((a) => a.auto_open);
    if (!candidato) return;
    // Espera a tela assentar (o tutorial de boas-vindas abre logo depois do /me) e confere de novo.
    const espera = window.setTimeout(async () => {
      if (reivindicando.current) return;
      if (haOutroModalCritico()) { window.setTimeout(() => setTentativa((t) => t + 1), 3000); return; }
      reivindicando.current = true;
      try {
        const r = await registrarEventoDoAnuncio(candidato.key, 'shown');
        if (r.first && !haOutroModalCritico()) setAberto(r.announcement);
      } catch {
        // Sem rede ou servidor fora: não mostra agora; a próxima entrada tenta de novo.
      } finally {
        reivindicando.current = false;
        void rebuscar.current();
      }
    }, 1200);
    return () => window.clearTimeout(espera);
  }, [pronto, lista, aberto, tour.ativo, studioAberto, tentativa]);

  const fechar = (comoDispensa: boolean) => {
    if (!aberto) return;
    if (comoDispensa) evento.mutate({ key: aberto.key, event: 'dismissed' });
    setAberto(null);
  };

  const acaoPrincipal = () => {
    if (!aberto) return;
    const a = aberto;
    setAberto(null);
    if (a.primary_cta.action === 'start_tutorial' && a.tutorial_id) tour.iniciar(a.tutorial_id);
    else if (a.primary_cta.action === 'navigate' && a.primary_cta.href) { evento.mutate({ key: a.key, event: 'completed' }); router.push(a.primary_cta.href); }
    else evento.mutate({ key: a.key, event: 'dismissed' });
  };

  return (
    <AnimatePresence>
      {aberto && (
        <AnnouncementModal
          key={aberto.key}
          anuncio={aberto}
          onPrincipal={acaoPrincipal}
          onSecundario={() => fechar(true)}
          onFechar={() => fechar(true)}
        />
      )}
    </AnimatePresence>
  );
}
