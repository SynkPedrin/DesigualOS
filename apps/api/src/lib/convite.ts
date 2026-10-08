import { getSupabaseAdminClient } from '@desigual-os/auth';
import { sendInviteEmail } from './email';
import { urlPublicaDoAppCom } from './url-do-app';

/**
 * convite.ts — o ENVIO do convite de empresa, compartilhado entre as rotas de
 * membros (organizations/membros.ts). O `/admin/invite` legado continua com o
 * código dele (não foi movido): a mesma lógica, com uma diferença de contrato
 * — aqui NUNCA se finge envio.
 *
 * A cadeia de envio, igual à do admin/invite:
 *
 *   1. RESEND_API_KEY + RESEND_FROM_EMAIL configurados: o Supabase gera o link
 *      (generateLink, sem mandar o e-mail padrão dele) e o Resend manda o
 *      e-mail com a marca da Desigual;
 *   2. sem Resend: inviteUserByEmail, e quem manda é o e-mail padrão do
 *      Supabase (funcional, sem marca);
 *   3. sem Supabase configurado: NÃO dá para convidar ninguém de verdade — o
 *      convite local (organization_invites) é criado mesmo assim e a resposta
 *      diz `email_enviado: false` com o motivo.
 *
 * O RETORNO nunca lança: a rota decide o HTTP. `link` vai junto quando ele
 * existe (caminho 1), mesmo quando o Resend falha — é o que permite ao admin
 * copiar o link e mandar manualmente, em vez de o convite morrer num 502.
 */
export interface ResultadoDeConvitePorEmail {
  emailEnviado: boolean;
  /** Por que não saiu, em linguagem de gente. `null` quando saiu. */
  motivo: string | null;
  /** O link mágico do Supabase, quando gerado (só no caminho com Resend). */
  link: string | null;
  /** O usuário do Supabase Auth criado/vinculado pelo convite. */
  supabaseUserId: string | null;
}

export async function enviarConviteDeOrganizacao(params: {
  email: string;
  nome?: string | null;
  papel: string;
  nomeDaEmpresa: string;
}): Promise<ResultadoDeConvitePorEmail> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    return {
      emailEnviado: false,
      motivo: 'Supabase Auth não está configurado no Orchestrator (SUPABASE_URL/SUPABASE_SECRET_KEY).',
      link: null,
      supabaseUserId: null,
    };
  }

  const admin = getSupabaseAdminClient(supabaseUrl, secretKey);
  const redirectTo = urlPublicaDoAppCom('/convite');
  const metadata = { invited_org_role: params.papel, invited_org_name: params.nomeDaEmpresa, invited_name: params.nome ?? null };

  const hasResend = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);

  if (hasResend) {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'invite',
      email: params.email,
      options: { data: metadata, redirectTo },
    });
    if (error || !data.user) {
      return { emailEnviado: false, motivo: error?.message ?? 'Falha ao gerar o link de convite no Supabase.', link: null, supabaseUserId: null };
    }

    const link = data.properties.action_link;
    try {
      await sendInviteEmail({
        to: params.email,
        name: params.nome ?? null,
        role: params.papel,
        inviteLink: link,
        organizationName: params.nomeDaEmpresa,
      });
      return { emailEnviado: true, motivo: null, link, supabaseUserId: data.user.id };
    } catch (emailError) {
      // O usuário já existe no Supabase Auth e o convite local fica pendente:
      // o admin pode reenviar (POST .../invites/:id/reenviar) ou copiar o link.
      return {
        emailEnviado: false,
        motivo: `O convite foi criado, mas o e-mail não saiu: ${emailError instanceof Error ? emailError.message : String(emailError)}`,
        link,
        supabaseUserId: data.user.id,
      };
    }
  }

  const { data, error } = await admin.auth.admin.inviteUserByEmail(params.email, { data: metadata, redirectTo });
  if (error || !data.user) {
    return { emailEnviado: false, motivo: error?.message ?? 'Falha ao enviar o convite pelo Supabase.', link: null, supabaseUserId: null };
  }
  return { emailEnviado: true, motivo: null, link: null, supabaseUserId: data.user.id };
}
