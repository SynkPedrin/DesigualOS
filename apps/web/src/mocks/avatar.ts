/**
 * Avatar ILUSTRADO determinístico pra fixture de pessoa (nunca pra cliente —
 * cliente usa `EntityAvatar(kind:'client')`, iniciais geradas, sem foto).
 * DiceBear "avataaars" é desenho estilizado, não rosto de pessoa real — serve
 * só pra tela de demonstração não ficar com "I"/"B" genérico em todo
 * colaborador fixture, nunca pra fingir uma foto de alguém que existe.
 */
export function dicebearAvatarUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}
