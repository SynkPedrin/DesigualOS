const RESEND_API_URL = 'https://api.resend.com/emails';

const LOGO_URL = 'https://dddchncdrgbhdirytdsp.supabase.co/storage/v1/object/public/user-uploads/branding/email-logo.png';
const BACKGROUND_URL = 'https://dddchncdrgbhdirytdsp.supabase.co/storage/v1/object/public/user-uploads/branding/email-background.png';

const ROLE_LABEL: Record<string, string> = {
  master: 'Administrador master',
  colaborador: 'Colaborador',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

/**
 * Template de e-mail próprio (não é o template padrão do Supabase Auth):
 * usa a logo e o fundo reais da marca, pedido explícito do usuário. O link
 * em si ainda é gerado pelo Supabase Auth (generateLink), só o envio e o
 * visual são nossos.
 */
function buildInviteEmailHtml(params: { name: string | null; role: string; inviteLink: string }): string {
  const greeting = params.name ? `Olá, ${escapeHtml(params.name)}` : 'Olá';
  const roleLabel = ROLE_LABEL[params.role] ?? params.role;

  return `
<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background-color:#0F0F0F;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0F0F0F;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
            <tr>
              <td>
                <img src="${BACKGROUND_URL}" width="600" alt="" style="display:block;width:100%;height:auto;border-radius:12px 12px 0 0;" />
              </td>
            </tr>
            <tr>
              <td style="background-color:#FAFAF7;border-radius:0 0 12px 12px;padding:40px 32px;">
                <img src="${LOGO_URL}" width="160" alt="Desigual OS" style="display:block;margin:0 auto 32px auto;" />
                <p style="margin:0 0 8px 0;font-size:16px;color:#0F0F0F;">${greeting},</p>
                <p style="margin:0 0 24px 0;font-size:16px;color:#0F0F0F;line-height:1.5;">
                  Você foi convidado(a) para acessar o <strong>Desigual OS</strong>, o sistema de orquestração de IA da Agência Desigual, como <strong>${escapeHtml(roleLabel)}</strong>.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
                  <tr>
                    <td style="background-color:#E1F900;border-radius:8px;">
                      <a href="${params.inviteLink}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:bold;color:#0F0F0F;text-decoration:none;">Aceitar convite</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;font-size:13px;color:#6B6B6B;line-height:1.5;">
                  Se o botão não funcionar, copie e cole este link no navegador:<br />
                  <a href="${params.inviteLink}" style="color:#6B6B6B;word-break:break-all;">${params.inviteLink}</a>
                </p>
                <p style="margin:24px 0 0 0;font-size:12px;color:#A1A1A1;">
                  Se você não esperava este convite, pode ignorar este e-mail.
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

/**
 * Mesmo template visual do convite (logo + fundo da marca): "no padrão de
 * e-mail do sistema", pedido explícito do usuário. Só muda o texto e o
 * rótulo do botão - a estrutura HTML é a mesma por design, pra qualquer
 * novo e-mail transacional futuro seguir o mesmo corpo em vez de reinventar.
 */
function buildResetPasswordEmailHtml(params: { name: string | null; resetLink: string }): string {
  const greeting = params.name ? `Olá, ${escapeHtml(params.name)}` : 'Olá';

  return `
<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:0;background-color:#0F0F0F;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0F0F0F;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
            <tr>
              <td>
                <img src="${BACKGROUND_URL}" width="600" alt="" style="display:block;width:100%;height:auto;border-radius:12px 12px 0 0;" />
              </td>
            </tr>
            <tr>
              <td style="background-color:#FAFAF7;border-radius:0 0 12px 12px;padding:40px 32px;">
                <img src="${LOGO_URL}" width="160" alt="Desigual OS" style="display:block;margin:0 auto 32px auto;" />
                <p style="margin:0 0 8px 0;font-size:16px;color:#0F0F0F;">${greeting},</p>
                <p style="margin:0 0 24px 0;font-size:16px;color:#0F0F0F;line-height:1.5;">
                  Recebemos um pedido para redefinir a senha da sua conta no <strong>Desigual OS</strong>. Clique no botão abaixo para escolher uma senha nova.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px auto;">
                  <tr>
                    <td style="background-color:#E1F900;border-radius:8px;">
                      <a href="${params.resetLink}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:bold;color:#0F0F0F;text-decoration:none;">Redefinir senha</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;font-size:13px;color:#6B6B6B;line-height:1.5;">
                  Se o botão não funcionar, copie e cole este link no navegador:<br />
                  <a href="${params.resetLink}" style="color:#6B6B6B;word-break:break-all;">${params.resetLink}</a>
                </p>
                <p style="margin:24px 0 0 0;font-size:12px;color:#A1A1A1;">
                  Se você não pediu essa redefinição, pode ignorar este e-mail - sua senha continua a mesma.
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

export async function sendResetPasswordEmail(params: { to: string; name: string | null; resetLink: string }): Promise<void> {
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
      subject: 'Redefinir sua senha - Desigual OS',
      html: buildResetPasswordEmailHtml(params),
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend email send failed (${response.status}): ${await response.text()}`);
  }
}

export async function sendInviteEmail(params: { to: string; name: string | null; role: string; inviteLink: string }): Promise<void> {
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
      subject: 'Convite para o Desigual OS',
      html: buildInviteEmailHtml(params),
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend email send failed (${response.status}): ${await response.text()}`);
  }
}
