import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * client-report-document.tsx — o PDF de Relatório de Performance (§46-51 do
 * prompt de refinamento "FINAL PRODUCT REFINEMENT", 06/10/2026).
 *
 * TODA CONCLUSÃO NUMÉRICA VEM DOS DADOS REAIS (§50): este arquivo só formata
 * o que `generate-client-report.ts` já buscou na Graph API / Google Ads API.
 * Nenhuma interpretação de IA entra aqui ainda — deliberado, não esquecido
 * (ver cabeçalho do processor): o prompt exige separar DADO de
 * INTERPRETAÇÃO, e uma geração de texto apressada no fim de um recurso grande
 * é exatamente onde essa separação vaza. Fica para quando houver tempo de
 * fazer essa fronteira direito.
 */
/**
 * O build empacota tudo num `dist/index.js` só (apps/worker/build.mjs) — em
 * produção, `import.meta.url` resolve pro ARQUIVO EMPACOTADO
 * (`apps/worker/dist/`), não pra onde este arquivo-fonte mora em `src/`
 * (mesma régua de 3 níveis que apps/worker/src/env.ts já usa pra achar o
 * `.env` da raiz a partir de `dist/`). Em teste/dev sem build, o arquivo
 * roda direto de `src/reports/`, um nível mais fundo. Em vez de arriscar o
 * caminho errado num dos dois ambientes, testa os dois e usa o que existir —
 * sem nenhum, o relatório sai sem logo em vez de quebrar por um asset.
 */
function acharLogo(): string | null {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidatos = [
    resolve(currentDir, '../../../assets/LOGO PRETA.png'), // produção: dist/ -> raiz
    resolve(currentDir, '../../../../assets/LOGO PRETA.png'), // dev/teste: src/reports/ -> raiz
  ];
  return candidatos.find((caminho) => existsSync(caminho)) ?? null;
}
const LOGO_PATH = acharLogo();

/**
 * A PALETA É A DA MARCA, lida de `apps/web/src/styles/tokens.css` e não
 * escolhida aqui. O roxo era `#6b21a8`, que é a `ametista` (secundária); a
 * identidade da Desigual é `roxo-eletrico`, `#9333ea`. Um documento que vai
 * pro cliente assinado pela agência não pode usar a cor de apoio como se
 * fosse a principal.
 *
 * O MIOLO CONTINUA CLARO, de propósito. A interface é escura, mas isto é um
 * PDF que a pessoa imprime, anexa em e-mail e abre no celular: fundo carbono
 * numa folha A4 gasta tinta, perde contraste em impressora e vira mancha em
 * leitor que força tema claro. A marca entra na faixa do topo, nas cores de
 * destaque e na tipografia, que é onde ela se reconhece sem atrapalhar a
 * leitura.
 */
const ROXO = '#9333ea';
const ROXO_ESCURO = '#6b21a8';
const CARBONO = '#0f0f0f';
const SINAL = '#e1f900';
const CINZA_TEXTO = '#404040';
const CINZA_CLARO = '#8a8a8a';
const BORDA = '#e5e5e5';

/** Quatro por linha a 118pt cabem na largura útil do A4 com o padding de 40. */
const CRIATIVO_LARGURA = 118;

const styles = StyleSheet.create({
  galeriaTitulo: { fontSize: 9, color: CINZA_CLARO, marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.6 },
  galeria: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  criativo: { width: CRIATIVO_LARGURA, borderWidth: 1, borderColor: BORDA, borderRadius: 4, overflow: 'hidden' },
  criativoImagem: { width: CRIATIVO_LARGURA, height: 88, objectFit: 'cover' },
  criativoSemArte: { width: CRIATIVO_LARGURA, height: 88, backgroundColor: '#f5f5f5' },
  criativoLegenda: { padding: 5 },
  criativoNome: { fontSize: 7, color: CINZA_TEXTO },
  criativoNumero: { fontSize: 6.5, color: CINZA_CLARO, marginTop: 2 },
  page: { padding: 40, fontSize: 10, color: CINZA_TEXTO, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, borderBottom: `2 solid ${ROXO}`, paddingBottom: 12 },
  logo: { width: 90, height: 30, objectFit: 'contain' },
  headerRight: { alignItems: 'flex-end' },
  title: { fontSize: 18, fontWeight: 700, color: '#141414', marginBottom: 2 },
  subtitle: { fontSize: 10, color: CINZA_CLARO },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: '#141414', marginTop: 20, marginBottom: 8 },
  kpiRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  kpiBox: { flex: 1, borderWidth: 1, borderColor: BORDA, borderRadius: 4, padding: 8 },
  kpiLabel: { fontSize: 8, color: CINZA_CLARO, textTransform: 'uppercase', marginBottom: 3 },
  kpiValue: { fontSize: 14, fontWeight: 700, color: '#141414' },
  kpiDelta: { fontSize: 8, marginTop: 2 },
  deltaUp: { color: '#15803d' },
  deltaDown: { color: '#b91c1c' },
  table: { borderWidth: 1, borderColor: BORDA, borderRadius: 4, overflow: 'hidden' },
  tableHeaderRow: { flexDirection: 'row', backgroundColor: '#f5f3f7', borderBottomWidth: 1, borderBottomColor: BORDA, paddingVertical: 5, paddingHorizontal: 6 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDA, paddingVertical: 5, paddingHorizontal: 6 },
  tableHeaderCell: { fontSize: 8, fontWeight: 700, color: CINZA_CLARO, textTransform: 'uppercase' },
  tableCell: { fontSize: 9 },
  colName: { flex: 3 }, colStatus: { flex: 1.5 }, colNum: { flex: 1.2, textAlign: 'right' },
  notice: { fontSize: 9, color: CINZA_CLARO, fontStyle: 'italic', marginTop: 4 },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', fontSize: 8, color: CINZA_CLARO, borderTop: `1 solid ${BORDA}`, paddingTop: 6 },
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

function formatarData(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
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

function statusLegivel(status: string): string {
  return STATUS_EM_PORTUGUES[status.toUpperCase()] ?? status;
}

function formatarMoeda(valor: number | null): string {
  if (valor === null) return SEM_DADO;
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);
}

function formatarNumero(valor: number | null): string {
  if (valor === null) return SEM_DADO;
  return new Intl.NumberFormat('pt-BR').format(Math.round(valor));
}

function delta(atual: number | null, anterior: number | null): string | null {
  if (atual === null || anterior === null || anterior === 0) return null;
  const pct = ((atual - anterior) / anterior) * 100;
  const sinal = pct >= 0 ? '+' : '';
  return `${sinal}${pct.toFixed(1)}% vs período anterior`;
}

function KpiBox({ label, valor, deltaTexto, deltaPositivoEhBom }: { label: string; valor: string; deltaTexto: string | null; deltaPositivoEhBom: boolean }) {
  const positivo = deltaTexto?.startsWith('+');
  const bom = positivo === deltaPositivoEhBom;
  return (
    <View style={styles.kpiBox}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={styles.kpiValue}>{valor}</Text>
      {deltaTexto && <Text style={[styles.kpiDelta, bom ? styles.deltaUp : styles.deltaDown]}>{deltaTexto}</Text>}
    </View>
  );
}

function SecaoDeCanal({ titulo, canal }: { titulo: string; canal: ChannelReportData }) {
  if (!canal.conectado) {
    return (
      <View>
        <Text style={styles.sectionTitle}>{titulo}</Text>
        <Text style={styles.notice}>{canal.motivoNaoConectado ?? `${titulo} não está conectado para este cliente.`}</Text>
      </View>
    );
  }

  /**
   * SEM `break` FORÇADO. O canal conectado abria página nova sempre, e o
   * resultado era uma folha 1 com quatro caixinhas e dois terços de papel em
   * branco, visível no primeiro PDF que eu abri. Deixar o conteúdo fluir faz
   * o resumo e o primeiro canal dividirem a mesma página; o `wrap={false}` da
   * galeria continua impedindo que um bloco de criativos nasça partido ao
   * meio.
   */
  return (
    <View>
      <Text style={styles.sectionTitle}>{titulo}</Text>
      <View style={styles.kpiRow}>
        <KpiBox label="Investimento" valor={formatarMoeda(canal.atual?.spend ?? null)} deltaTexto={delta(canal.atual?.spend ?? null, canal.anterior?.spend ?? null)} deltaPositivoEhBom={false} />
        <KpiBox label="Resultados" valor={formatarNumero(canal.atual?.resultados ?? null)} deltaTexto={delta(canal.atual?.resultados ?? null, canal.anterior?.resultados ?? null)} deltaPositivoEhBom />
        <KpiBox label="CTR" valor={canal.atual?.ctr != null ? `${canal.atual.ctr.toFixed(2)}%` : SEM_DADO} deltaTexto={delta(canal.atual?.ctr ?? null, canal.anterior?.ctr ?? null)} deltaPositivoEhBom />
        <KpiBox label="Custo médio" valor={formatarMoeda(canal.atual?.custoMedio ?? null)} deltaTexto={delta(canal.atual?.custoMedio ?? null, canal.anterior?.custoMedio ?? null)} deltaPositivoEhBom={false} />
      </View>

      {canal.campanhas.length > 0 && (
        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderCell, styles.colName]}>Campanha</Text>
            <Text style={[styles.tableHeaderCell, styles.colStatus]}>Status</Text>
            <Text style={[styles.tableHeaderCell, styles.colNum]}>Investimento</Text>
            <Text style={[styles.tableHeaderCell, styles.colNum]}>CTR</Text>
          </View>
          {canal.campanhas.slice(0, 12).map((c) => (
            <View key={c.id} style={styles.tableRow}>
              <Text style={[styles.tableCell, styles.colName]}>{c.name}</Text>
              <Text style={[styles.tableCell, styles.colStatus]}>{statusLegivel(c.status)}</Text>
              <Text style={[styles.tableCell, styles.colNum]}>{formatarMoeda(c.spend)}</Text>
              <Text style={[styles.tableCell, styles.colNum]}>{c.ctr != null ? `${c.ctr.toFixed(2)}%` : SEM_DADO}</Text>
            </View>
          ))}
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
  return (
    <View>
      <Text style={styles.galeriaTitulo}>Criativos no ar</Text>
      <View style={styles.galeria}>
        {criativos.slice(0, 8).map((c) => (
          <View key={c.id} style={styles.criativo} wrap={false}>
            {c.imagem ? (
              <Image style={styles.criativoImagem} src={c.imagem} />
            ) : (
              <View style={styles.criativoSemArte} />
            )}
            <View style={styles.criativoLegenda}>
              <Text style={styles.criativoNome}>{c.name.slice(0, 34)}</Text>
              <Text style={styles.criativoNumero}>
                {formatarMoeda(c.spend)} · CTR {c.ctr != null ? `${c.ctr.toFixed(2)}%` : SEM_DADO}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function ClientReportDocument({ data }: { data: ClientReportData }) {
  /** Os canais que de fato foram LIDOS. Desconectado não entra na soma nem
   *  no rótulo: ele não contribui com zero, ele não contribui. */
  const canais: Array<{ nome: string; dados: ChannelReportData }> = [
    ...(data.meta?.conectado ? [{ nome: 'Meta Ads', dados: data.meta }] : []),
    ...(data.googleAds?.conectado ? [{ nome: 'Google Ads', dados: data.googleAds }] : []),
  ];
  const canaisLidos = canais.map((c) => c.nome);

  /** Soma só o que veio com valor. Nenhum valor em canal nenhum devolve
   *  ausência, nunca zero: zero é uma afirmação, ausência é a verdade. */
  function somaDosCanais(ler: (c: ChannelReportData) => number | null, formatar: (v: number | null) => string): string {
    const valores = canais.map((c) => ler(c.dados)).filter((v): v is number => v !== null);
    return valores.length === 0 ? SEM_DADO : formatar(valores.reduce((a, b) => a + b, 0));
  }

  return (
    <Document title={`Relatório de Performance · ${data.clienteNome}`} author="Desigual OS">
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          {LOGO_PATH ? <Image src={LOGO_PATH} style={styles.logo} /> : <Text style={{ fontSize: 14, fontWeight: 700, color: ROXO }}>DESIGUAL</Text>}
          <View style={styles.headerRight}>
            <Text style={styles.title}>Relatório de Performance</Text>
            <Text style={styles.subtitle}>
              {data.clienteNome} · {formatarData(data.periodoInicio)} a {formatarData(data.periodoFim)}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Resumo executivo</Text>
        {/*
          * "TOTAL" SÓ QUANDO É TOTAL. A versão anterior somava
          * `(meta ?? 0) + (google ?? 0)` e chamava de "Investimento total":
          * com um canal desconectado, o zero dele entrava na conta e o
          * parcial virava total. Se o cliente também investe no canal que
          * não está ligado, o relatório SUBESTIMA o gasto e nada na página
          * avisa.
          *
          * Agora a soma percorre só os canais conectados e o rótulo diz
          * quais são. Nenhum canal lido vira ausência, nunca R$ 0,00: num
          * relatório que o cliente recebe, "zero investido" é uma afirmação
          * sobre o mês dele.
          */}
        <View style={styles.kpiRow}>
          <KpiBox
            label={canaisLidos.length === 0 ? 'Investimento' : `Investimento · ${canaisLidos.join(' e ')}`}
            valor={somaDosCanais((c) => c.atual?.spend ?? null, formatarMoeda)}
            deltaTexto={null}
            deltaPositivoEhBom={false}
          />
          <KpiBox
            label={canaisLidos.length === 0 ? 'Resultados' : `Resultados · ${canaisLidos.join(' e ')}`}
            valor={somaDosCanais((c) => c.atual?.resultados ?? null, formatarNumero)}
            deltaTexto={null}
            deltaPositivoEhBom
          />
          <KpiBox label="Período" valor={`${data.periodoDias} dias`} deltaTexto={null} deltaPositivoEhBom />
          <KpiBox
            label="Canais conectados"
            valor={canaisLidos.length === 0 ? 'nenhum' : `${canaisLidos.length} de 2`}
            deltaTexto={null}
            deltaPositivoEhBom
          />
        </View>

        {data.meta && <SecaoDeCanal titulo="Meta Ads" canal={data.meta} />}
        {data.googleAds && <SecaoDeCanal titulo="Google Ads" canal={data.googleAds} />}

        <View style={styles.footer} fixed>
          <Text>Desigual OS · gerado em {data.geradoEm.toLocaleString('pt-BR')}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
