import { urlPublicaDoApp } from './url-do-app';

const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * email.ts — os e-mails transacionais do Desigual OS, com a cara do Desigual OS.
 *
 * O QUE ESTAVA ERRADO, e é visível no primeiro convite que alguém recebe:
 *
 *  1. O LOGO SUMIA. O asset da marca é o lettering BRANCO com transparência (o
 *     "desigual" branco, o "O" lima, o "S" roxo) — o mesmo que a barra lateral
 *     usa sobre o fundo escuro. O template colocava ele num cartão claro
 *     (#FAFAF7): sobrava o "OS" colorido e a palavra "desigual" desaparecia.
 *     Um e-mail de identidade visual sem a identidade visual.
 *  2. QUASE 4 MB DE IMAGEM. Logo de 2172px para exibir a 160px (1 MB) e uma
 *     imagem quadrada de 1536x1024 usada como faixa (2,9 MB). Gmail e Outlook
 *     baixam isso por proxy antes de pintar, e num 4G ruim a pessoa lê o corpo
 *     do e-mail sem marca nenhuma. Os assets novos são os MESMOS, no tamanho
 *     em que de fato aparecem e com 2x de retina: 38 KB e 152 KB.
 *  3. O PRODUTO É ESCURO, o e-mail era claro. Carbono, grafite, roxo elétrico
 *     e o lima de sinal são o vocabulário da tela (ver styles/tokens.css); o
 *     e-mail usava cartão branco e botão lima com texto preto, que não é botão
 *     de ação em lugar nenhum do produto — lá o botão de ação é roxo.
 *  4. TRÊS CÓPIAS DO MESMO HTML. Convite, redefinição de senha e "você foi
 *     adicionado" repetiam a estrutura inteira. O comentário antigo já dizia
 *     que a ideia era um corpo só; agora é mesmo — `montarEmail` abaixo.
 *
 * Técnica de e-mail, que é um alvo diferente de uma página: tabelas em vez de
 * flex, estilo inline em vez de classes, nada de CSS externo, largura fixa de
 * 600px, e `color-scheme` declarado para o cliente não inverter um desenho que
 * já nasceu escuro. Toda mensagem vai também em texto puro — além de ser o que
 * leitores de tela e clientes antigos mostram, é o que separa um transacional
 * legítimo de spam para os filtros.
 */

/** Os mesmos tokens de styles/tokens.css. Hex literal porque e-mail não tem variável CSS. */
const CARBONO = '#0F0F0F';
const GRAFITE = '#1C1C1E';
const GRAFITE_ELEVADO = '#2A2A2E';
const BRANCO_CRU = '#FAFAF7';
const NEVOA = '#A1A1AA';
const NEVOA_FRACA = '#6B6B72';
const ROXO_ELETRICO = '#9333EA';
const SINAL = '#E1F900';

const LOGO_URL = 'https://dddchncdrgbhdirytdsp.supabase.co/storage/v1/object/public/user-uploads/branding/email-logo-320.png';
const HERO_URL = 'https://dddchncdrgbhdirytdsp.supabase.co/storage/v1/object/public/user-uploads/branding/email-hero-1200.jpg';

const ROLE_LABEL: Record<string, string> = {
  master: 'Administrador',
  colaborador: 'Colaborador',
  // Papéis de EMPRESA (convites de organização, organization_invites.role).
  owner: 'Responsável pela empresa',
  admin: 'Administrador da empresa',
  collaborator: 'Colaborador',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

/** Tira as tags de um parágrafo para a versão em texto puro — os parágrafos
 *  são escritos uma vez só, em HTML, e o texto deriva deles. Duas redações
 *  separadas divergem; uma derivada da outra, não. */
function semTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

interface ConteudoDoEmail {
  /** Linha curta em maiúsculas sobre o título — o mesmo papel do `font-mono
   *  text-[10px] uppercase tracking-wider` que a interface usa. */
  sobretitulo: string;
  titulo: string;
  /** Já em HTML, com `escapeHtml` aplicado pelo chamador no que vem de fora. */
  paragrafos: string[];
  botao: { texto: string; href: string };
  /** `true` quando o link é de uso único e vale repetir em texto (convite,
   *  redefinição). Para um link que é só "abra o app", repetir é ruído. */
  mostrarLinkCru: boolean;
  rodape: string;
}

function montarEmail(conteudo: ConteudoDoEmail): string {
  const { sobretitulo, titulo, paragrafos, botao, mostrarLinkCru, rodape } = conteudo;

  // Texto de prévia: o que o Gmail mostra na lista, ao lado do assunto. Sem
  // ele, o cliente usa a primeira coisa que encontrar no corpo — que aqui
  // seria o alt do logo.
  const previa = semTags(paragrafos[0] ?? '').slice(0, 140);

  return `
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>${escapeHtml(titulo)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:${CARBONO};color:${BRANCO_CRU};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${escapeHtml(previa)}</div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARBONO}" style="background-color:${CARBONO};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border-collapse:separate;">

            <!-- FAIXA DA MARCA: a imagem é o recorte em banner (3,2:1), não a
                 peça quadrada inteira — uma faixa apresenta, um bloco de 400px
                 de altura atrasa a leitura. -->
            <tr>
              <td style="line-height:0;font-size:0;">
                <img src="${HERO_URL}" width="600" height="188" alt="" style="display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;text-decoration:none;border-radius:14px 14px 0 0;" />
              </td>
            </tr>
            <!-- O fio lima: o acento da marca, em 3px, sem custar requisição. -->
            <tr>
              <td bgcolor="${SINAL}" style="background-color:${SINAL};line-height:0;font-size:0;height:3px;">&nbsp;</td>
            </tr>

            <tr>
              <td bgcolor="${GRAFITE}" style="background-color:${GRAFITE};border:1px solid ${GRAFITE_ELEVADO};border-top:0;border-radius:0 0 14px 14px;padding:36px 32px 32px 32px;">

                <img src="${LOGO_URL}" width="160" height="53" alt="desigual OS" style="display:block;width:160px;height:auto;margin:0 0 28px 0;border:0;outline:none;" />

                <p style="margin:0 0 10px 0;font-size:11px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;color:${SINAL};">${escapeHtml(sobretitulo)}</p>
                <h1 style="margin:0 0 18px 0;font-size:24px;line-height:1.25;font-weight:bold;color:${BRANCO_CRU};">${escapeHtml(titulo)}</h1>

                ${paragrafos
                  .map((p) => `<p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:${NEVOA};">${p}</p>`)
                  .join('\n                ')}

                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 8px 0;">
                  <tr>
                    <td bgcolor="${ROXO_ELETRICO}" style="background-color:${ROXO_ELETRICO};border-radius:8px;">
                      <a href="${botao.href}" style="display:inline-block;padding:14px 30px;font-size:15px;font-weight:bold;color:#FFFFFF;text-decoration:none;border-radius:8px;">${escapeHtml(botao.texto)}</a>
                    </td>
                  </tr>
                </table>

                ${
                  mostrarLinkCru
                    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:22px;">
                  <tr><td height="1" bgcolor="${GRAFITE_ELEVADO}" style="background-color:${GRAFITE_ELEVADO};line-height:0;font-size:0;">&nbsp;</td></tr>
                </table>
                <p style="margin:18px 0 0 0;font-size:12px;line-height:1.6;color:${NEVOA_FRACA};">
                  Se o botão não funcionar, copie este endereço e cole no navegador:<br />
                  <a href="${botao.href}" style="color:${NEVOA};word-break:break-all;text-decoration:underline;">${escapeHtml(botao.href)}</a>
                </p>`
                    : ''
                }

                <p style="margin:22px 0 0 0;font-size:12px;line-height:1.6;color:${NEVOA_FRACA};">${rodape}</p>
              </td>
            </tr>

            <tr>
              <td align="center" style="padding:20px 8px 0 8px;">
                <p style="margin:0;font-size:11px;line-height:1.6;color:${NEVOA_FRACA};">
                  Desigual OS &middot; o sistema de orquestração de IA da Agência Desigual
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

/** A mesma mensagem em texto puro, derivada do mesmo conteúdo. */
function montarTexto(conteudo: ConteudoDoEmail): string {
  return [
    conteudo.titulo,
    '',
    ...conteudo.paragrafos.map(semTags),
    '',
    `${conteudo.botao.texto}: ${conteudo.botao.href}`,
    '',
    semTags(conteudo.rodape),
    '',
    ',  Desigual OS',
  ].join('\n');
}

/**
 * Um único lugar que fala com o Resend: assunto, HTML e texto sempre juntos.
 *
 * Devolve o id do envio porque HTTP 200 aqui NÃO significa entrega — ver
 * `conferirEntrega` logo abaixo.
 */
async function enviar(params: { to: string; subject: string; conteudo: ConteudoDoEmail }): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error('RESEND_API_KEY/RESEND_FROM_EMAIL not configured on the Orchestrator');
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: params.to,
      subject: params.subject,
      html: montarEmail(params.conteudo),
      text: montarTexto(params.conteudo),
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend email send failed (${response.status}): ${await response.text()}`);
  }

  /**
   * `try` em vez de `.catch()`: se `json` não for função — resposta sem corpo,
   * proxy no caminho, mock de teste — a CHAMADA lança de forma síncrona e
   * nenhum `.catch()` encadeado chega a existir. Sem o id a conferência de
   * entrega é pulada, e isso é aceitável: o e-mail já foi aceito, e não saber
   * o estado dele nunca pode derrubar um convite.
   */
  try {
    const corpo = (await response.json()) as { id?: string } | null;
    return corpo?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * O 200 do Resend é "aceitei a requisição", não "a pessoa recebeu".
 *
 * O caso que motivou isto, medido no log da conta em 08/10/2026: um convite
 * para um endereço que não existe VOLTOU (`bounced` às 13:01). O Resend então
 * colocou o endereço na lista de supressão dele e, no envio seguinte às 13:02,
 * respondeu 200 com um id normal e **descartou a mensagem** (`suppressed`).
 * Para a API os dois envios foram idênticos e bem-sucedidos. A tela disse
 * "convite enviado" nas duas vezes. Nada chegou nas duas vezes.
 *
 * O efeito colateral disso é pior que o silêncio: como o único convite que de
 * fato caiu numa caixa de entrada naquele dia foi um endereçado ao próprio
 * administrador, a leitura natural virou "o sistema está mandando tudo pro meu
 * e-mail" — um diagnóstico errado que custa caro, porque manda procurar o
 * defeito num lugar onde ele não está (o `to` sempre foi respeitado).
 *
 * `suppressed` é detectável NA HORA: o Resend já sabe que o endereço está na
 * lista antes de tentar entregar. `bounced` é assíncrono (segundos a minutos)
 * e esta checagem não promete pegá-lo — por isso ela responde o que viu, e
 * quem chama decide. Falha de rede aqui devolve `null`: não saber o estado da
 * entrega nunca pode derrubar um convite que já foi criado.
 */
export async function conferirEntrega(id: string): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(`${RESEND_API_URL}/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const corpo = (await res.json()) as { last_event?: string } | null;
    return corpo?.last_event ?? null;
  } catch {
    return null;
  }
}

/** Estados em que o provedor aceitou a chamada mas a mensagem não vai chegar. */
export function entregaFalhou(evento: string | null): boolean {
  return evento === 'suppressed' || evento === 'bounced' || evento === 'failed';
}

export async function sendInviteEmail(params: {
  to: string;
  name: string | null;
  role: string;
  inviteLink: string;
  organizationName?: string | null;
}): Promise<string | null> {
  const saudacao = params.name ? `Olá, ${escapeHtml(params.name)}.` : 'Olá.';
  const papel = ROLE_LABEL[params.role] ?? params.role;
  const destino = params.organizationName
    ? `a <strong style="color:${BRANCO_CRU};">${escapeHtml(params.organizationName)}</strong> no Desigual OS`
    : 'o <strong style="color:' + BRANCO_CRU + ';">Desigual OS</strong>';

  return await enviar({
    to: params.to,
    subject: params.organizationName
      ? `Seu convite para a ${params.organizationName} no Desigual OS`
      : 'Seu convite para o Desigual OS',
    conteudo: {
      sobretitulo: 'Convite',
      titulo: 'Você tem acesso ao Desigual OS',
      paragrafos: [
        `${saudacao} Você foi convidado(a) para ${destino} como <strong style="color:${BRANCO_CRU};">${escapeHtml(papel)}</strong>.`,
        'O botão abaixo abre o cadastro para você definir a sua senha. A partir daí é só entrar, o sistema já sabe quem você é e o que você pode acessar.',
      ],
      botao: { texto: 'Aceitar convite', href: params.inviteLink },
      mostrarLinkCru: true,
      rodape: 'Se você não esperava este convite, pode ignorar este e-mail.',
    },
  });
}

export async function sendResetPasswordEmail(params: { to: string; name: string | null; resetLink: string }): Promise<void> {
  const saudacao = params.name ? `Olá, ${escapeHtml(params.name)}.` : 'Olá.';

  await enviar({
    to: params.to,
    subject: 'Redefinir sua senha no Desigual OS',
    conteudo: {
      sobretitulo: 'Segurança',
      titulo: 'Escolha uma senha nova',
      paragrafos: [
        `${saudacao} Recebemos um pedido para redefinir a senha da sua conta no <strong style="color:${BRANCO_CRU};">Desigual OS</strong>.`,
        'O botão abaixo leva à tela onde você escolhe a senha nova.',
      ],
      botao: { texto: 'Redefinir senha', href: params.resetLink },
      mostrarLinkCru: true,
      rodape: 'Se você não pediu essa redefinição, pode ignorar este e-mail, a sua senha continua a mesma.',
    },
  });
}

/**
 * Aviso de "você foi adicionado" — para quem JÁ tem conta e entrou numa
 * empresa sem passar pelo link de convite (POST /organizations/:id/invites com
 * e-mail já cadastrado). O botão leva ao app, não a um link mágico: não há
 * senha para definir, a conta já existe. Por isso também não repete o endereço
 * em texto — repetir a URL do app é ruído, não é um link de uso único.
 */
export async function sendAddedToOrganizationEmail(params: { to: string; name: string | null; organizationName: string }): Promise<void> {
  const saudacao = params.name ? `Olá, ${escapeHtml(params.name)}.` : 'Olá.';
  const appUrl = urlPublicaDoApp();
  const empresa = escapeHtml(params.organizationName);

  await enviar({
    to: params.to,
    subject: `Você agora faz parte da ${params.organizationName} no Desigual OS`,
    conteudo: {
      sobretitulo: 'Novo acesso',
      titulo: `Bem-vindo(a) à ${params.organizationName}`,
      paragrafos: [
        `${saudacao} Você foi adicionado(a) à empresa <strong style="color:${BRANCO_CRU};">${empresa}</strong> no Desigual OS.`,
        'Entre com a sua conta de sempre, a empresa já aparece para você, sem cadastro novo e sem senha nova.',
      ],
      botao: { texto: 'Abrir o Desigual OS', href: appUrl },
      mostrarLinkCru: false,
      rodape: 'Se isso parecer um engano, fale com quem administra a conta da sua empresa.',
    },
  });
}
