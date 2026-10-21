'use client';

import { MediaHub } from '@/components/media/hub/media-hub';

/**
 * MÍDIAS — a carteira inteira de tráfego pago.
 *
 * A tela virou centrada em CRIATIVOS (galeria de todas as contas, Meta e Google), com os números
 * da carteira no topo, o que pede atenção, insights e atividade ao lado. A leitura de antes, por
 * CLIENTE, continua na visão "Tabela" (cliente sem conta aparece em destaque: tráfego rodando fora
 * do radar é o que mais custa). Toda a lógica e os dados vivem em components/media/hub e em
 * packages/tool-gateway/src/media-hub.ts; nenhum número é inventado.
 */
export default function MidiasPage() {
  return <MediaHub />;
}
