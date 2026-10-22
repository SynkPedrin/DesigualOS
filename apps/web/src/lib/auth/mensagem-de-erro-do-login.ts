/**
 * Mensagens do Supabase em português. "Invalid login credentials" em inglês
 * deixava a pessoa sem saber o que fazer (22/10/2026).
 */
export function mensagemDeErroDoLogin(mensagem: string): string {
  if (/invalid login credentials/i.test(mensagem)) return 'E-mail ou senha incorretos. Confira se não sobrou espaço ou letra maiúscula, ou use "Esqueceu a senha?".';
  if (/email not confirmed/i.test(mensagem)) return 'Este e-mail ainda não foi confirmado. Procure o convite na sua caixa de entrada.';
  if (/too many requests|rate limit/i.test(mensagem)) return 'Muitas tentativas seguidas. Espere um minuto e tente de novo.';
  return mensagem;
}
