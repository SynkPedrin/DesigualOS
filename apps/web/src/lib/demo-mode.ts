/**
 * MODO DEMONSTRAÇÃO — a única chave que decide se a tela pode mostrar dado
 * fabricado (07/10/2026, auditoria de produção §10).
 *
 * Por que isto existe: três telas (Pipeline, Agência e a ficha de Clientes)
 * importam fixture de `src/mocks` DIRETO, não via MSW. Isso é invisível pro
 * gate do MswProvider — num build com NEXT_PUBLIC_API_MODE=live elas
 * continuariam renderizando lead inventado e, pior, faturamento inventado
 * ("Cosentino R$ 12.000/mês") como se fosse real. Numa ferramenta que o dono
 * da agência usa pra decidir, número inventado é o defeito mais caro possível.
 *
 * Regra: em modo live, tela sem fonte de dado real não inventa — ela diz que
 * não tem a fonte ainda.
 */
export const DEMO_MODE = (process.env.NEXT_PUBLIC_API_MODE ?? 'mock') !== 'live';
