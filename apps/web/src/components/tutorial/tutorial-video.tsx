'use client';

import { AbsoluteFill, Easing, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { ABERTURA_SEGUNDOS, CENAS, FECHO_SEGUNDOS, FPS, type Cena, type Destaque } from './roteiro';

/**
 * TUTORIAL DE PRIMEIRO ACESSO, em Remotion.
 *
 * Por que vídeo em vez de um tour por cima da interface real: o tour precisa
 * que a conta JÁ tenha dado, e uma conta nova não tem nenhum. Apontar para uma
 * tela vazia ensinando "aqui ficam suas tarefas" é a pior primeira impressão
 * possível. O mockup mostra o sistema cheio, que é como ele vai parecer depois
 * de uma semana de uso.
 *
 * Roda com @remotion/player dentro do produto, não como MP4 renderizado: o
 * vídeo acompanha o código, e trocar um mockup ou um texto é editar este
 * arquivo, sem passo de render nem arquivo binário no repositório.
 */

const ROXO = '#7C3AED';
const BRANCO = '#F4F1EC';
const CARBONO = '#0A0A0B';

/** Curva única para tudo que entra, pra animação inteira ter o mesmo caráter. */
const ENTRADA = Easing.bezier(0.16, 1, 0.3, 1);

function Anotacao({ destaque, fps }: { destaque: Destaque; fps: number }) {
  const frame = useCurrentFrame();
  const inicio = destaque.entraEm * fps;
  const [esquerda, topo, largura, altura] = destaque.area;

  // O retângulo nasce um pouco maior e assenta no lugar. Dá a sensação de
  // "pousar sobre" o elemento, em vez de simplesmente aparecer.
  const progresso = interpolate(frame, [inicio, inicio + 0.5 * fps], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ENTRADA,
  });

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: `${esquerda}%`,
          top: `${topo}%`,
          width: `${largura}%`,
          height: `${altura}%`,
          border: `3px solid ${ROXO}`,
          borderRadius: 12,
          boxShadow: `0 0 0 9999px rgba(10,10,11,${0.55 * progresso}), 0 0 40px rgba(124,58,237,0.45)`,
          opacity: progresso,
          scale: interpolate(progresso, [0, 1], [1.04, 1], { output: 'perceptual-scale' }),
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: `${esquerda}%`,
          [destaque.lado === 'abaixo' ? 'top' : 'bottom']:
            destaque.lado === 'abaixo' ? `calc(${topo + altura}% + 16px)` : `calc(${100 - topo}% + 16px)`,
          maxWidth: `${Math.max(largura, 34)}%`,
          background: ROXO,
          color: BRANCO,
          padding: '12px 18px',
          borderRadius: 10,
          fontSize: 26,
          lineHeight: 1.25,
          fontWeight: 600,
          opacity: progresso,
          translate: interpolate(progresso, [0, 1], destaque.lado === 'abaixo' ? ['0px -10px', '0px 0px'] : ['0px 10px', '0px 0px']),
        }}
      >
        {destaque.rotulo}
      </div>
    </AbsoluteFill>
  );
}

function CenaDeTela({ cena, fps }: { cena: Cena; fps: number }) {
  const frame = useCurrentFrame();
  const duracao = cena.duracaoSegundos * fps;

  return (
    <AbsoluteFill style={{ backgroundColor: CARBONO }}>
      {/* A tela respira devagar durante a cena. Movimento constante e lento
        * segura o olho sem competir com a anotação que está entrando. */}
      <AbsoluteFill
        style={{
          scale: interpolate(frame, [0, duracao], [1.02, 1.06], { output: 'perceptual-scale' }),
          opacity: interpolate(frame, [0, 0.4 * fps, duracao - 0.4 * fps, duracao], [0, 1, 1, 0], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
        }}
      >
        <Img src={staticFile(`tutorial/${cena.imagem}`)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>

      {cena.destaques.map((d) => (
        <Anotacao key={d.rotulo} destaque={d} fps={fps} />
      ))}

      {/* Título e resumo ficam numa faixa inferior sólida: sobre a tela cheia
        * de informação, texto solto não tem contraste suficiente pra ser lido. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '28px 64px 36px',
          background: 'linear-gradient(to top, rgba(10,10,11,0.97) 55%, rgba(10,10,11,0))',
          opacity: interpolate(frame, [0, 0.6 * fps], [0, 1], { extrapolateRight: 'clamp', easing: ENTRADA }),
          translate: interpolate(frame, [0, 0.6 * fps], ['0px 24px', '0px 0px'], {
            extrapolateRight: 'clamp',
            easing: ENTRADA,
          }),
        }}
      >
        <p style={{ margin: 0, color: ROXO, fontSize: 22, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>
          Desigual OS
        </p>
        <h2 style={{ margin: '6px 0 8px', color: BRANCO, fontSize: 64, fontWeight: 800, lineHeight: 1 }}>{cena.titulo}</h2>
        <p style={{ margin: 0, color: 'rgba(244,241,236,0.82)', fontSize: 30, lineHeight: 1.35, maxWidth: 1400 }}>
          {cena.resumo}
        </p>
      </div>
    </AbsoluteFill>
  );
}

function Abertura({ fps }: { fps: number }) {
  const frame = useCurrentFrame();
  const aparece = (atrasoSegundos: number) =>
    interpolate(frame, [atrasoSegundos * fps, (atrasoSegundos + 0.8) * fps], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: ENTRADA,
    });

  return (
    <AbsoluteFill style={{ backgroundColor: CARBONO, justifyContent: 'center', alignItems: 'center', padding: 80 }}>
      <h1
        style={{
          margin: 0,
          color: BRANCO,
          fontSize: 96,
          fontWeight: 900,
          textAlign: 'center',
          opacity: aparece(0.2),
          translate: interpolate(aparece(0.2), [0, 1], ['0px 28px', '0px 0px']),
        }}
      >
        Bem-vindo ao Desigual OS
      </h1>
      <p
        style={{
          margin: '24px 0 0',
          color: 'rgba(244,241,236,0.75)',
          fontSize: 36,
          textAlign: 'center',
          maxWidth: 1250,
          lineHeight: 1.35,
          opacity: aparece(1.1),
          translate: interpolate(aparece(1.1), [0, 1], ['0px 20px', '0px 0px']),
        }}
      >
        Em um minuto você vai saber o que cada tela faz e por onde começar.
      </p>
    </AbsoluteFill>
  );
}

function Fecho({ fps }: { fps: number }) {
  const frame = useCurrentFrame();
  const aparece = (atrasoSegundos: number) =>
    interpolate(frame, [atrasoSegundos * fps, (atrasoSegundos + 0.8) * fps], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: ENTRADA,
    });

  return (
    <AbsoluteFill style={{ backgroundColor: CARBONO, justifyContent: 'center', alignItems: 'center', padding: 80 }}>
      <h2
        style={{
          margin: 0,
          color: BRANCO,
          fontSize: 76,
          fontWeight: 900,
          textAlign: 'center',
          opacity: aparece(0.2),
          translate: interpolate(aparece(0.2), [0, 1], ['0px 24px', '0px 0px']),
        }}
      >
        Comece pelo Hoje
      </h2>
      <p
        style={{
          margin: '22px 0 0',
          color: 'rgba(244,241,236,0.78)',
          fontSize: 32,
          textAlign: 'center',
          maxWidth: 1300,
          lineHeight: 1.4,
          opacity: aparece(1.0),
        }}
      >
        Em qualquer tela, o botão Perguntar ao Bento responde sobre a operação. E o botão Tutorial, no topo, traz este
        guia de volta quando você quiser.
      </p>
    </AbsoluteFill>
  );
}

export function TutorialVideo() {
  const fps = FPS;
  let cursor = ABERTURA_SEGUNDOS * fps;

  return (
    <AbsoluteFill style={{ backgroundColor: CARBONO, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <Sequence durationInFrames={ABERTURA_SEGUNDOS * fps}>
        <Abertura fps={fps} />
      </Sequence>

      {CENAS.map((cena) => {
        const inicio = cursor;
        const duracao = cena.duracaoSegundos * fps;
        cursor += duracao;
        return (
          <Sequence key={cena.imagem} from={inicio} durationInFrames={duracao}>
            <CenaDeTela cena={cena} fps={fps} />
          </Sequence>
        );
      })}

      <Sequence from={cursor} durationInFrames={FECHO_SEGUNDOS * fps}>
        <Fecho fps={fps} />
      </Sequence>
    </AbsoluteFill>
  );
}
