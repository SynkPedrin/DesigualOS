import type { OrganizationConnectorWire } from '@/lib/api/contracts';

/**
 * connectors.ts — estado em memória pra Integrações/WhatsApp (07/10/2026).
 * Mesmo padrão de clients.ts/studio.ts: um array mutável, reiniciado a cada
 * reload da página (modo mock nunca precisa de persistência entre sessões).
 */
interface ConectorMock {
  organizationId: string;
  provider: string;
  credentials: Record<string, string>;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export const mockConnectors: ConectorMock[] = [];

function mascarar(credentials: Record<string, string>): Record<string, string> {
  const campoSecreto = /key|token|secret|password/i;
  const mascarado: Record<string, string> = {};
  for (const [campo, valor] of Object.entries(credentials)) {
    mascarado[campo] = campoSecreto.test(campo) ? `••••${valor.slice(-4)}` : valor;
  }
  return mascarado;
}

export function apresentarConector(c: ConectorMock): OrganizationConnectorWire {
  return { provider: c.provider, status: c.status, credentials: mascarar(c.credentials), created_at: c.createdAt, updated_at: c.updatedAt };
}

export function salvarConector(organizationId: string, provider: string, credentials: Record<string, string>): ConectorMock {
  const agora = new Date().toISOString();
  const existente = mockConnectors.find((c) => c.organizationId === organizationId && c.provider === provider);
  if (existente) {
    existente.credentials = credentials;
    existente.status = 'ativa';
    existente.updatedAt = agora;
    return existente;
  }
  const novo: ConectorMock = { organizationId, provider, credentials, status: 'ativa', createdAt: agora, updatedAt: agora };
  mockConnectors.push(novo);
  return novo;
}
