'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import {
  ClaudeMark,
  ControlHeader,
  LinhasFantasma,
  Secao,
  SemNadaAinda,
  StatusLabel,
  Tabela,
  Td,
  Th,
} from '@/components/control/primitives';
import { useMcpStatus } from '@/hooks/use-mcp-status';
import { useFerramentasVivas, useSaudeDoMcp, porEscopo } from '@/hooks/use-mcp-servidor';

/**
 * A PÁGINA DO MCP.
 *
 * A primeira versão desta tela dizia "não publicado, sem endereço, nenhuma
 * conexão possível" — escrito no código, não lido de lugar nenhum. Era verdade
 * quando foi escrita e falso três horas depois: o servidor subiu no Railway e a
 * conta de atendimento conectou. A tela continuou anunciando o contrário.
 *
 * Fica registrado porque a lição é maior que o caso: numa tela de controle,
 * AFIRMAR estado por constante é a mesma família de defeito que responder "não
 * sei" com um número. As duas dão à pessoa uma certeza que o sistema não tem.
 *
 * Agora tudo aqui vem de `/mcp/status`, que lê `mcp_tokens` (quem autorizou,
 * com quais escopos) e `audit_logs` (qual ferramenta foi chamada, por quem, com
 * que resultado). Sem conexão, a tela vai dizer isso porque LEU zero.
 */
export default function McpPage() {
  const { data: mcp, isPending, isError } = useMcpStatus();
  /**
   * `?conectou=<id>` — de onde a notificação de "fulano conectou o Claude"
   * aterrissa. Sem isto o aviso levaria a uma tabela de dez linhas e a pessoa
   * teria que procurar o nome que acabou de ler; um link que não mostra o que
   * prometeu é ruído com aparência de utilidade.
   */
  const destacado = useSearchParams().get('conectou');
  /**
   * PING DE VERDADE, não eco de configuração.
   *
   * A versão anterior dizia "Publicado" porque `MCP_PUBLIC_URL` estava setada —
   * o que prova que alguém escreveu um endereço, não que existe servidor do
   * outro lado. É a mesma classe do "não publicado" escrito em constante que
   * esta tela já cometeu: as duas afirmam sem ler.
   *
   * Agora o navegador pergunta ao próprio servidor (`/health` é público e tem
   * CORS pro nosso domínio), e o que aparece é o que ele respondeu, com a
   * latência do banco dele junto.
   */
  const { data: saude, isPending: saudePendente, isError: saudeErro } = useSaudeDoMcp(mcp?.base);
  const { data: ferramentas } = useFerramentasVivas(mcp?.base);

  const taxa = mcp && mcp.chamadas_24h > 0 ? Math.round((mcp.sucessos_24h / mcp.chamadas_24h) * 100) : null;

  return (
    <div className="mx-auto max-w-[1400px]">
      <ControlHeader
        title="MCP"
        description="A porta pela qual o Claude alcança a operação: permissão, memória e auditoria num só lugar."
      />

      <Secao titulo="Servidor">
        <div className="rounded-lg border border-grafite-elevado bg-grafite px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-heading text-base font-semibold text-branco-cru">Desigual MCP</p>
              {isPending || (mcp?.base && saudePendente) ? (
                <StatusLabel estado="desconhecido">Consultando</StatusLabel>
              ) : isError ? (
                <StatusLabel estado="erro">Não consegui ler o estado</StatusLabel>
              ) : !mcp?.endpoint ? (
                <StatusLabel estado="atencao">Sem endereço configurado</StatusLabel>
              ) : saudeErro ? (
                // Endereço existe e o servidor não respondeu. É o caso que a
                // versão anterior mostrava como "Publicado", verde.
                <StatusLabel estado="erro">Não respondeu</StatusLabel>
              ) : saude?.status === 'ok' ? (
                <StatusLabel estado="ok">
                  No ar
                  {saude.banco?.ok && ` · banco em ${saude.banco.latencia_ms}ms`}
                </StatusLabel>
              ) : (
                <StatusLabel estado="atencao">{saude?.status ?? 'estado desconhecido'}</StatusLabel>
              )}
            </div>
            <div className="min-w-0 text-right">
              <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-nevoa">Endpoint</p>
              {/* O endereço vem da API. Quando não vier, a tela diz que não
               * sabe — nunca um endereço plausível escrito aqui. */}
              <p className="truncate font-mono text-sm text-branco-cru">
                {mcp?.endpoint ?? (isPending ? '—' : 'não configurado')}
              </p>
            </div>
          </div>
        </div>
      </Secao>

      <Secao titulo="Conexões">
        {isPending ? (
          <LinhasFantasma linhas={4} />
        ) : isError ? (
          <SemNadaAinda
            titulo="Não consegui ler as conexões"
            explicacao="A consulta falhou. Enquanto ela não responder, não dá pra afirmar nem que há conexão nem que não há."
          />
        ) : (mcp?.pessoas.length ?? 0) === 0 ? (
          <SemNadaAinda
            titulo="Ninguém conectou ainda"
            explicacao="Quando alguém autorizar o Claude a usar o Desigual, a conexão aparece aqui com os escopos concedidos."
          />
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th>Pessoa</Th>
                <Th className="w-24">Via</Th>
                <Th>Escopos concedidos</Th>
                <Th className="w-28">Autorizações</Th>
                <Th className="w-40">Conectada desde</Th>
              </tr>
            </thead>
            <tbody>
              {(mcp?.pessoas ?? []).map((p) => (
                <tr
                  key={p.user_id}
                  className={p.user_id === destacado ? 'bg-roxo-eletrico/10' : undefined}
                >
                  <Td className="truncate">{p.nome ?? '—'}</Td>
                  <Td>
                    <span className="flex items-center gap-1.5">
                      <ClaudeMark size={16} />
                      <span className="text-nevoa">Claude</span>
                    </span>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {p.scopes.map((s) => (
                        <span
                          key={s}
                          className={[
                            'rounded-full px-2 py-0.5 font-mono text-[10px]',
                            s.endsWith('.write')
                              ? 'bg-aviso/10 text-aviso'
                              : 'bg-grafite-elevado text-nevoa',
                          ].join(' ')}
                        >
                          {s}
                        </span>
                      ))}
                    </span>
                  </Td>
                  <Td className="font-mono text-[13px]">{p.conexoes}</Td>
                  <Td className="font-mono text-[12px] text-nevoa">
                    {p.desde ? new Date(p.desde).toLocaleString('pt-BR') : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </Secao>

      <Secao titulo="Conexões recentes">
        {isPending ? (
          <LinhasFantasma linhas={3} />
        ) : (mcp?.conexoes_recentes.length ?? 0) === 0 ? (
          <SemNadaAinda
            titulo="Nenhuma conexão registrada"
            explicacao="O servidor grava um evento a cada sessão de MCP aberta. Sem evento aqui, ninguém abriu sessão nesta instalação — não é falha de leitura."
          />
        ) : (
          <>
            {/*
              * POR QUE A MESMA PESSOA APARECE VÁRIAS VEZES.
              *
              * Medido em 30/09/2026: seis eventos da mesma conta em CINCO
              * segundos. O cliente do Claude abre várias sessões ao conectar,
              * e cada uma é um evento real. Esconder as repetições seria
              * inventar um número mais bonito; deixá-las sem explicação faria
              * qualquer leitor contar seis conexões onde houve uma. Então a
              * tela mostra o fato e diz o que ele significa.
              */}
            <p className="mb-3 text-[13px] text-nevoa">
              Cada linha é uma sessão aberta. O Claude costuma abrir várias de uma vez ao conectar, então a mesma
              pessoa repetida em poucos segundos é uma conexão só.
            </p>
            <Tabela>
              <thead>
                <tr>
                  <Th className="w-40">Quando</Th>
                  <Th>Quem</Th>
                  <Th className="w-32">Autorização</Th>
                  <Th className="w-28">Chamadas 24h</Th>
                </tr>
              </thead>
              <tbody>
                {(mcp?.conexoes_recentes ?? []).map((c) => (
                  <tr key={c.id} className={c.user_id === destacado ? 'bg-roxo-eletrico/10' : undefined}>
                    <Td className="whitespace-nowrap font-mono text-[12px] text-nevoa">
                      {c.at ? new Date(c.at).toLocaleString('pt-BR') : '—'}
                    </Td>
                    <Td className="truncate">
                      <span className="flex items-center gap-1.5">
                        <ClaudeMark size={14} />
                        {c.nome ?? '—'}
                      </span>
                    </Td>
                    <Td>
                      {/*
                        * "Viva" = o token daquela pessoa ainda vale. NÃO é
                        * "está online": o MCP fala por HTTP e não tem despedida
                        * de protocolo, então ninguém aqui sabe se o Claude está
                        * aberto neste instante. Dizer "offline" a partir de
                        * silêncio seria inventar um fato.
                        */}
                      <StatusLabel estado={c.conexao_viva ? 'ok' : 'desconhecido'}>
                        {c.conexao_viva ? 'vigente' : 'expirada'}
                      </StatusLabel>
                    </Td>
                    {/* `null` = sem dono no evento. Um traço diz isso; um "0"
                      * afirmaria que a pessoa não usou nada. */}
                    <Td className="font-mono text-[13px]">
                      {c.chamadas_24h === null ? <span className="text-nevoa">sem dono</span> : c.chamadas_24h}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          </>
        )}
      </Secao>

      <Secao titulo="Chamadas nas últimas 24h">
        {isPending ? (
          <LinhasFantasma linhas={3} />
        ) : (mcp?.chamadas_24h ?? 0) === 0 ? (
          <SemNadaAinda
            titulo="Nenhuma chamada em 24h"
            explicacao="Há conexão, mas ninguém pediu nada ao Desigual pelo Claude nesta janela. Não é falha — é silêncio."
          />
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <Numero rotulo="Chamadas" valor={String(mcp?.chamadas_24h ?? 0)} />
              <Numero rotulo="Sucesso" valor={taxa === null ? '—' : `${taxa}%`} />
              <Numero rotulo="Ferramentas usadas" valor={String(mcp?.por_ferramenta.length ?? 0)} />
              <Numero rotulo="Servidas pelo MCP" valor={ferramentas ? String(ferramentas.length) : '—'} />
            </div>
            <Tabela>
              <thead>
                <tr>
                  <Th className="w-20">Hora</Th>
                  <Th className="w-44">Ferramenta</Th>
                  <Th className="w-36">Quem</Th>
                  <Th className="w-28">Resultado</Th>
                  <Th>Request</Th>
                </tr>
              </thead>
              <tbody>
                {(mcp?.ultimas ?? []).map((c, i) => (
                  <tr key={`${c.request_id ?? i}`}>
                    <Td className="whitespace-nowrap font-mono text-[12px] text-nevoa">
                      {c.at ? new Date(c.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </Td>
                    <Td className="font-mono text-[13px]">{c.tool ?? '—'}</Td>
                    <Td className="truncate">{c.user_name ?? '—'}</Td>
                    <Td>
                      <StatusLabel estado={c.result === 'success' ? 'ok' : 'erro'}>{c.result}</StatusLabel>
                    </Td>
                    <Td className="truncate font-mono text-[11px] text-nevoa">{c.request_id ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          </>
        )}
      </Secao>

      <Secao
        titulo={ferramentas ? `Ferramentas servidas (${ferramentas.length})` : 'Ferramentas servidas'}
        acao={
          <Link
            href="/tools"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-nevoa transition-colors hover:text-branco-cru"
          >
            Ver todas
            <ArrowRight size={12} />
          </Link>
        }
      >
        {!ferramentas ? (
          <SemNadaAinda
            titulo="Não consegui ler as ferramentas"
            explicacao="O inventário vem do próprio servidor. Prefiro dizer que não li a mostrar uma lista guardada — a última que ficou salva já estava com duas ferramentas a menos que a realidade."
          />
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th className="w-36">Escopo</Th>
                <Th>Ferramentas</Th>
                <Th className="w-24">Acesso</Th>
              </tr>
            </thead>
            <tbody>
              {[...porEscopo(ferramentas).entries()].map(([escopo, doEscopo]) => (
                <tr key={escopo}>
                  <Td className="whitespace-nowrap font-mono text-[13px]">{escopo}</Td>
                  <Td className="text-nevoa">{doEscopo.map((f) => f.name).join(', ')}</Td>
                  <Td>
                    <span
                      className={
                        doEscopo[0]?.access === 'WRITE'
                          ? 'font-mono text-[11px] text-aviso'
                          : 'font-mono text-[11px] text-nevoa'
                      }
                    >
                      {doEscopo[0]?.access === 'WRITE' ? 'ESCRITA' : 'LEITURA'}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </Secao>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-md border border-grafite-elevado bg-grafite px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-nevoa">{rotulo}</p>
      <p className="mt-0.5 font-heading text-lg font-semibold text-branco-cru">{valor}</p>
    </div>
  );
}
