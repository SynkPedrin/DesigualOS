import type { BentoWhatsappConfig } from './config';
import { interpretarAtalho } from './commands';
import { formatarParaWhatsapp } from './format';
import { extrairCodigoDeVinculo } from './identity';
import { mencionaOBento, normalizarEvento, type MensagemRecebida } from './inbound';
import type { AnexoDoTurno, BrainDoBento, RespostaDoBrain } from './brain';
import { OpenwaError } from './openwa/client';
import type { BentoWhatsappTransport, OpenwaWebhookEnvelope } from './openwa/contract';
import type { ArmazemDoCanal, AtualizacaoDoRecebido, Vinculo } from './store';
import { TEXTOS } from './textos';
import { CONFIANCA_MINIMA, pareceAcaoDeEscrita, type Transcritor } from './transcription';
import type { UsuarioDoCanal } from './usuario';
import type { AuthenticatedUser } from '../auth/middleware';

/**
 * GATEWAY DO BENTO NO WHATSAPP.
 *
 * Recebe, valida, identifica, limita, leva ao Brain, formata, envia, registra.
 * Não interpreta pedido, não consulta ClickUp, não decide ação: isso é do
 * Brain, que é o mesmo da web (ver brain.ts). Se alguma regra daqui começar a
 * "entender" o pedido além de atalho e confirmação de áudio, ela está no
 * lugar errado.
 *
 * Ordem das barreiras (cada uma termina o turno com um motivo gravado):
 *   1. sessão errada / evento velho / não é mensagem recebida / eco do próprio
 *      número → nem grava (webhook)
 *   2. mesma mensagem de novo (retry, segundo webhook) → grava uma vez só
 *   3. grupo não autorizado / sem menção → ignora calado
 *   4. número sem vínculo → código de vínculo, ou um aviso por dia
 *   5. conta desativada / sem `chat:write` → recusa
 *   6. limite de uso → recusa
 *   7. turno → Brain
 */

const UMA_HORA = 60 * 60_000;
const UM_DIA = 24 * UMA_HORA;
const MAX_TENTATIVAS_DE_CODIGO_POR_HORA = 5;
/** Mensagem mais velha que isto nunca é respondida (é histórico, não pedido). */
const MAX_IDADE_DA_MENSAGEM_MS = 3 * 60_000;
/** Disjuntor de saída: mais que isto de conversas DIFERENTES em 1 min trava todo envio. */
const MAX_CONVERSAS_NOVAS_POR_MINUTO = 5;
const TRAVA_DE_SAIDA_MS = 15 * 60_000;
/** Prefixo do vínculo "virtual" do modo aberto (não existe no banco). */
const PREFIXO_VIRTUAL = 'aberto:';
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_DOCUMENTO_BYTES = 10 * 1024 * 1024;
const JANELA_DE_CONFIRMACAO_MS = 10 * 60_000;
/** Reinício: o que ficou pendurado há mais que isto não é retomado. */
const JANELA_DE_RETOMADA_MS = UM_DIA;

const NOMES_DOS_AGENTES: Record<string, string> = { bento: 'Bento', jarbas: 'Jarbas', otto: 'Otto', suzy: 'Suzy', studio: 'Studio' };

const MAX_IMAGEM_BYTES = 10 * 1024 * 1024;

const DOCUMENTOS_LIDOS = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/markdown',
  'text/csv',
]);

interface LogDoGateway {
  info: (obj: object, msg: string) => void;
  warn: (obj: object, msg: string) => void;
  error: (obj: object, msg: string) => void;
}

export interface DependenciasDoGateway {
  config: BentoWhatsappConfig;
  transporte: BentoWhatsappTransport;
  armazem: ArmazemDoCanal;
  brain: BrainDoBento;
  carregarUsuario: (userId: string) => Promise<UsuarioDoCanal>;
  transcritor: Transcritor | null;
  guardarAnexo:
    | ((input: { userId: string; filename: string; mimetype: string; bytes: Buffer }) => Promise<AnexoDoTurno>)
    | null;
  log: LogDoGateway;
  agora?: () => Date;
  esperar?: (ms: number) => Promise<void>;
}

export type ResultadoDoRecebimento =
  | { aceito: true; id: string; duplicado: boolean }
  | { aceito: false; motivo: string };

interface ItemDaFila {
  id: string;
  mensagem: MensagemRecebida;
}

interface LoteEmEspera {
  itens: ItemDaFila[];
  timer: NodeJS.Timeout;
  inicio: number;
}

class ErroDeEnvio extends Error {
  constructor(
    message: string,
    readonly enviados: string[],
  ) {
    super(message);
  }
}

export class GatewayDoBento {
  private readonly agora: () => Date;
  private readonly esperar: (ms: number) => Promise<void>;
  /** Uma corrente de promessas por remetente: preserva a ordem sem travar os outros. */
  private readonly correntes = new Map<string, Promise<void>>();
  private readonly lotes = new Map<string, LoteEmEspera>();
  private readonly emVoo = new Set<Promise<void>>();
  private ativos = 0;
  private readonly aguardandoVaga: Array<() => void> = [];

  constructor(private readonly deps: DependenciasDoGateway) {
    this.agora = deps.agora ?? (() => new Date());
    this.esperar = deps.esperar ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Conversa de cada número no modo aberto (em memória: é teste, não histórico). */
  private readonly conversasAbertas = new Map<string, string>();
  private aquecidaAte = 0;
  private naoAquecidaAte = 0;

  private async salvarConversa(vinculo: Vinculo, conversationId: string | null): Promise<void> {
    if (vinculo.id.startsWith(PREFIXO_VIRTUAL)) {
      if (conversationId) this.conversasAbertas.set(vinculo.phone, conversationId);
      else this.conversasAbertas.delete(vinculo.phone);
      return;
    }
    await this.deps.armazem.definirConversa(vinculo.id, conversationId);
  }

  /**
   * A sessão só responde depois de `aquecimentoMs` desde a conexão (hora
   * informada pelo próprio OpenWA). Sessão que não está 'ready' ou que não
   * conseguimos consultar: não responde (falha fechada). `connectedAt`
   * ausente conta como aquecida — o resto das travas continua valendo.
   */
  private async sessaoAquecida(): Promise<boolean> {
    const agora = this.agora().getTime();
    if (agora < this.aquecidaAte) return true;
    if (agora < this.naoAquecidaAte) return false;
    try {
      const sessao = await this.deps.transporte.getSession();
      if (sessao.status !== 'ready') {
        this.naoAquecidaAte = agora + 5_000;
        return false;
      }
      const conectada = sessao.connectedAt ? Date.parse(sessao.connectedAt) : NaN;
      if (Number.isFinite(conectada) && agora - conectada < this.deps.config.aquecimentoMs) {
        this.naoAquecidaAte = agora + 10_000;
        return false;
      }
      this.aquecidaAte = agora + 30_000;
      return true;
    } catch {
      this.naoAquecidaAte = agora + 5_000;
      return false;
    }
  }

  /** Opções novas (ligar/desligar, número, grupos) sem perder a fila em memória. */
  atualizarConfig(config: BentoWhatsappConfig): void {
    this.deps.config = config;
  }

  /* ---------------------------------------------------------------- */
  /* Entrada                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Chamado pelo webhook DEPOIS da assinatura conferida. Responde rápido: o
   * processamento segue fora da requisição (o OpenWA dá 10s antes de
   * considerar falha e reenviar).
   */
  async receber(envelope: OpenwaWebhookEnvelope): Promise<ResultadoDoRecebimento> {
    const { config } = this.deps;
    if (envelope.sessionId !== config.sessionId) return { aceito: false, motivo: 'sessao_desconhecida' };

    const despachadoEm = Date.parse(envelope.timestamp);
    if (!Number.isFinite(despachadoEm)) return { aceito: false, motivo: 'timestamp_invalido' };
    const idade = this.agora().getTime() - despachadoEm;
    // O timestamp está DENTRO do corpo assinado: um envelope capturado e
    // reenviado depois da janela é recusado mesmo com assinatura válida.
    if (idade > config.maxEventAgeMs || idade < -5 * 60_000) return { aceito: false, motivo: 'evento_fora_da_janela' };

    const normalizado = normalizarEvento(envelope);
    if (normalizado.tipo === 'ignorar') return { aceito: false, motivo: normalizado.motivo };
    const mensagem = normalizado.mensagem;

    // Anti-loop, segunda barreira: mesmo que `fromMe` venha errado, o número
    // do próprio Bento nunca é remetente de pedido.
    if (config.botPhone && mensagem.telefone === config.botPhone) return { aceito: false, motivo: 'own_number' };

    // A idade que conta é a da MENSAGEM, não a do envelope (o envelope é de
    // agora, mesmo quando o aparelho entrega histórico). Um pedido de verdade
    // é respondido em segundos; o que tem minutos de idade é backlog.
    if (mensagem.enviadaEm && this.agora().getTime() - mensagem.enviadaEm.getTime() > MAX_IDADE_DA_MENSAGEM_MS) {
      return { aceito: false, motivo: 'mensagem_antiga' };
    }

    const { id, nova } = await this.deps.armazem.registrar(mensagem);
    if (!nova) return { aceito: true, id, duplicado: true };
    this.agendar({ id, mensagem });
    return { aceito: true, id, duplicado: false };
  }

  /**
   * Junta mensagens de TEXTO seguidas da mesma pessoa numa janela curta
   * ("Bento" ↵ "quais tarefas" ↵ "estão atrasadas?" é UM pedido). Mídia não
   * junta: vira o próprio turno.
   */
  private agendar(item: ItemDaFila): void {
    const chave = `${item.mensagem.chatId}|${item.mensagem.remetenteJid}`;
    const janela = this.deps.config.coalesceWindowMs;
    const existente = this.lotes.get(chave);
    const ehTexto = item.mensagem.tipo === 'text';

    if (existente && ehTexto && Date.now() - existente.inicio < janela * 4) {
      clearTimeout(existente.timer);
      existente.itens.push(item);
      existente.timer = setTimeout(() => this.liberarLote(chave), janela);
      return;
    }
    if (existente) {
      clearTimeout(existente.timer);
      this.liberarLote(chave);
    }
    if (!ehTexto) {
      this.encadear(chave, [item]);
      return;
    }
    this.lotes.set(chave, {
      itens: [item],
      inicio: Date.now(),
      timer: setTimeout(() => this.liberarLote(chave), janela),
    });
  }

  private liberarLote(chave: string): void {
    const lote = this.lotes.get(chave);
    if (!lote) return;
    this.lotes.delete(chave);
    this.encadear(chave, lote.itens);
  }

  private encadear(chave: string, itens: ItemDaFila[]): void {
    const anterior = this.correntes.get(chave) ?? Promise.resolve();
    const proxima = anterior
      .then(() => this.comVaga(() => this.processarLote(itens)))
      .catch((error: unknown) => {
        this.deps.log.error({ error, chave }, '[bento-whatsapp] falha não tratada no lote');
      });
    this.correntes.set(chave, proxima);
    this.emVoo.add(proxima);
    void proxima.finally(() => {
      this.emVoo.delete(proxima);
      if (this.correntes.get(chave) === proxima) this.correntes.delete(chave);
    });
  }

  /** Teto global de turnos simultâneos: uma conversa lenta não trava as outras, e o custo tem limite. */
  private async comVaga<T>(tarefa: () => Promise<T>): Promise<T> {
    if (this.ativos >= this.deps.config.maxConcurrentTurns) {
      await new Promise<void>((resolve) => this.aguardandoVaga.push(resolve));
    }
    this.ativos += 1;
    try {
      return await tarefa();
    } finally {
      this.ativos -= 1;
      this.aguardandoVaga.shift()?.();
    }
  }

  /** Para testes e desligamento: espera tudo que está na fila terminar. */
  async ocioso(): Promise<void> {
    for (const chave of [...this.lotes.keys()]) {
      const lote = this.lotes.get(chave);
      if (lote) clearTimeout(lote.timer);
      this.liberarLote(chave);
    }
    while (this.emVoo.size) await Promise.all([...this.emVoo]);
  }

  /* ---------------------------------------------------------------- */
  /* Decisão                                                            */
  /* ---------------------------------------------------------------- */

  private async marcar(ids: string[], patch: AtualizacaoDoRecebido): Promise<void> {
    await Promise.all(ids.map((id) => this.deps.armazem.atualizar(id, patch)));
  }

  private async ignorar(ids: string[], motivo: string): Promise<void> {
    await this.marcar(ids, { status: 'ignored', reason: motivo, processedAt: this.agora() });
  }

  private async processarLote(itens: ItemDaFila[]): Promise<void> {
    const ids = itens.map((item) => item.id);
    const mensagem = itens[itens.length - 1]!.mensagem;
    const texto = itens
      .map((item) => item.mensagem.texto)
      .filter(Boolean)
      .join('\n');
    const inicio = this.agora();
    await this.marcar(ids, { status: 'processing', incrementarTentativas: true });
    try {
      await this.decidir(ids, mensagem, texto, inicio);
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.deps.log.error({ error, ids }, '[bento-whatsapp] turno falhou');
      await this.marcar(ids, { status: 'failed', error: motivo.slice(0, 500), processedAt: this.agora() }).catch(() => undefined);
      // Avisa sem expor o erro. Se nem isso sair, a linha fica 'failed' no painel.
      await this.enviar(ids[0]!, mensagem, [TEXTOS.falhaNaExecucao], 'falha').catch(() => undefined);
    }
  }

  private async decidir(ids: string[], mensagem: MensagemRecebida, texto: string, inicio: Date): Promise<void> {
    const { config, armazem, transporte } = this.deps;

    // 3. Grupo: só autorizado e só quando chamado. Calado nos outros casos.
    if (mensagem.isGroup) {
      if (!config.allowedGroups.includes(mensagem.chatId)) return this.ignorar(ids, 'group_not_allowed');
      const idsDoBento = [...(config.botPhone ? [`${config.botPhone}@c.us`] : []), ...config.botExtraIds];
      if (!mencionaOBento(mensagem, idsDoBento)) return this.ignorar(ids, 'group_not_mentioned');
    }

    // 4. Quem é. `@lid` (privacidade do WhatsApp) não tem telefone no id; o
    //    OpenWA resolve quando consegue. Sem telefone, não há como provar nada.
    const telefone =
      mensagem.telefone ?? (await transporte.resolvePhone(mensagem.remetenteJid).catch(() => null));
    if (!telefone) return this.ignorar(ids, 'sender_unresolved');
    if (config.botPhone && telefone === config.botPhone) return this.ignorar(ids, 'own_number');

    // Quarentena depois de conectar: o aparelho entrega histórico em rajada
    // (incidente de 19/10/2026) e nada disso é pedido de ninguém.
    if (!(await this.sessaoAquecida())) return this.ignorar(ids, 'sessao_aquecendo');

    let vinculo = await armazem.vinculoAtivoPorTelefone(telefone);
    if (!vinculo) {
      if (mensagem.isGroup) return this.ignorar(ids, 'group_participant_unlinked');
      const aberto = config.modoAberto && config.modoAberto.ate.getTime() > this.agora().getTime() ? config.modoAberto : null;
      // Código de vínculo continua valendo mesmo com o modo aberto ligado.
      if (!aberto || extrairCodigoDeVinculo(texto)) return this.atenderNaoVinculado(ids, mensagem, texto, telefone);
      vinculo = {
        id: `${PREFIXO_VIRTUAL}${telefone}`,
        userId: aberto.userId,
        organizationId: null,
        phone: telefone,
        chatId: mensagem.chatId,
        conversationId: this.conversasAbertas.get(telefone) ?? null,
        lastInboundAt: null,
      };
    }
    const virtual = vinculo.id.startsWith(PREFIXO_VIRTUAL);
    await this.marcar(ids, {
      ...(virtual ? {} : { linkId: vinculo.id }),
      userId: vinculo.userId,
      organizationId: vinculo.organizationId,
    });

    if (mensagem.isGroup) {
      // Preparado até aqui (grupo autorizado + menção + participante
      // identificado). Responder com dado de operação NUM GRUPO expõe o recorte
      // de quem perguntou para todos os presentes, e o Brain hoje não sabe que
      // a resposta vai para uma plateia. Até essa decisão existir, o Bento
      // chama para o privado.
      return this.responder(ids, mensagem, TEXTOS.grupoAindaNao, 'group_answers_not_enabled');
    }

    // 5. A pessoa por trás do vínculo, com o acesso que ela tem hoje.
    const usuario = await this.deps.carregarUsuario(vinculo.userId);
    if (usuario.tipo === 'inativo' || usuario.tipo === 'inexistente') {
      return this.responder(ids, mensagem, TEXTOS.contaInativa, 'user_inactive');
    }
    if (usuario.tipo === 'sem_permissao') return this.responder(ids, mensagem, TEXTOS.semPermissao, 'no_chat_permission');

    const ultimaAtividade = vinculo.lastInboundAt;
    if (!virtual) await armazem.tocarVinculo(vinculo.id, this.agora());

    // Áudio esperando "sim": a resposta da pessoa decide o destino dele.
    const pendente = virtual
      ? null
      : await armazem.aguardandoConfirmacao(vinculo.id, new Date(this.agora().getTime() - JANELA_DE_CONFIRMACAO_MS));
    let textoDoTurno: string | null = null;
    if (pendente) {
      if (pendente.text && mensagem.tipo === 'text' && /^\s*(sim|s|confirmo|isso|pode|ok|pode seguir)\b/i.test(texto)) {
        await armazem.atualizar(pendente.id, { status: 'confirmed', processedAt: this.agora() });
        textoDoTurno = pendente.text;
      } else {
        await armazem.atualizar(pendente.id, { status: 'ignored', reason: 'audio_not_confirmed' });
        if (mensagem.tipo === 'text' && /^\s*(n[ãa]o|n|cancela|cancelar|esquece)\b/i.test(texto)) {
          return this.responder(ids, mensagem, TEXTOS.audioDescartado, 'audio_cancelled');
        }
      }
    }

    // Conteúdo do turno.
    let anexos: AnexoDoTurno[] = [];
    if (textoDoTurno === null) {
      const conteudo = await this.conteudoDoTurno(ids, mensagem, texto, usuario.user, vinculo);
      if (!conteudo) return;
      textoDoTurno = conteudo.texto;
      anexos = conteudo.anexos;
    }

    // Modo teste aberto: o remetente NÃO está provado, então nada de ação de
    // escrita (criar, mudar, apagar). Heurística de texto — melhor esforço, não
    // garantia; por isso o modo tem prazo e é desligável no painel.
    if (virtual && pareceAcaoDeEscrita(textoDoTurno)) {
      return this.responder(ids, mensagem, TEXTOS.modoTesteSoConsulta, 'open_mode_write_blocked');
    }

    // 6. Limite de uso por pessoa (o custo de cada turno é do Brain inteiro).
    const turnos = await armazem.turnosDoUsuario(vinculo.userId, new Date(this.agora().getTime() - UMA_HORA));
    if (turnos >= config.maxTurnsPerHour) return this.responder(ids, mensagem, TEXTOS.limiteDeUso, 'rate_limited');

    // Conversa parada há muito tempo começa do zero: a "seleção" do turno
    // anterior (o referente de "a primeira") de ontem não é o que a pessoa
    // quer dizer hoje.
    const ocioso =
      ultimaAtividade && this.agora().getTime() - ultimaAtividade.getTime() > config.conversationIdleHours * UMA_HORA;
    const conversationId = ocioso ? null : vinculo.conversationId;

    await this.levarAoBrain(ids, mensagem, usuario.user, vinculo, conversationId, textoDoTurno, anexos, inicio);
  }

  private async atenderNaoVinculado(
    ids: string[],
    mensagem: MensagemRecebida,
    texto: string,
    telefone: string,
  ): Promise<void> {
    const { armazem } = this.deps;
    const codigo = extrairCodigoDeVinculo(texto);
    if (codigo) {
      const tentativas = await armazem.tentativasDeCodigo(telefone, new Date(this.agora().getTime() - UMA_HORA));
      if (tentativas >= MAX_TENTATIVAS_DE_CODIGO_POR_HORA) {
        return this.responder(ids, mensagem, TEXTOS.muitasTentativas, 'link_code_rate_limited');
      }
      const resultado = await armazem.reivindicarCodigo(codigo, telefone, mensagem.chatId, this.agora());
      if (resultado.tipo === 'reivindicado') {
        await this.marcar(ids, { userId: resultado.userId });
        return this.responder(ids, mensagem, TEXTOS.codigoRecebido(telefone), 'link_code_claimed');
      }
      if (resultado.tipo === 'numero_ja_vinculado') {
        return this.responder(ids, mensagem, TEXTOS.numeroJaVinculado, 'link_code_phone_taken');
      }
      return this.responder(ids, mensagem, TEXTOS.codigoInvalido, 'link_code_invalid');
    }
    /**
     * SILÊNCIO com quem não está vinculado (19/10/2026, depois do incidente).
     *
     * Antes o Bento respondia "ainda não reconheço este número" a qualquer
     * remetente. Ao conectar o aparelho, o OpenWA entregou uma rajada de
     * mensagens e o Bento mandou esse aviso a 24 contatos diferentes em um
     * minuto. O Bento só fala com quem está vinculado — ou com quem manda um
     * código de vínculo, que é um pedido explícito e de formato inconfundível.
     * Qualquer outra coisa de número desconhecido é registrada e ignorada.
     */
    return this.ignorar(ids, 'unlinked_silent');
  }

  private async conteudoDoTurno(
    ids: string[],
    mensagem: MensagemRecebida,
    texto: string,
    user: AuthenticatedUser,
    vinculo: Vinculo,
  ): Promise<{ texto: string; anexos: AnexoDoTurno[] } | null> {
    const { config, armazem } = this.deps;
    switch (mensagem.tipo) {
      case 'text': {
        const atalho = interpretarAtalho(texto);
        if (atalho?.tipo === 'ajuda') {
          await this.responder(ids, mensagem, TEXTOS.ajuda, 'help');
          return null;
        }
        if (atalho?.tipo === 'nova_conversa') {
          await this.salvarConversa(vinculo, null);
          await this.responder(ids, mensagem, TEXTOS.novaConversa, 'new_conversation');
          return null;
        }
        const final = atalho?.tipo === 'pergunta' ? atalho.texto : texto;
        if (!final.trim()) {
          await this.ignorar(ids, 'empty');
          return null;
        }
        return { texto: final, anexos: [] };
      }

      case 'audio': {
        if (!this.deps.transcritor) {
          await this.responder(ids, mensagem, TEXTOS.audioSemTranscricao, 'audio_unsupported');
          return null;
        }
        let transcricao;
        try {
          const audio = await this.obterMidia(mensagem, MAX_AUDIO_BYTES);
          transcricao = await this.deps.transcritor.transcrever(audio, mensagem.midia?.mimetype ?? 'audio/ogg');
        } catch (error) {
          this.deps.log.warn({ error, ids }, '[bento-whatsapp] transcrição falhou');
          await this.responder(ids, mensagem, TEXTOS.audioFalhou, 'audio_transcription_failed');
          return null;
        }
        const baixaConfianca = transcricao.confianca !== null && transcricao.confianca < CONFIANCA_MINIMA;
        if (!transcricao.texto || baixaConfianca) {
          await this.responder(ids, mensagem, TEXTOS.audioFalhou, 'audio_low_confidence');
          return null;
        }
        await this.marcar(ids, { text: transcricao.texto });
        // Pedido de ação vindo de áudio: confirma o TEXTO antes. "Apaga" que
        // era "acha" não vira tarefa apagada.
        if (!vinculo.id.startsWith(PREFIXO_VIRTUAL) && pareceAcaoDeEscrita(transcricao.texto)) {
          await this.responder(ids, mensagem, TEXTOS.audioConfirmar(transcricao.texto), 'audio_needs_confirmation', 'awaiting_confirmation');
          return null;
        }
        return { texto: transcricao.texto, anexos: [] };
      }

      case 'document': {
        if (!config.documentsEnabled || !this.deps.guardarAnexo) {
          await this.responder(ids, mensagem, TEXTOS.documentoNaoSuportado, 'document_disabled');
          return null;
        }
        const mimetype = (mensagem.midia?.mimetype ?? '').split(';')[0]!.trim().toLowerCase();
        if (!DOCUMENTOS_LIDOS.has(mimetype)) {
          await this.responder(ids, mensagem, TEXTOS.documentoTipoNaoSuportado, 'document_type_unsupported');
          return null;
        }
        if ((mensagem.midia?.sizeBytes ?? 0) > MAX_DOCUMENTO_BYTES) {
          await this.responder(ids, mensagem, TEXTOS.documentoGrande, 'document_too_large');
          return null;
        }
        let bytes: Buffer;
        try {
          bytes = await this.obterMidia(mensagem, MAX_DOCUMENTO_BYTES);
        } catch (error) {
          const grande = error instanceof OpenwaError && error.code === 'TOO_LARGE';
          await this.responder(ids, mensagem, grande ? TEXTOS.documentoGrande : TEXTOS.documentoNaoSuportado, 'document_download_failed');
          return null;
        }
        const filename = (mensagem.midia?.filename ?? 'arquivo').replace(/[^\w.\- ]+/g, '_').slice(0, 120);
        const anexo = await this.deps.guardarAnexo({ userId: user.id, filename, mimetype, bytes });
        return { texto: texto || `Arquivo enviado pelo WhatsApp: ${filename}`, anexos: [anexo] };
      }

      case 'image': {
        // Mesmo tratamento do upload do chat web: a imagem vira anexo do
        // turno. Quem lê imagem é o agente que o roteamento escolher; o canal
        // não finge que viu.
        if (!config.documentsEnabled || !this.deps.guardarAnexo) {
          await this.responder(ids, mensagem, TEXTOS.imagemNaoSuportada, 'image_disabled');
          return null;
        }
        const mimetype = (mensagem.midia?.mimetype ?? 'image/jpeg').split(';')[0]!.trim().toLowerCase();
        if (!mimetype.startsWith('image/') || mimetype === 'image/svg+xml') {
          await this.responder(ids, mensagem, TEXTOS.imagemNaoSuportada, 'image_type_unsupported');
          return null;
        }
        let bytes: Buffer;
        try {
          bytes = await this.obterMidia(mensagem, MAX_IMAGEM_BYTES);
        } catch {
          await this.responder(ids, mensagem, TEXTOS.imagemNaoSuportada, 'image_download_failed');
          return null;
        }
        const extensao = mimetype.split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'jpg';
        const filename = (mensagem.midia?.filename ?? `imagem-whatsapp.${extensao}`).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
        const anexo = await this.deps.guardarAnexo({ userId: user.id, filename, mimetype, bytes });
        return { texto: texto || `Imagem enviada pelo WhatsApp: ${filename}`, anexos: [anexo] };
      }

      default:
        await this.responder(ids, mensagem, TEXTOS.midiaNaoSuportada, 'media_unsupported');
        return null;
    }
  }

  private async obterMidia(mensagem: MensagemRecebida, maxBytes: number): Promise<Buffer> {
    if (mensagem.midia?.base64) {
      const bytes = Buffer.from(mensagem.midia.base64, 'base64');
      if (bytes.byteLength > maxBytes) throw new OpenwaError('mídia grande demais', 413, 'TOO_LARGE');
      return bytes;
    }
    return this.deps.transporte.downloadMedia({ chatId: mensagem.chatId, messageId: mensagem.waMessageId, maxBytes });
  }

  /* ---------------------------------------------------------------- */
  /* Brain                                                              */
  /* ---------------------------------------------------------------- */

  private async levarAoBrain(
    ids: string[],
    mensagem: MensagemRecebida,
    user: AuthenticatedUser,
    vinculo: Vinculo,
    conversationId: string | null,
    texto: string,
    anexos: AnexoDoTurno[],
    inicio: Date,
  ): Promise<void> {
    const { config, transporte, armazem, brain } = this.deps;
    await this.marcar(ids, { text: texto });
    void transporte.markRead({ chatId: mensagem.chatId, messageIds: [mensagem.waMessageId] }).catch(() => undefined);
    void transporte.setTyping({ chatId: mensagem.chatId, state: 'typing' }).catch(() => undefined);

    // O indicador de "digitando" do WhatsApp apaga sozinho em ~25s; renova
    // enquanto o Brain trabalha. E UMA mensagem de andamento, se demorar.
    const renovar = setInterval(() => {
      void transporte.setTyping({ chatId: mensagem.chatId, state: 'typing' }).catch(() => undefined);
    }, 20_000);
    const andamento = setTimeout(() => {
      void this.enviar(ids[0]!, mensagem, [TEXTOS.andamento], 'andamento').catch(() => undefined);
    }, config.progressNoticeMs);

    let resposta: RespostaDoBrain;
    try {
      const perguntar = (conversa: string | null) =>
        brain.perguntar(
          { user, conversationId: conversa, mensagem: texto, anexos, agente: config.agentHint },
          {
            prazoMs: config.replyTimeoutMs,
            aoDespachar: async (despacho) => {
              await this.marcar(ids, {
                status: 'dispatched',
                conversationId: despacho.conversationId,
                executionId: despacho.executionId,
              });
              if (despacho.conversationId !== vinculo.conversationId) {
                await this.salvarConversa(vinculo, despacho.conversationId);
              }
            },
          },
        );
      resposta = await perguntar(conversationId);
      // A conversa guardada sumiu ou mudou de dono/empresa: abre outra em vez
      // de falhar. Só quando havia conversa — sem ela o erro é outro.
      if (resposta.tipo === 'conversa_invalida' && conversationId) {
        this.deps.log.warn({ ids, motivo: resposta.motivo }, '[bento-whatsapp] conversa do vínculo inválida; abrindo outra');
        await this.salvarConversa(vinculo, null);
        resposta = await perguntar(null);
      }
    } finally {
      clearInterval(renovar);
      clearTimeout(andamento);
      void transporte.setTyping({ chatId: mensagem.chatId, state: 'paused' }).catch(() => undefined);
    }

    const latencyMs = this.agora().getTime() - inicio.getTime();
    switch (resposta.tipo) {
      case 'resposta': {
        // Quem respondeu não foi o Bento (o roteamento é o da web): diz quem
        // foi, como a web mostra o avatar do agente no balão.
        const outro = resposta.agente && resposta.agente !== 'bento' ? NOMES_DOS_AGENTES[resposta.agente] ?? resposta.agente : null;
        const texto = outro ? `*${outro}:*\n\n${resposta.texto}` : resposta.texto;
        return this.responder(ids, mensagem, texto, null, 'replied', latencyMs, true);
      }
      case 'falhou':
        this.deps.log.warn({ ids, motivo: resposta.motivo }, '[bento-whatsapp] Brain terminou sem resposta');
        await this.marcar(ids, { error: resposta.motivo.slice(0, 500) });
        return this.responder(ids, mensagem, TEXTOS.falhaNaExecucao, 'brain_failed', 'replied', latencyMs);
      case 'demorou':
        return this.responder(ids, mensagem, TEXTOS.demorou, 'brain_timeout', 'replied', latencyMs);
      case 'indisponivel':
        this.deps.log.error({ ids, motivo: resposta.motivo }, '[bento-whatsapp] Brain indisponível');
        await this.marcar(ids, { error: resposta.motivo.slice(0, 500) });
        return this.responder(ids, mensagem, TEXTOS.brainIndisponivel, 'brain_unavailable', 'replied', latencyMs);
      case 'conversa_invalida':
        await this.marcar(ids, { error: resposta.motivo.slice(0, 500) });
        return this.responder(ids, mensagem, TEXTOS.falhaNaExecucao, 'conversation_invalid', 'replied', latencyMs);
      case 'duplicado':
        // O mesmo texto já está em processamento nesta conversa: a resposta
        // dele chega pela primeira mensagem. Responder aqui seria duplicar.
        return this.ignorar(ids, 'duplicate_turn');
    }
  }

  /* ---------------------------------------------------------------- */
  /* Saída                                                              */
  /* ---------------------------------------------------------------- */

  private async responder(
    ids: string[],
    mensagem: MensagemRecebida,
    texto: string,
    motivo: string | null,
    status = 'replied',
    latencyMs?: number,
    doBrain = false,
  ): Promise<void> {
    const partes = doBrain ? formatarParaWhatsapp(texto) : [texto];
    try {
      const enviados = await this.enviar(ids[0]!, mensagem, partes, 'resposta');
      await this.marcar(ids, {
        status,
        reason: motivo,
        replyMessageIds: enviados,
        processedAt: this.agora(),
        repliedAt: this.agora(),
        ...(latencyMs !== undefined ? { latencyMs } : {}),
      });
    } catch (error) {
      const enviados = error instanceof ErroDeEnvio ? error.enviados : [];
      const detalhe = error instanceof Error ? error.message : String(error);
      this.deps.log.error({ error, ids, enviados: enviados.length }, '[bento-whatsapp] envio falhou');
      // A resposta existe (está na conversa do chat, visível na web); o que
      // falhou foi a entrega. 'send_failed' deixa isso explícito no painel.
      await this.marcar(ids, {
        status: 'send_failed',
        reason: motivo,
        error: detalhe.slice(0, 500),
        replyMessageIds: enviados,
        processedAt: this.agora(),
        ...(latencyMs !== undefined ? { latencyMs } : {}),
      });
    }
  }

  /**
   * Envia com chave de idempotência por (mensagem recebida, rótulo, parte): um
   * retry depois de timeout devolve a mesma mensagem já enviada em vez de
   * mandar outra — "resultado incerto" vira "verifica antes de repetir" sem
   * consulta extra.
   */
  /** Conversas para as quais saiu mensagem no último minuto (disjuntor de saída). */
  private readonly saidas = new Map<string, number>();
  private travadoAte = 0;

  /**
   * DISJUNTOR DE SAÍDA. O Bento responde a quem escreve; nunca dispara para
   * muita gente ao mesmo tempo. Se, por qualquer bug ou rajada, o envio
   * tentar alcançar mais de 5 conversas diferentes em 1 minuto, tudo trava
   * por 15 minutos e fica registrado como erro — melhor perder respostas do
   * que repetir o que aconteceu em 19/10/2026.
   */
  private autorizarSaida(chatId: string): void {
    const agora = this.agora().getTime();
    if (agora < this.travadoAte) throw new ErroDeEnvio('envio travado pelo disjuntor de saída', []);
    for (const [chat, quando] of this.saidas) if (agora - quando > 60_000) this.saidas.delete(chat);
    if (!this.saidas.has(chatId) && this.saidas.size >= MAX_CONVERSAS_NOVAS_POR_MINUTO) {
      this.travadoAte = agora + TRAVA_DE_SAIDA_MS;
      this.deps.log.error(
        { conversas: this.saidas.size + 1 },
        '[bento-whatsapp] DISJUNTOR DE SAÍDA ACIONADO: envio para conversas demais em 1 minuto; envios travados por 15 min',
      );
      throw new ErroDeEnvio('envio travado pelo disjuntor de saída', []);
    }
    this.saidas.set(chatId, agora);
  }

  private async enviar(idBase: string, mensagem: MensagemRecebida, partes: string[], rotulo: string): Promise<string[]> {
    this.autorizarSaida(mensagem.chatId);
    const enviados: string[] = [];
    for (let i = 0; i < partes.length; i++) {
      let ultimoErro: unknown;
      let ok = false;
      for (let tentativa = 0; tentativa < 3 && !ok; tentativa++) {
        try {
          const enviado = await this.deps.transporte.sendText({
            chatId: mensagem.chatId,
            text: partes[i]!,
            idempotencyKey: `bento-whatsapp:${idBase}:${rotulo}:${i}`,
            ...(mensagem.isGroup && i === 0 ? { quotedMessageId: mensagem.waMessageId } : {}),
          });
          enviados.push(enviado.messageId);
          ok = true;
        } catch (error) {
          ultimoErro = error;
          const repetivel = error instanceof OpenwaError ? error.retryable : true;
          if (!repetivel) break;
          await this.esperar(1_000 * 3 ** tentativa);
        }
      }
      if (!ok) {
        const detalhe = ultimoErro instanceof Error ? ultimoErro.message : String(ultimoErro);
        throw new ErroDeEnvio(detalhe, enviados);
      }
    }
    return enviados;
  }

  /* ---------------------------------------------------------------- */
  /* Recuperação                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Na subida: o que ficou no meio do caminho não some calado.
   *
   *   dispatched  o Brain já recebeu → volta a esperar a resposta e entrega.
   *               NUNCA reenvia ao Brain: seria executar a ação duas vezes.
   *   received /  não se sabe se chegou ao Brain → não arrisca repetir; avisa
   *   processing  a pessoa (se ela tem vínculo) para mandar de novo.
   *
   * A chave de idempotência do envio cobre a corrida com outra instância que
   * ainda esteja trabalhando no mesmo registro.
   */
  async retomar(): Promise<{ retomados: number; avisados: number }> {
    const { armazem, brain, config } = this.deps;
    const inacabadas = await armazem.inacabadas(new Date(this.agora().getTime() - JANELA_DE_RETOMADA_MS));
    let retomados = 0;
    let avisados = 0;
    for (const registro of inacabadas) {
      const destino: MensagemRecebida = {
        dedupeKey: '',
        sessionId: config.sessionId ?? '',
        waMessageId: registro.waMessageId,
        chatId: registro.chatId,
        remetenteJid: registro.chatId,
        telefone: registro.senderPhone,
        isGroup: registro.chatId.endsWith('@g.us'),
        tipo: 'text',
        texto: registro.text ?? '',
        midia: null,
        mencoes: [],
        citadaId: null,
        enviadaEm: null,
      };
      if (registro.status === 'dispatched' && registro.conversationId) {
        retomados += 1;
        const tarefa = (async () => {
          const resposta = await brain.aguardar(
            { conversationId: registro.conversationId!, executionId: registro.executionId, desde: registro.createdAt },
            config.replyTimeoutMs,
          );
          if (resposta.tipo === 'resposta') {
            await this.responder([registro.id], destino, resposta.texto, 'resumed', 'replied', undefined, true);
          } else {
            await this.responder([registro.id], destino, TEXTOS.interrompido, `resumed_${resposta.tipo}`);
          }
        })().catch((error: unknown) => this.deps.log.error({ error, id: registro.id }, '[bento-whatsapp] retomada falhou'));
        this.emVoo.add(tarefa);
        void tarefa.finally(() => this.emVoo.delete(tarefa));
        continue;
      }
      const temVinculo =
        !destino.isGroup && registro.senderPhone
          ? Boolean(await armazem.vinculoAtivoPorTelefone(registro.senderPhone))
          : false;
      if (temVinculo) {
        avisados += 1;
        await this.responder([registro.id], destino, TEXTOS.interrompido, 'interrupted', 'failed');
      } else {
        await this.ignorar([registro.id], 'interrupted_unlinked');
      }
    }
    return { retomados, avisados };
  }
}
