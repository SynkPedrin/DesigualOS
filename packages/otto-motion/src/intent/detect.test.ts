import { describe, expect, it } from 'vitest';
import { detectMotionIntent, extractDuration, extractFormat, extractFps } from './detect.js';

const semSessao = { hasActiveSession: false };
const comSessao = { hasActiveSession: true };

describe('detectMotionIntent — os exemplos da §15', () => {
  it.each([
    'anime isso',
    'transforme essa arte em motion',
    'faz essa campanha se mexer',
    'faz um anúncio animado',
    'crie um motion de 15 segundos',
    'anime o logo',
    'faça um vídeo motion desse post',
    'transforma essa campanha estática em vídeo',
  ])('classifica "%s" como criação de motion', (frase) => {
    expect(detectMotionIntent(frase, semSessao)?.kind).toBe('create');
  });
});

describe('detectMotionIntent — o que NÃO pode ser sequestrado', () => {
  it.each([
    ['gera um vídeo com IA do produto', 'generative video é do Studio'],
    ['usa o Veo pra fazer esse plano', 'nome de modelo generativo'],
    ['corta o vídeo nos primeiros 10 segundos', 'edição'],
    ['legenda o vídeo que eu mandei', 'edição'],
    ['transcreve esse áudio', 'transcrição'],
    ['cria uma imagem do produto', 'imagem'],
    ['escreve a legenda do post', 'copy'],
    ['qual o status da campanha da Envu?', 'consulta comum'],
    ['bom dia, tudo certo?', 'cortesia'],
  ])('deixa "%s" seguir o caminho de sempre (%s)', (frase) => {
    expect(detectMotionIntent(frase, semSessao)).toBeNull();
  });

  it('NÃO intercepta "cria um reels" puro — reels é job do Studio que já funciona', () => {
    expect(detectMotionIntent('cria um reels pra Colpar', semSessao)).toBeNull();
  });

  it('mas intercepta quando o reels é explicitamente animado', () => {
    expect(detectMotionIntent('cria um reels animado pra Colpar', semSessao)?.kind).toBe('create');
  });
});

describe('detectMotionIntent — iteração (§17)', () => {
  it('sem sessão ativa, um ajuste solto não vira nada', () => {
    expect(detectMotionIntent('o card da segunda cena está muito parado', semSessao)).toBeNull();
  });

  it('com sessão ativa, o mesmo ajuste vira update — não criação nova', () => {
    const intent = detectMotionIntent(
      'o card da segunda cena está muito parado. faz uma entrada mais agressiva e deixa o CTA aparecer antes',
      comSessao,
    );
    expect(intent?.kind).toBe('update');
  });

  it.each([
    'deixa o preço entrar mais forte',
    'ficou muito rápido',
    'faz o logo entrar depois',
    'troca a fotografia',
    'usa uma estética mais premium',
    'faz uma versão para stories',
    'cria uma alternativa mais agressiva',
  ])('"%s" com sessão ativa é update', (frase) => {
    expect(detectMotionIntent(frase, comSessao)?.kind).toBe('update');
  });

  it('pedido explícito de peça nova continua sendo create mesmo com sessão ativa', () => {
    expect(detectMotionIntent('agora faz um motion novo, do zero', comSessao)?.kind).toBe('create');
  });
});

describe('extração de parâmetros', () => {
  it('lê a duração pedida', () => {
    expect(extractDuration('crie um motion de 15 segundos')).toBe(15);
    expect(extractDuration('faz um de 6s')).toBe(6);
  });

  it('não confunde resolução com duração', () => {
    expect(extractDuration('1080x1920')).toBeUndefined();
  });

  it('recusa duração fora da faixa suportada', () => {
    expect(extractDuration('um motion de 600 segundos')).toBeUndefined();
  });

  it('lê o formato por aspect, por resolução e por nome de canal', () => {
    expect(extractFormat('formato 9:16')).toBe('9:16');
    expect(extractFormat('1080x1350 por favor')).toBe('4:5');
    expect(extractFormat('pro stories')).toBe('9:16');
    expect(extractFormat('pro youtube')).toBe('16:9');
    expect(extractFormat('sem formato definido')).toBeUndefined();
  });

  it('lê fps só nos valores suportados', () => {
    expect(extractFps('60fps')).toBe(60);
    expect(extractFps('12 fps')).toBeUndefined();
  });
});
