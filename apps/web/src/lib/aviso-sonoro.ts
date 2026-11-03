/**
 * SOM E AVISO DO NAVEGADOR para mensagem nova e tarefa atribuída (03/11/2026, pedido da operação: "sempre que tiver
 * mensagem nova, task nova atribuída, notificação com barulho").
 *
 * O som é sintetizado (Web Audio), sem arquivo de áudio. O navegador só libera som e o pedido de permissão de
 * notificação depois de um gesto da pessoa: `prepararAvisos` espera o primeiro clique ou tecla na área logada,
 * destrava o áudio e, se a pessoa ainda não respondeu, pergunta se pode mostrar notificações. Antes desse primeiro
 * gesto o aviso aparece no sino e no popup, só que sem som.
 */

export type TipoDeAviso = 'mensagem' | 'tarefa';

/** O que toca: mensagem e menção da Comunicação, e tarefa atribuída ou menção no Daily. Reação não toca. */
export function tipoDeAvisoSonoro(tipo: string): TipoDeAviso | null {
  if (tipo === 'work.assigned' || tipo === 'work.mentioned') return 'tarefa';
  if (tipo.startsWith('chat.') && tipo !== 'chat.reaction') return 'mensagem';
  return null;
}

let contexto: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Classe = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Classe) return null;
  contexto ??= new Classe();
  return contexto;
}

let preparado = false;
export function prepararAvisos(): void {
  if (preparado || typeof window === 'undefined') return;
  preparado = true;
  const aoPrimeiroGesto = () => {
    window.removeEventListener('pointerdown', aoPrimeiroGesto);
    window.removeEventListener('keydown', aoPrimeiroGesto);
    const ctx = audio();
    if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
    if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission().catch(() => undefined);
  };
  window.addEventListener('pointerdown', aoPrimeiroGesto);
  window.addEventListener('keydown', aoPrimeiroGesto);
}

/** Notas (Hz) de cada aviso: mensagem sobe duas notas; tarefa, três, para dar para distinguir sem olhar. */
const NOTAS: Record<TipoDeAviso, number[]> = { mensagem: [880, 1318.5], tarefa: [659.3, 880, 1174.7] };
let ultimoSom = 0;

export function tocarAviso(tipo: TipoDeAviso): void {
  const agora = performance.now();
  if (agora - ultimoSom < 1_200) return; // rajada vira um som só
  ultimoSom = agora;
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  const inicio = ctx.currentTime + 0.01;
  NOTAS[tipo].forEach((freq, i) => {
    const t = inicio + i * 0.13;
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    ganho.gain.setValueAtTime(0, t);
    ganho.gain.linearRampToValueAtTime(0.22, t + 0.015);
    ganho.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    osc.connect(ganho);
    ganho.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.34);
  });
}

/**
 * Aviso do sistema operacional quando a aba não está à vista (com a aba à vista, o popup do canto já mostra).
 * Clicar traz a aba para frente e abre o link.
 */
export function avisarNoNavegador(titulo: string, corpo: string | null, aoClicar: () => void, tag: string): void {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible' && document.hasFocus()) return;
  try {
    const n = new Notification(titulo, { ...(corpo ? { body: corpo } : {}), tag, icon: '/brand/os-mark-icon.png' });
    n.onclick = () => { window.focus(); aoClicar(); n.close(); };
  } catch {
    // Safari antigo e alguns navegadores móveis não deixam criar Notification fora de service worker: fica o som.
  }
}
