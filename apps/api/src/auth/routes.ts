import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@desigual-os/database';
import { getSupabaseAdminClient } from '@desigual-os/auth';
import { createLogger } from '@desigual-os/logging';
import { requireAuth } from './middleware';
import { uploadUserFile } from '../lib/storage';
import { sendResetPasswordEmail } from '../lib/email';

const logger = createLogger({ service: 'auth-recovery' });
const forgotPasswordSchema = z.object({ email: z.string().email() });

const updateMeSchema = z.object({
  clickup_email: z.string().email().nullable().optional(),
  name: z.string().min(1).optional(),
  // Idioma da UI, central de configuração da conta (pedido do usuário,
  // não estava no prompt mestre original).
  language: z.enum(['pt-BR', 'en-US', 'es-ES']).optional(),
  // Tema da UI: claro, escuro, ou segue o SO ("system"). Persistido pra
  // valer em qualquer aparelho que o usuário logar, não só localStorage.
  theme: z.enum(['light', 'dark', 'system']).optional(),
  // Widgets escolhidos pelo colaborador pro dashboard personalizado dele
  // (pedido do usuário). IDs livres (o frontend decide o catálogo); isso
  // só é preferência de exibição, cada widget busca dado de uma rota com
  // RBAC própria, então não há risco de acesso em aceitar qualquer string.
  dashboard_widgets: z.array(z.string().min(1)).max(20).optional(),
});

const AVATAR_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Recuperação de senha. Rota PÚBLICA por natureza (quem esqueceu a senha
   * não tem token pra mandar) — a segurança aqui é: sempre responder
   * sucesso genérico, nunca revelar se aquele e-mail tem conta ou não
   * (enumeração de usuário é a forma clássica de vazar essa informação).
   *
   * Mesmo padrão do convite (POST /admin/invite): o LINK é gerado pelo
   * Supabase Auth (generateLink), mas quem manda o e-mail é o Resend, com o
   * template da marca — "no padrão de e-mail do sistema", pedido do usuário.
   * Sem Resend configurado, cai pro e-mail padrão do Supabase (funcional,
   * sem a marca), igual o convite já faz.
   */
  app.post('/auth/forgot-password', async (request, reply) => {
    const body = forgotPasswordSchema.parse(request.body);

    const supabaseUrl = process.env.SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !secretKey) {
      reply.code(500);
      return { error: 'SUPABASE_URL/SUPABASE_SECRET_KEY not configured on the Orchestrator' };
    }

    const admin = getSupabaseAdminClient(supabaseUrl, secretKey);
    const redirectTo = `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/reset-password`;
    const hasResend = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL);

    try {
      if (hasResend) {
        const { data, error } = await admin.auth.admin.generateLink({
          type: 'recovery',
          email: body.email,
          options: { redirectTo },
        });
        // "User not found" cai aqui: resposta genérica de sucesso mesmo assim,
        // de propósito (ver comentário acima sobre enumeração).
        if (!error && data.user) {
          const [profile] = await db.select().from(schema.users).where(eq(schema.users.email, body.email));
          await sendResetPasswordEmail({ to: body.email, name: profile?.name ?? null, resetLink: data.properties.action_link });
        } else if (error && !/user not found/i.test(error.message)) {
          logger.error({ error }, 'Falha ao gerar link de recuperação');
        }
      } else {
        // Sem Resend: deixa o próprio Supabase mandar o e-mail dele (sem a
        // marca, mas funcional). resetPasswordForEmail já responde
        // genérico, nunca revela se o e-mail existe.
        await admin.auth.resetPasswordForEmail(body.email, { redirectTo });
      }
    } catch (error) {
      // Erro de ENVIO (Resend fora do ar etc.) também não vaza pro cliente:
      // só loga pro time investigar. O usuário não pode aprender nada sobre
      // o estado da própria conta a partir da resposta desta rota.
      logger.error({ error }, 'Falha ao processar pedido de recuperação de senha');
    }

    return { ok: true, message: 'Se esse e-mail tiver uma conta, enviamos um link de redefinição de senha.' };
  });

  app.get('/me', { preHandler: requireAuth }, async (request) => {
    return request.authUser;
  });

  // Perfil próprio do colaborador: hoje só nome e o e-mail do ClickUp
  // (usado pra atribuição de tarefa, seção Tool Gateway).
  app.patch('/me', { preHandler: requireAuth }, async (request, reply) => {
    const body = updateMeSchema.parse(request.body);
    if (!request.authUser) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const [updated] = await db
      .update(schema.users)
      .set({
        ...(body.clickup_email !== undefined ? { clickupEmail: body.clickup_email } : {}),
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.language !== undefined ? { language: body.language } : {}),
        ...(body.theme !== undefined ? { theme: body.theme } : {}),
        ...(body.dashboard_widgets !== undefined ? { dashboardWidgets: body.dashboard_widgets } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, request.authUser.id))
      .returning();

    if (!updated) {
      reply.code(404);
      return { error: 'User not found' };
    }

    return {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      clickup_email: updated.clickupEmail,
      language: updated.language,
      theme: updated.theme,
      dashboard_widgets: updated.dashboardWidgets,
      avatar_url: updated.avatarUrl,
    };
  });

  // Foto de perfil visível para todos os usuários (pedido do usuário), não
  // só o próprio. Guardada no bucket público `user-uploads`.
  app.post('/me/avatar', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.authUser) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }

    const file = await request.file();
    if (!file) {
      reply.code(400);
      return { error: 'No file sent' };
    }
    if (!AVATAR_CONTENT_TYPES.has(file.mimetype)) {
      reply.code(400);
      return { error: `Unsupported content type '${file.mimetype}', expected png/jpeg/webp` };
    }

    const buffer = await file.toBuffer();
    const extension = file.mimetype.split('/')[1];
    const path = `avatars/${request.authUser.id}.${extension}`;
    const uploaded = await uploadUserFile(path, buffer, file.mimetype);

    const [updated] = await db
      .update(schema.users)
      .set({ avatarUrl: uploaded.url, updatedAt: new Date() })
      .where(eq(schema.users.id, request.authUser.id))
      .returning();

    if (!updated) {
      // O arquivo já subiu pro Storage nesse ponto; fica órfão (não é
      // referenciado por ninguém), mas isso é preferível a mentir que
      // salvou quando a linha do usuário nem existe mais.
      reply.code(404);
      return { error: 'User not found' };
    }

    return { id: updated.id, avatar_url: uploaded.url };
  });
}
