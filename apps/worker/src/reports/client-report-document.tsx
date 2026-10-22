import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * client-report-document.tsx — o PDF de Relatório de Performance que a agência
 * ENVIA AO CLIENTE. Por isso a régua aqui é a de um documento assinado: capa
 * com a identidade da Desigual, números que se leem de relance, e nenhum dado
 * que não tenha vindo das APIs.
 *
 * TODA CONCLUSÃO NUMÉRICA VEM DOS DADOS REAIS (§50 do prompt de refinamento,
 * 06/10/2026): este arquivo só formata o que `generate-client-report.ts` já
 * buscou na Graph API / Google Ads API. Nenhuma interpretação de IA entra aqui
 * (ver cabeçalho do processor).
 *
 * AS IMAGENS DA MARCA MORAM EM `apps/worker/assets/relatorio/` e o Dockerfile
 * as copia para a imagem do worker. Antes de 22/10/2026 o logo era procurado em
 * `assets/` da RAIZ, que não existe no container: todo PDF de produção saía sem
 * logo, só com o texto "DESIGUAL". O teste de ativos
 * (`relatorio-ativos.test.ts`) quebra se a imagem sumir ou deixar de ser copiada.
 */

/**
 * O build empacota tudo num `dist/index.js` só (apps/worker/build.mjs): em
 * produção, `import.meta.url` aponta para `apps/worker/dist/`, e em teste/dev
 * este arquivo roda de `apps/worker/src/reports/`, um nível mais fundo. Testa
 * os dois caminhos e usa o que existir; sem nenhum, o relatório sai sem a arte
 * em vez de quebrar por um asset.
 */
export function acharAssetDoRelatorio(nome: string): string | null {
  const dir = dirname(fileURLToPath(import.meta.url));
  const candidatos = [
    resolve(dir, '../assets/relatorio', nome), // produção: apps/worker/dist -> apps/worker/assets
    resolve(dir, '../../assets/relatorio', nome), // dev/teste: apps/worker/src/reports -> apps/worker/assets
  ];
  return candidatos.find((caminho) => existsSync(caminho)) ?? null;
}
const CAPA_PATH = acharAssetDoRelatorio('capa.jpg');
const LOGO_PATH = acharAssetDoRelatorio('logo.png');

/**
 * A PALETA É A DA MARCA (`apps/web/src/styles/tokens.css`): roxo elétrico
 * `#9333ea`, sinal (verde-limão) `#e1f900`, carbono `#0f0f0f`. O MIOLO CONTINUA
 * CLARO de propósito: é um PDF que a pessoa imprime, anexa em e-mail e abre no
 * celular. Fundo escuro numa folha A4 gasta tinta e vira mancha em leitor que
 * força tema claro. A marca entra na capa (a foto roxa e verde-limão), na faixa
 * das páginas internas, nos acentos e na tipografia.
 */
const ROXO = '#9333ea';
const ROXO_ESCURO = '#6b21a8';
const ROXO_SUAVE = '#f6f0ff';
const CARBONO = '#0f0f0f';
const SINAL = '#e1f900';
/** O verde-limão da marca precisa de uma versão mais escura para ler sobre branco. */
const LIMAO_ESCURO = '#8aa300';
const TEXTO = '#2b2b2b';
const CINZA = '#6f6f6f';
const CINZA_CLARO = '#9a9a9a';
const BORDA = '#e7e3ee';
const VERDE = '#15803d';
const VERDE_FUNDO = '#dcfce7';
const VERMELHO = '#b91c1c';
const VERMELHO_FUNDO = '#fee2e2';

const COR_META = ROXO;
const COR_GOOGLE = LIMAO_ESCURO;

const ALTURA_CAPA = 214;
const FAIXA_INTERNA = 14;
/** Largura do A4 em pontos. A capa sangra até a borda (margens negativas da página). */
const LARGURA_A4 = 595.28;
const MARGEM = 40;
const CRIATIVO_LARGURA = 118;

const styles = StyleSheet.create({
  page: { paddingTop: FAIXA_INTERNA + 16, paddingBottom: 58, paddingHorizontal: MARGEM, fontSize: 10, color: TEXTO, fontFamily: 'Helvetica' },

  faixa: { position: 'absolute', top: 0, left: 0, width: LARGURA_A4, height: FAIXA_INTERNA },
  faixaImagem: { width: LARGURA_A4, height: FAIXA_INTERNA, objectFit: 'cover' },

  capa: { marginTop: -(FAIXA_INTERNA + 16), marginHorizontal: -MARGEM, height: ALTURA_CAPA, position: 'relative', backgroundColor: CARBONO },
  capaImagem: { position: 'absolute', top: 0, left: 0, width: LARGURA_A4, height: ALTURA_CAPA, objectFit: 'cover' },
  capaVeuTotal: { position: 'absolute', top: 0, left: 0, width: LARGURA_A4, height: ALTURA_CAPA, backgroundColor: CARBONO, opacity: 0.32 },
  capaVeuTexto: { position: 'absolute', top: 0, left: 0, width: LARGURA_A4 * 0.72, height: ALTURA_CAPA, backgroundColor: CARBONO, opacity: 0.46 },
  capaConteudo: { position: 'absolute', top: 0, left: 0, width: LARGURA_A4, height: ALTURA_CAPA, paddingHorizontal: MARGEM, paddingTop: 30, paddingBottom: 26, justifyContent: 'space-between' },
  capaLogo: { width: 138, height: 46, objectFit: 'contain' },
  capaMarca: { fontSize: 20, fontWeight: 700, color: '#ffffff' },
  capaEyebrow: { fontSize: 8.5, color: SINAL, letterSpacing: 2.2, textTransform: 'uppercase', marginBottom: 6 },
  capaCliente: { fontSize: 29, fontWeight: 700, color: '#ffffff', lineHeight: 1.1 },
  capaPeriodo: { fontSize: 11, color: '#ece6f5', marginTop: 7 },
  capaFio: { position: 'absolute', left: 0, bottom: 0, width: LARGURA_A4, height: 5, backgroundColor: ROXO },
  capaFioSinal: { position: 'absolute', left: MARGEM, bottom: 0, width: 64, height: 5, backgroundColor: SINAL },

  intro: { marginTop: 18, fontSize: 10, color: CINZA, lineHeight: 1.5 },

  secao: { marginTop: 22, marginBottom: 9, flexDirection: 'row', alignItems: 'center' },
  secaoBarra: { width: 4, height: 15, backgroundColor: ROXO, borderRadius: 2, marginRight: 8 },
  secaoTitulo: { fontSize: 14, fontWeight: 700, color: CARBONO },
  secaoNota: { marginLeft: 'auto', fontSize: 8.5, color: CINZA_CLARO },

  kpiLinha: { flexDirection: 'row', gap: 9, marginBottom: 12 },
  kpi: { flex: 1, backgroundColor: ROXO_SUAVE, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 11, borderTopWidth: 3, borderTopColor: ROXO },
  kpiRotulo: { fontSize: 7.5, color: CINZA, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 5 },
  kpiValor: { fontSize: 17, fontWeight: 700, color: CARBONO },
  kpiRodape: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  kpiPilula: { fontSize: 7.5, fontWeight: 700, paddingVertical: 2, paddingHorizontal: 5, borderRadius: 8 },
  kpiVs: { fontSize: 7, color: CINZA_CLARO, marginLeft: 5 },

  distTitulo: { fontSize: 8.5, color: CINZA, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  distBarra: { flexDirection: 'row', height: 11, borderRadius: 6, overflow: 'hidden', backgroundColor: '#eee' },
  distLegenda: { flexDirection: 'row', gap: 16, marginTop: 7 },
  distItem: { flexDirection: 'row', alignItems: 'center' },
  distPonto: { width: 8, height: 8, borderRadius: 4, marginRight: 5 },
  distTexto: { fontSize: 8.5, color: TEXTO },

  canalCabeca: { marginTop: 24, marginBottom: 10, flexDirection: 'row', alignItems: 'center', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: BORDA },
  canalPonto: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  canalTitulo: { fontSize: 15, fontWeight: 700, color: CARBONO },
  canalNota: { marginLeft: 'auto', fontSize: 8.5, color: CINZA_CLARO },

  tabela: { borderWidth: 1, borderColor: BORDA, borderRadius: 8, overflow: 'hidden' },
  tabelaCabeca: { flexDirection: 'row', backgroundColor: '#f6f3fa', paddingVertical: 6, paddingHorizontal: 9, borderBottomWidth: 1, borderBottomColor: BORDA },
  tabelaLinha: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 9, borderBottomWidth: 1, borderBottomColor: '#f0edf4' },
  tabelaCabecaCelula: { fontSize: 7.5, fontWeight: 700, color: CINZA, textTransform: 'uppercase', letterSpacing: 0.4 },
  celula: { fontSize: 9 },
  colNome: { flex: 3.4, paddingRight: 8 },
  colStatus: { flex: 1.4 },
  colNum: { flex: 1.25, textAlign: 'right' },
  trilho: { height: 3, backgroundColor: '#ece8f2', borderRadius: 2, marginTop: 4 },
  trilhoPreenchido: { height: 3, borderRadius: 2 },
  statusPilula: { fontSize: 7.5, fontWeight: 700, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 8, alignSelf: 'flex-start' },

  galeriaTitulo: { fontSize: 8.5, color: CINZA, marginTop: 16, marginBottom: 7, textTransform: 'uppercase', letterSpacing: 0.6 },
  galeria: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  criativo: { width: CRIATIVO_LARGURA, borderWidth: 1, borderColor: BORDA, borderRadius: 7, overflow: 'hidden' },
  criativoImagem: { width: CRIATIVO_LARGURA, height: 88, objectFit: 'cover' },
  criativoSemArte: { width: CRIATIVO_LARGURA, height: 88, backgroundColor: '#f3f0f7' },
  criativoLegenda: { padding: 6 },
  criativoNome: { fontSize: 7.5, color: TEXTO },
  criativoNumero: { fontSize: 6.8, color: CINZA, marginTop: 2 },

  aviso: { fontSize: 9, color: CINZA, fontStyle: 'italic', marginTop: 2 },
  leitura: { marginTop: 22, padding: 11, borderRadius: 8, backgroundColor: '#faf8fc', borderWidth: 1, borderColor: BORDA },
  leituraTitulo: { fontSize: 8.5, fontWeight: 700, color: ROXO_ESCURO, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 4 },
  leituraTexto: { fontSize: 8.5, color: CINZA, lineHeight: 1.5 },

  rodape: { position: 'absolute', bottom: 22, left: MARGEM, right: MARGEM, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: BORDA, paddingTop: 8 },
  rodapeLogo: { width: 46, height: 15, objectFit: 'contain', marginRight: 8 },
  rodapeTexto: { fontSize: 7.5, color: CINZA_CLARO },
  rodapePagina: { marginLeft: 'auto', fontSize: 7.5, color: CINZA, fontWeight: 700 },
});

export interface ReportMetric {
  spend: number | null;
  resultados: number | null;
  ctr: number | null;
  custoMedio: number | null;
}

export interface ReportCampaign {
  id: string;
  name: string;
  status: string;
  spend: number | null;
  clicks: number | null;
  ctr: number | null;
}

/**
 * A IMAGEM VEM COMO BYTES, não como URL — e isso não é detalhe de
 * implementação. As `thumbnail_url` do Meta são assinadas e expiram em horas;
 * um PDF que as referencia nasce certo e apodrece. Como o arquivo fica
 * guardado, a arte tem que estar DENTRO dele.
 *
 * `imagem: null` é estado legítimo: o download falhou, e o criativo aparece
 * com nome e números, sem arte. Melhor que um retângulo quebrado.
 */
export interface ReportCreative {
  id: string;
  name: string;
  spend: number | null;
  ctr: number | null;
  imagem: Buffer | null;
}

export interface ChannelReportData {
  conectado: boolean;
  atual: ReportMetric | null;
  anterior: ReportMetric | null;
  campanhas: ReportCampaign[];
  criativos?: ReportCreative[];
  motivoNaoConectado?: string;
}

export interface ClientReportData {
  clienteNome: string;
  periodoInicio: Date;
  periodoFim: Date;
  periodoDias: number;
  geradoEm: Date;
  meta: ChannelReportData | null;
  googleAds: ChannelReportData | null;
}

/**
 * O PERÍODO É UM DIA DE CALENDÁRIO (`toYmd` no processor usa UTC), então a data
 * se formata em UTC. No fuso da máquina, 01/10 às 00:00 UTC virava "30/09" e o
 * relatório mostrava o período um dia atrás.
 */
function formatarData(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

/** Carimbo de geração, sempre em horário de Brasília, onde a agência e o cliente estão. */
function formatarCarimbo(d: Date): string {
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * SEM TRAVESSÃO, e não é preferência de estilo: é a regra de texto de produto
 * da Desigual OS, e um relatório que vai pro cliente é o texto de produto mais
 * exposto que existe aqui. "sem dado" também diz mais que um traço, que tanto
 * pode ser zero quanto ausência quanto erro de leitura.
 */
const SEM_DADO = 'sem dado';

/**
 * O STATUS DA CAMPANHA CHEGA EM INGLÊS DA API DO META, e saía assim no PDF:
 * um relatório em português, assinado pela agência e enviado ao cliente,
 * dizendo "ACTIVE" e "PAUSED". Quem recebe não tem obrigação de saber ler
 * jargão de plataforma.
 *
 * Status que eu não conheço sai COMO VEIO, em vez de virar "Desconhecida":
 * um valor novo da plataforma é informação, e apagá-lo seria esconder o que
 * está acontecendo na conta do cliente.
 */
const STATUS_EM_PORTUGUES: Record<string, string> = {
  ACTIVE: 'Ativa',
  PAUSED: 'Pausada',
  DELETED: 'Excluída',
  ARCHIVED: 'Arquivada',
  ENABLED: 'Ativa',
  REMOVED: 'Removida',
  IN_PROCESS: 'Em processamento',
  WITH_ISSUES: 'Com problemas',
  CAMPAIGN_PAUSED: 'Campanha pausada',
  ADSET_PAUSED: 'Conjunto pausado',
};

export function statusLegivel(status: string): string {
  return STATUS_EM_PORTUGUES[status.toUpperCase()] ?? status;
}

/** Cor da pílula de status: verde para no ar, âmbar para parado, vermelho para problema, cinza para o resto. */
export function corDoStatus(status: string): { texto: string; fundo: string } {
  const s = status.toUpperCase();
  if (s === 'ACTIVE' || s === 'ENABLED') return { texto: VERDE, fundo: VERDE_FUNDO };
  if (s.includes('PAUSED')) return { texto: '#92400e', fundo: '#fef3c7' };
  if (s === 'WITH_ISSUES' || s === 'DISAPPROVED' || s === 'DELETED' || s === 'REMOVED') return { texto: VERMELHO, fundo: VERMELHO_FUNDO };
  return { texto: CINZA, fundo: '#efedf2' };
}

function formatarMoeda(valor: number | null): string {
  if (valor === null) return SEM_DADO;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

function formatarNumero(valor: number | null): string {
  if (valor === null) return SEM_DADO;
  return new Intl.NumberFormat('pt-BR').format(Math.round(valor));
}

function formatarPercentual(valor: number | null): string {
  return valor === null ? SEM_DADO : `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(valor)}%`;
}

/** Variação percentual contra o período anterior. `null` quando não há base honesta de comparação. */
export function variacao(atual: number | null, anterior: number | null): { texto: string; positiva: boolean } | null {
  if (atual === null || anterior === null || anterior === 0) return null;
  const pct = ((atual - anterior) / anterior) * 100;
  const numero = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(pct));
  return { texto: `${pct >= 0 ? '+' : '-'}${numero}%`, positiva: pct >= 0 };
}

function KpiCard({
  label,
  valor,
  variacaoDoPeriodo,
  subirEhBom,
  acento = ROXO,
}: {
  label: string;
  valor: string;
  variacaoDoPeriodo: { texto: string; positiva: boolean } | null;
  /** `null` = a variação é informação, não julgamento (investimento: gastar mais não é "ruim" para quem lê). */
  subirEhBom: boolean | null;
  acento?: string;
}) {
  const neutra = subirEhBom === null;
  const bom = variacaoDoPeriodo && !neutra ? variacaoDoPeriodo.positiva === subirEhBom : false;
  const corPilula = neutra ? { texto: CINZA, fundo: '#efedf2' } : bom ? { texto: VERDE, fundo: VERDE_FUNDO } : { texto: VERMELHO, fundo: VERMELHO_FUNDO };
  return (
    <View style={[styles.kpi, { borderTopColor: acento }]} wrap={false}>
      <Text style={styles.kpiRotulo}>{label}</Text>
      <Text style={styles.kpiValor}>{valor}</Text>
      {variacaoDoPeriodo && (
        <View style={styles.kpiRodape}>
          <Text style={[styles.kpiPilula, { color: corPilula.texto, backgroundColor: corPilula.fundo }]}>{variacaoDoPeriodo.texto}</Text>
          <Text style={styles.kpiVs}>vs período anterior</Text>
        </View>
      )}
    </View>
  );
}

function TituloDeSecao({ texto, nota }: { texto: string; nota?: string | undefined }) {
  return (
    <View style={styles.secao} wrap={false}>
      <View style={styles.secaoBarra} />
      <Text style={styles.secaoTitulo}>{texto}</Text>
      {nota && <Text style={styles.secaoNota}>{nota}</Text>}
    </View>
  );
}

function SecaoDeCanal({ titulo, cor, canal }: { titulo: string; cor: string; canal: ChannelReportData }) {
  if (!canal.conectado) {
    return (
      <View wrap={false}>
        <View style={styles.canalCabeca}>
          <View style={[styles.canalPonto, { backgroundColor: CINZA_CLARO }]} />
          <Text style={styles.canalTitulo}>{titulo}</Text>
        </View>
        <Text style={styles.aviso}>{canal.motivoNaoConectado ?? `${titulo} não está conectado para este cliente.`}</Text>
      </View>
    );
  }

  const campanhas = canal.campanhas.slice(0, 12);
  const maiorGasto = Math.max(0, ...campanhas.map((c) => c.spend ?? 0));

  return (
    <View>
      <View style={styles.canalCabeca} wrap={false}>
        <View style={[styles.canalPonto, { backgroundColor: cor }]} />
        <Text style={styles.canalTitulo}>{titulo}</Text>
        <Text style={styles.canalNota}>
          {campanhas.length} campanha{campanhas.length === 1 ? '' : 's'} no período
        </Text>
      </View>

      <View style={styles.kpiLinha} wrap={false}>
        <KpiCard label="Investimento" valor={formatarMoeda(canal.atual?.spend ?? null)} variacaoDoPeriodo={variacao(canal.atual?.spend ?? null, canal.anterior?.spend ?? null)} subirEhBom={null} acento={cor} />
        <KpiCard label="Resultados" valor={formatarNumero(canal.atual?.resultados ?? null)} variacaoDoPeriodo={variacao(canal.atual?.resultados ?? null, canal.anterior?.resultados ?? null)} subirEhBom acento={cor} />
        <KpiCard label="CTR" valor={formatarPercentual(canal.atual?.ctr ?? null)} variacaoDoPeriodo={variacao(canal.atual?.ctr ?? null, canal.anterior?.ctr ?? null)} subirEhBom acento={cor} />
        <KpiCard label="Custo médio" valor={formatarMoeda(canal.atual?.custoMedio ?? null)} variacaoDoPeriodo={variacao(canal.atual?.custoMedio ?? null, canal.anterior?.custoMedio ?? null)} subirEhBom={false} acento={cor} />
      </View>

      {campanhas.length > 0 && (
        <View style={styles.tabela}>
          <View style={styles.tabelaCabeca} wrap={false}>
            <Text style={[styles.tabelaCabecaCelula, styles.colNome]}>Campanha</Text>
            <Text style={[styles.tabelaCabecaCelula, styles.colStatus]}>Status</Text>
            <Text style={[styles.tabelaCabecaCelula, styles.colNum]}>Investimento</Text>
            <Text style={[styles.tabelaCabecaCelula, styles.colNum]}>CTR</Text>
          </View>
          {campanhas.map((c) => {
            const pct = maiorGasto > 0 && c.spend !== null ? Math.max(2, Math.round((c.spend / maiorGasto) * 100)) : 0;
            const status = corDoStatus(c.status);
            return (
              <View key={c.id} style={styles.tabelaLinha} wrap={false}>
                <View style={styles.colNome}>
                  <Text style={styles.celula}>{c.name}</Text>
                  {pct > 0 && (
                    <View style={styles.trilho}>
                      <View style={[styles.trilhoPreenchido, { width: `${pct}%`, backgroundColor: cor }]} />
                    </View>
                  )}
                </View>
                <View style={styles.colStatus}>
                  <Text style={[styles.statusPilula, { color: status.texto, backgroundColor: status.fundo }]}>{statusLegivel(c.status)}</Text>
                </View>
                <Text style={[styles.celula, styles.colNum]}>{formatarMoeda(c.spend)}</Text>
                <Text style={[styles.celula, styles.colNum]}>{formatarPercentual(c.ctr)}</Text>
              </View>
            );
          })}
        </View>
      )}

      <GaleriaDeCriativos criativos={canal.criativos ?? []} />
    </View>
  );
}

/**
 * As peças que rodaram no período. Número diz quanto; criativo diz o quê — e é
 * a primeira coisa que um cliente procura ao abrir um relatório de mídia.
 *
 * Oito no máximo: um relatório não é um catálogo, e cada imagem embutida pesa
 * no arquivo que vai por e-mail.
 */
function GaleriaDeCriativos({ criativos }: { criativos: ReportCreative[] }) {
  if (criativos.length === 0) return null;
  const visiveis = criativos.slice(0, 8);
  /**
   * LINHAS DE QUATRO, cada uma indivisível, e o TÍTULO DENTRO DA PRIMEIRA. Com
   * o título solto, ele ficava sozinho no pé de uma página e as imagens
   * começavam na seguinte (visto no PDF de exemplo, 22/10/2026).
   */
  const linhas: ReportCreative[][] = [];
  for (let i = 0; i < visiveis.length; i += 4) linhas.push(visiveis.slice(i, i + 4));
  return (
    <View>
      {linhas.map((linha, indice) => (
        <View key={indice} wrap={false} style={{ marginTop: indice > 0 ? 8 : 0 }}>
          {indice === 0 && <Text style={styles.galeriaTitulo}>Criativos no ar</Text>}
          <View style={styles.galeria}>
            {linha.map((c) => (
              <View key={c.id} style={styles.criativo}>
                {c.imagem ? <Image style={styles.criativoImagem} src={c.imagem} /> : <View style={styles.criativoSemArte} />}
                <View style={styles.criativoLegenda}>
                  <Text style={styles.criativoNome}>{c.name.slice(0, 34)}</Text>
                  <Text style={styles.criativoNumero}>
                    {formatarMoeda(c.spend)} · CTR {formatarPercentual(c.ctr)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * A fatia de cada canal no investimento. Só aparece com DOIS canais lidos e com
 * gasto: com um canal só, "100%" não informa nada.
 */
function DistribuicaoDoInvestimento({ fatias }: { fatias: Array<{ nome: string; cor: string; valor: number }> }) {
  const total = fatias.reduce((soma, f) => soma + f.valor, 0);
  if (fatias.length < 2 || total <= 0) return null;
  return (
    <View style={{ marginBottom: 6 }} wrap={false}>
      <Text style={styles.distTitulo}>Distribuição do investimento</Text>
      <View style={styles.distBarra}>
        {fatias.map((f) => (
          <View key={f.nome} style={{ width: `${(f.valor / total) * 100}%`, backgroundColor: f.cor }} />
        ))}
      </View>
      <View style={styles.distLegenda}>
        {fatias.map((f) => (
          <View key={f.nome} style={styles.distItem}>
            <View style={[styles.distPonto, { backgroundColor: f.cor }]} />
            <Text style={styles.distTexto}>
              {f.nome} · {formatarMoeda(f.valor)} ({Math.round((f.valor / total) * 100)}%)
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function ClientReportDocument({ data }: { data: ClientReportData }) {
  /** Os canais que de fato foram LIDOS. Desconectado não entra na soma nem
   *  no rótulo: ele não contribui com zero, ele não contribui. */
  const canais: Array<{ nome: string; cor: string; dados: ChannelReportData }> = [
    ...(data.meta?.conectado ? [{ nome: 'Meta Ads', cor: COR_META, dados: data.meta }] : []),
    ...(data.googleAds?.conectado ? [{ nome: 'Google Ads', cor: COR_GOOGLE, dados: data.googleAds }] : []),
  ];
  const canaisLidos = canais.map((c) => c.nome);

  /** Soma só o que veio com valor. Nenhum valor em canal nenhum devolve
   *  ausência, nunca zero: zero é uma afirmação, ausência é a verdade. */
  function somaDosCanais(ler: (c: ChannelReportData) => number | null, formatar: (v: number | null) => string): string {
    const valores = canais.map((c) => ler(c.dados)).filter((v): v is number => v !== null);
    return valores.length === 0 ? SEM_DADO : formatar(valores.reduce((a, b) => a + b, 0));
  }

  const fatias = canais
    .map((c) => ({ nome: c.nome, cor: c.cor, valor: c.dados.atual?.spend ?? 0 }))
    .filter((f) => f.valor > 0);

  return (
    <Document title={`Relatório de Performance · ${data.clienteNome}`} author="Agência Desigual" subject="Relatório de mídia paga">
      <Page size="A4" style={styles.page}>
        {/* Faixa da marca nas páginas internas; na primeira, quem assina é a capa. */}
        {CAPA_PATH && (
          <View
            fixed
            style={styles.faixa}
            render={({ pageNumber }) => (pageNumber > 1 ? <Image src={CAPA_PATH} style={styles.faixaImagem} /> : null)}
          />
        )}

        <View style={styles.capa}>
          {CAPA_PATH && <Image src={CAPA_PATH} style={styles.capaImagem} />}
          <View style={styles.capaVeuTotal} />
          <View style={styles.capaVeuTexto} />
          <View style={styles.capaConteudo}>
            {LOGO_PATH ? <Image src={LOGO_PATH} style={styles.capaLogo} /> : <Text style={styles.capaMarca}>desigual</Text>}
            <View>
              <Text style={styles.capaEyebrow}>Relatório de performance · Mídia paga</Text>
              <Text style={styles.capaCliente}>{data.clienteNome}</Text>
              <Text style={styles.capaPeriodo}>
                {formatarData(data.periodoInicio)} a {formatarData(data.periodoFim)} · {data.periodoDias} dias
              </Text>
            </View>
          </View>
          <View style={styles.capaFio} />
          <View style={styles.capaFioSinal} />
        </View>

        <Text style={styles.intro}>
          Visão consolidada do investimento e dos resultados das campanhas no período, comparada ao período imediatamente anterior de mesma duração.
        </Text>

        <TituloDeSecao texto="Resumo executivo" nota={canaisLidos.length > 0 ? canaisLidos.join(' e ') : undefined} />
        {/*
          * "TOTAL" SÓ QUANDO É TOTAL. A versão anterior somava
          * `(meta ?? 0) + (google ?? 0)` e chamava de "Investimento total":
          * com um canal desconectado, o zero dele entrava na conta e o
          * parcial virava total. A soma percorre só os canais conectados e o
          * rótulo diz quais são. Nenhum canal lido vira ausência, nunca
          * R$ 0,00: num relatório que o cliente recebe, "zero investido" é uma
          * afirmação sobre o mês dele.
          */}
        <View style={styles.kpiLinha} wrap={false}>
          <KpiCard label="Investimento" valor={somaDosCanais((c) => c.atual?.spend ?? null, formatarMoeda)} variacaoDoPeriodo={null} subirEhBom={false} />
          <KpiCard label="Resultados" valor={somaDosCanais((c) => c.atual?.resultados ?? null, formatarNumero)} variacaoDoPeriodo={null} subirEhBom acento={LIMAO_ESCURO} />
          <KpiCard label="Período" valor={`${data.periodoDias} dias`} variacaoDoPeriodo={null} subirEhBom />
          <KpiCard label="Canais conectados" valor={canaisLidos.length === 0 ? 'nenhum' : `${canaisLidos.length} de 2`} variacaoDoPeriodo={null} subirEhBom acento={LIMAO_ESCURO} />
        </View>

        <DistribuicaoDoInvestimento fatias={fatias} />

        {data.meta && <SecaoDeCanal titulo="Meta Ads" cor={COR_META} canal={data.meta} />}
        {data.googleAds && <SecaoDeCanal titulo="Google Ads" cor={COR_GOOGLE} canal={data.googleAds} />}

        <View style={styles.leitura} wrap={false}>
          <Text style={styles.leituraTitulo}>Como ler este relatório</Text>
          <Text style={styles.leituraTexto}>
            Os números vêm diretamente das plataformas de anúncio. Resultados seguem a definição de conversão de cada plataforma e podem não ser equivalentes entre elas. As variações comparam com o período imediatamente anterior, de mesma duração.
          </Text>
        </View>

        <View style={styles.rodape} fixed>
          {LOGO_PATH && <Image src={LOGO_PATH} style={styles.rodapeLogo} />}
          <Text style={styles.rodapeTexto}>Agência Desigual · gerado em {formatarCarimbo(data.geradoEm)}</Text>
          <Text style={styles.rodapePagina} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
