import { telefoneLegivel } from './identity';

/**
 * As frases que o CANAL diz por conta própria. Tudo o que é sobre operação,
 * cliente ou tarefa vem do Brain — aqui só mora o que é sobre o canal:
 * vínculo, limite, falha de infraestrutura.
 *
 * Regra de redação: dizer o que aconteceu e o que a pessoa pode fazer. Nunca
 * "erro interno", nunca stack, nunca prometer o que não foi feito.
 */
export const TEXTOS = {
  naoVinculado:
    'Oi! Ainda não reconheço este número. Para conversar comigo por aqui, entre no Desigual OS, ' +
    'abra *Integrações > Bento no WhatsApp* e toque em *Vincular meu WhatsApp*. Depois é só me mandar o código que aparecer.',

  codigoRecebido: (telefone: string) =>
    `Recebi seu código. Agora confirme no Desigual OS que o número ${telefoneLegivel(telefone)} é seu — ` +
    'o vínculo só vale depois dessa confirmação.',

  codigoInvalido:
    'Esse código não é válido ou já expirou. Gere um novo no Desigual OS, em *Integrações > Bento no WhatsApp*.',

  numeroJaVinculado:
    'Este número já está vinculado a uma conta do Desigual OS. Se ele mudou de dono, peça a um administrador para revogar o vínculo antigo.',

  muitasTentativas: 'Foram muitas tentativas de código seguidas. Espere um pouco e gere um código novo no Desigual OS.',

  contaInativa:
    'Sua conta no Desigual OS está desativada, então não consigo atender por aqui. Fale com um administrador.',

  semPermissao: 'Sua conta não tem permissão para usar o chat dos agentes. Fale com um administrador.',

  limiteDeUso: 'Recebi muitas mensagens suas em pouco tempo. Me dá uns minutos e manda de novo?',

  ajuda:
    '*Bento no WhatsApp*\n\n' +
    'Pode falar comigo do jeito que falaria no Desigual OS: "o que tenho pra hoje?", "quais tarefas estão atrasadas?", ' +
    '"me explica o processo de aprovação".\n\n' +
    'Atalhos (opcionais):\n' +
    '- /tarefas: suas tarefas abertas\n' +
    '- /status: panorama da operação\n' +
    '- /resumo: suas prioridades de hoje\n' +
    '- /novo: começar uma conversa do zero\n\n' +
    'Respondo com o mesmo acesso que você tem no Desigual OS.',

  novaConversa: 'Pronto, começamos do zero. O que você precisa?',

  andamento: 'Estou consultando os dados para te responder com informação atualizada. Já volto.',

  demorou:
    'Essa consulta está demorando mais que o normal. A resposta vai aparecer no chat do Desigual OS assim que ficar pronta; ' +
    'se for urgente, me pergunte de novo daqui a pouco.',

  brainIndisponivel:
    'Não consegui processar seu pedido agora: o serviço que me faz pensar está fora do ar. Nada foi executado. Tente de novo em alguns minutos.',

  falhaNaExecucao:
    'Tive um problema ao processar seu pedido e não consegui concluir. Se era uma ação (criar ou mudar tarefa), confira no ClickUp antes de pedir de novo — não confirmo o que não consegui verificar.',

  semConversaRetomavel:
    'Não consegui continuar nossa conversa anterior, então abri uma nova. Pode repetir o que precisa?',

  audioSemTranscricao:
    'Ainda não consigo ouvir áudio por aqui. Pode me mandar por escrito?',

  audioFalhou: 'Não consegui entender o áudio. Pode mandar de novo, ou por escrito?',

  audioConfirmar: (transcricao: string) =>
    `Entendi assim: "${transcricao}"\n\nComo isso mexe em tarefa, confirma antes de eu seguir? Responda *sim* para continuar.`,

  audioDescartado: 'Tudo bem, não fiz nada. Pode mandar de novo quando quiser.',

  imagemNaoSuportada:
    'Recebi a imagem, mas ainda não consigo ver imagens por aqui. Se tiver texto importante nela, me manda escrito.',

  documentoNaoSuportado:
    'Recebi o arquivo, mas não consigo ler anexos pelo WhatsApp ainda. Se puder, anexe no chat do Desigual OS.',

  documentoTipoNaoSuportado:
    'Consigo ler PDF, Word, PowerPoint, TXT, Markdown e CSV. Esse formato eu não leio.',

  documentoGrande: 'Esse arquivo é grande demais para eu ler por aqui (limite de 10 MB).',

  grupoAindaNao:
    'Em grupo eu ainda não respondo com dados da operação — me chama no privado que eu te ajudo por lá.',

  interrompido:
    'Tive uma falha e não consegui responder sua última mensagem. Pode mandar de novo? Se você tinha pedido uma ação, confira no ClickUp antes — não confirmo o que não consegui verificar.',

  midiaNaoSuportada: 'Por enquanto só consigo responder texto por aqui. Pode me mandar por escrito?',
} as const;
