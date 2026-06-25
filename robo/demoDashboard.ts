// Gera o painel (output/dashboard-demo.html) LENDO DO BIGQUERY, agora com
// FILTRO DE DATA (de / até). As vendas são embutidas na página e o filtro
// recalcula tudo no próprio navegador — funciona offline, sem servidor.
//
// Rodar:  npx tsx scripts/demoDashboard.ts
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { BigQuery } from "@google-cloud/bigquery";
import { config } from "../src/config/index.js";

// Logo do supermercado embutida (base64) — mantém o HTML offline/single-file.
const logoDataUri = "data:image/png;base64," + (await readFile("assets/logo-santa-rita.png")).toString("base64");
const qrcodeLib = (await readFile("assets/qrcode-generator.js")).toString();

if (!config.BQ_PROJECT_ID) throw new Error("BQ_PROJECT_ID não configurado no .env");
const bq = new BigQuery({ projectId: config.BQ_PROJECT_ID, location: config.BQ_LOCATION });
const DS = `\`${config.BQ_PROJECT_ID}.${config.BQ_DATASET}`;

async function q<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const [rows] = await bq.query({ query: sql, location: config.BQ_LOCATION });
  return rows as T[];
}
const txt = (v: unknown): string =>
  v && typeof v === "object" && "value" in v ? String((v as { value: unknown }).value) : String(v ?? "");
const n = (v: unknown): number => Number(txt(v)) || 0;

// ---- dados REAIS do VR (resumos prontos, gerados por scripts/buildVrData.cjs) ----
const vr = JSON.parse(await readFile("output/vr-data.json", "utf8")) as {
  DIA: { d: string; fat: number; marg: number; qtd: number; cup: number }[];
  HORA: { d: string; h: string; fat: number }[];
  OP: { d: string; o: string; fat: number; cup: number }[];
  PAG: { d: string; p: string; fat: number }[];
  SETOR: { d: string; s: string; fat: number }[];
  MESPROD: { m: string; id: string; nome: string; qtd: number; fat: number }[];
};
const { DIA, HORA, OP, PAG, SETOR, MESPROD } = vr;
const estoque: { id_produto: string; produto: string; setor: string; estoque: number; ruptura: string }[] = [];

const dataMin = DIA.length ? DIA[0].d : "";
const dataMax = DIA.length ? DIA[DIA.length - 1].d : "";
// Data inicial padrão = dia de hoje (o dia mais recente com dados). Abre mostrando só o dia atual.
const defaultDe = dataMax || dataMin;
const geradoEm = new Date().toLocaleString("pt-BR");

// Lista unica de produtos (codigo + nome) a partir do ranking - para o autocompletar.
const produtosUnicos = [...new Map(MESPROD.map((p) => [p.id, p.nome] as [string, string])).entries()]
  .sort((a, b) => a[1].localeCompare(b[1]));
// Autocompletar do CÓDIGO: só o código (sem o nome embaixo), senão o navegador
// casaria o que foi digitado também com o texto do nome ("1kg", "1L", etc.).
const datalistCodigos = produtosUnicos
  .map(([cod]) => `<option value="${cod}"></option>`)
  .join("");
// Autocompletar do NOME: só o nome.
const datalistNomes = produtosUnicos
  .map(([, nome]) => `<option value="${nome}"></option>`)
  .join("");

// Roster inicial da escala (extraído da planilha "Escala Para os Domingos.xlsx").
// É só o ponto de partida — o usuário edita no navegador e tudo fica salvo lá.
const operacaoSeed = {"2025-11-17":[["Análise de produto","Sexta da Carne","2026-01-02"]],"2025-11-19":[["Reunião de compras","Sexta da Carne","2026-01-02"],["Análise de produto","Terçou das Frutas e Verduras","2026-01-06"]],"2025-11-21":[["Reunião de compras","Terçou das Frutas e Verduras","2026-01-06"]],"2025-11-24":[["Análise de produto","Sexta da Carne","2026-01-09"]],"2025-11-25":[["Análise de produto","Sábado Bombástico (Prorrogado)","2026-01-11"],["Análise de produto","Sábado Bombástico","2026-01-10"]],"2025-11-26":[["Reunião de compras","Sexta da Carne","2026-01-09"],["Análise de produto","Terçou das Frutas e Verduras","2026-01-13"]],"2025-11-27":[["Reunião de compras","Sábado Bombástico (Prorrogado)","2026-01-11"],["Reunião de compras","Sábado Bombástico","2026-01-10"]],"2025-11-28":[["Negociação","Sexta da Carne","2026-01-02"],["Reunião de compras","Terçou das Frutas e Verduras","2026-01-13"],["Análise de produto","Volta às Aulas","2026-01-15"]],"2025-12-01":[["Análise de produto","Sexta da Carne","2026-01-16"]],"2025-12-02":[["Aprovação","Sexta da Carne","2026-01-02"],["Negociação","Terçou das Frutas e Verduras","2026-01-06"],["Reunião de compras","Volta às Aulas","2026-01-15"]],"2025-12-03":[["Reunião de compras","Sexta da Carne","2026-01-16"],["Análise de produto","Terçou das Frutas e Verduras","2026-01-20"]],"2025-12-04":[["Pedido","Sexta da Carne","2026-01-02"],["Aprovação","Terçou das Frutas e Verduras","2026-01-06"]],"2025-12-05":[["Negociação","Sexta da Carne","2026-01-09"],["Reunião de compras","Terçou das Frutas e Verduras","2026-01-20"]],"2025-12-08":[["Pedido","Terçou das Frutas e Verduras","2026-01-06"],["Negociação","Sábado Bombástico (Prorrogado)","2026-01-11"],["Negociação","Sábado Bombástico","2026-01-10"],["Análise de produto","Sexta da Carne","2026-01-23"]],"2025-12-09":[["Aprovação","Sexta da Carne","2026-01-09"],["Negociação","Terçou das Frutas e Verduras","2026-01-13"]],"2025-12-10":[["Aprovação","Sábado Bombástico (Prorrogado)","2026-01-11"],["Aprovação","Sábado Bombástico","2026-01-10"],["Reunião de compras","Sexta da Carne","2026-01-23"],["Análise de produto","Terçou das Frutas e Verduras","2026-01-27"]],"2025-12-11":[["Pedido","Sexta da Carne","2026-01-09"],["Aprovação","Terçou das Frutas e Verduras","2026-01-13"],["Negociação","Volta às Aulas","2026-01-15"]],"2025-12-12":[["Pedido","Sábado Bombástico (Prorrogado)","2026-01-11"],["Pedido","Sábado Bombástico","2026-01-10"],["Negociação","Sexta da Carne","2026-01-16"],["Reunião de compras","Terçou das Frutas e Verduras","2026-01-27"],["Análise de produto","Hora da Economia","2026-01-29"]],"2025-12-15":[["Pedido","Terçou das Frutas e Verduras","2026-01-13"],["Aprovação","Volta às Aulas","2026-01-15"],["Análise de produto","Sexta da Carne","2026-01-30"]],"2025-12-16":[["Aprovação","Sexta da Carne","2026-01-16"],["Negociação","Terçou das Frutas e Verduras","2026-01-20"],["Reunião de compras","Hora da Economia","2026-01-29"]],"2025-12-17":[["Pedido","Volta às Aulas","2026-01-15"],["Reunião de compras","Sexta da Carne","2026-01-30"],["Análise de produto","Terçou das Frutas e Verduras","2026-02-03"]],"2025-12-18":[["Recebimento","Sexta da Carne","2026-01-02"],["Pedido","Sexta da Carne","2026-01-16"],["Aprovação","Terçou das Frutas e Verduras","2026-01-20"]],"2025-12-19":[["Negociação","Sexta da Carne","2026-01-23"],["Reunião de compras","Terçou das Frutas e Verduras","2026-02-03"]],"2025-12-22":[["Recebimento","Terçou das Frutas e Verduras","2026-01-06"],["Pedido","Terçou das Frutas e Verduras","2026-01-20"],["Análise de produto","Sexta da Carne","2026-02-06"]],"2025-12-23":[["Encarte","Sexta da Carne","2026-01-02"],["Aprovação","Sexta da Carne","2026-01-23"],["Negociação","Terçou das Frutas e Verduras","2026-01-27"]],"2025-12-24":[["Reunião de compras","Sexta da Carne","2026-02-06"],["Análise de produto","Terçou das Frutas e Verduras","2026-02-10"]],"2025-12-26":[["Encarte","Terçou das Frutas e Verduras","2026-01-06"],["Recebimento","Sexta da Carne","2026-01-09"],["Pedido","Sexta da Carne","2026-01-23"],["Aprovação","Terçou das Frutas e Verduras","2026-01-27"],["Negociação","Hora da Economia","2026-01-29"]],"2025-12-29":[["Recebimento","Sábado Bombástico (Prorrogado)","2026-01-11"],["Recebimento","Sábado Bombástico","2026-01-10"],["Negociação","Sexta da Carne","2026-01-30"],["Reunião de compras","Terçou das Frutas e Verduras","2026-02-10"]],"2025-12-30":[["Divulgação da campanha","Sexta da Carne","2026-01-02"],["Montagem","Sexta da Carne","2026-01-02"],["Recebimento","Terçou das Frutas e Verduras","2026-01-13"],["Pedido","Terçou das Frutas e Verduras","2026-01-27"],["Aprovação","Hora da Economia","2026-01-29"],["Análise de produto","Sexta da Carne","2026-02-13"]],"2025-12-31":[["Encarte","Sexta da Carne","2026-01-09"],["Aprovação","Sexta da Carne","2026-01-30"],["Negociação","Terçou das Frutas e Verduras","2026-02-03"],["Análise de produto","Sábado Bombástico (Prorrogado)","2026-02-15"],["Análise de produto","Carnaval","2026-02-16"],["Análise de produto","Sábado Bombástico","2026-02-14"]],"2026-01-01":[["Divulgação do encarte","Sexta da Carne","2026-01-02"]],"2026-01-02":[["Montagem","Terçou das Frutas e Verduras","2026-01-06"],["Encarte","Sábado Bombástico (Prorrogado)","2026-01-11"],["Encarte","Sábado Bombástico","2026-01-10"],["Recebimento","Volta às Aulas","2026-01-15"],["Pedido","Hora da Economia","2026-01-29"],["Reunião de compras","Sexta da Carne","2026-02-13"],["Análise de produto","Carnaval","2026-02-17"],["Análise de produto","Terçou das Frutas e Verduras","2026-02-17"]],"2026-01-03":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-01-06"]],"2026-01-05":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-01-06"],["Encarte","Terçou das Frutas e Verduras","2026-01-13"],["Recebimento","Sexta da Carne","2026-01-16"],["Pedido","Sexta da Carne","2026-01-30"],["Aprovação","Terçou das Frutas e Verduras","2026-02-03"],["Reunião de compras","Sábado Bombástico (Prorrogado)","2026-02-15"],["Reunião de compras","Carnaval","2026-02-16"],["Reunião de compras","Sábado Bombástico","2026-02-14"]],"2026-01-06":[["Divulgação da campanha","Sexta da Carne","2026-01-09"],["Negociação","Sexta da Carne","2026-02-06"],["Reunião de compras","Carnaval","2026-02-17"],["Reunião de compras","Terçou das Frutas e Verduras","2026-02-17"]],"2026-01-07":[["Montagem","Sexta da Carne","2026-01-09"],["Divulgação da campanha","Sábado Bombástico","2026-01-10"],["Encarte","Volta às Aulas","2026-01-15"],["Recebimento","Terçou das Frutas e Verduras","2026-01-20"],["Pedido","Terçou das Frutas e Verduras","2026-02-03"],["Análise de produto","Sexta da Carne","2026-02-20"]],"2026-01-08":[["Divulgação do encarte","Sexta da Carne","2026-01-09"],["Divulgação da campanha","Sábado Bombástico (Prorrogado)","2026-01-11"],["Montagem","Sábado Bombástico (Prorrogado)","2026-01-11"],["Montagem","Sábado Bombástico","2026-01-10"],["Encarte","Sexta da Carne","2026-01-16"],["Aprovação","Sexta da Carne","2026-02-06"],["Negociação","Terçou das Frutas e Verduras","2026-02-10"]],"2026-01-09":[["Divulgação do encarte","Sábado Bombástico","2026-01-10"],["Montagem","Terçou das Frutas e Verduras","2026-01-13"],["Reunião de compras","Sexta da Carne","2026-02-20"],["Análise de produto","Terçou das Frutas e Verduras","2026-02-24"]],"2026-01-10":[["Divulgação do encarte","Sábado Bombástico (Prorrogado)","2026-01-11"],["Divulgação da campanha","Terçou das Frutas e Verduras","2026-01-13"]],"2026-01-12":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-01-13"],["Divulgação da campanha","Volta às Aulas","2026-01-15"],["Encarte","Terçou das Frutas e Verduras","2026-01-20"],["Recebimento","Sexta da Carne","2026-01-23"],["Pedido","Sexta da Carne","2026-02-06"],["Aprovação","Terçou das Frutas e Verduras","2026-02-10"]],"2026-01-13":[["Montagem","Volta às Aulas","2026-01-15"],["Divulgação da campanha","Sexta da Carne","2026-01-16"],["Negociação","Sexta da Carne","2026-02-13"],["Reunião de compras","Terçou das Frutas e Verduras","2026-02-24"],["Análise de produto","Hora da Economia","2026-02-26"]],"2026-01-14":[["Divulgação do encarte","Volta às Aulas","2026-01-15"],["Montagem","Sexta da Carne","2026-01-16"],["Recebimento","Terçou das Frutas e Verduras","2026-01-27"],["Pedido","Terçou das Frutas e Verduras","2026-02-10"],["Negociação","Sábado Bombástico (Prorrogado)","2026-02-15"],["Negociação","Carnaval","2026-02-16"],["Negociação","Sábado Bombástico","2026-02-14"],["Análise de produto","Sexta da Carne","2026-02-27"]],"2026-01-15":[["Divulgação do encarte","Sexta da Carne","2026-01-16"],["Encarte","Sexta da Carne","2026-01-23"],["Aprovação","Sexta da Carne","2026-02-13"],["Negociação","Carnaval","2026-02-17"],["Negociação","Terçou das Frutas e Verduras","2026-02-17"],["Reunião de compras","Hora da Economia","2026-02-26"]],"2026-01-16":[["Montagem","Terçou das Frutas e Verduras","2026-01-20"],["Recebimento","Hora da Economia","2026-01-29"],["Aprovação","Sábado Bombástico (Prorrogado)","2026-02-15"],["Aprovação","Carnaval","2026-02-16"],["Aprovação","Sábado Bombástico","2026-02-14"],["Reunião de compras","Sexta da Carne","2026-02-27"],["Análise de produto","Terçou das Frutas e Verduras","2026-03-03"]],"2026-01-17":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-01-20"]],"2026-01-19":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-01-20"],["Encarte","Terçou das Frutas e Verduras","2026-01-27"],["Recebimento","Sexta da Carne","2026-01-30"],["Pedido","Sexta da Carne","2026-02-13"],["Aprovação","Carnaval","2026-02-17"],["Aprovação","Terçou das Frutas e Verduras","2026-02-17"]],"2026-01-20":[["Divulgação da campanha","Sexta da Carne","2026-01-23"],["Pedido","Sábado Bombástico (Prorrogado)","2026-02-15"],["Pedido","Carnaval","2026-02-16"],["Pedido","Sábado Bombástico","2026-02-14"],["Negociação","Sexta da Carne","2026-02-20"],["Reunião de compras","Terçou das Frutas e Verduras","2026-03-03"]],"2026-01-21":[["Montagem","Sexta da Carne","2026-01-23"],["Encarte","Hora da Economia","2026-01-29"],["Recebimento","Terçou das Frutas e Verduras","2026-02-03"],["Pedido","Carnaval","2026-02-17"],["Pedido","Terçou das Frutas e Verduras","2026-02-17"],["Análise de produto","Sexta da Carne","2026-03-06"]],"2026-01-22":[["Divulgação do encarte","Sexta da Carne","2026-01-23"],["Encarte","Sexta da Carne","2026-01-30"],["Aprovação","Sexta da Carne","2026-02-20"],["Negociação","Terçou das Frutas e Verduras","2026-02-24"],["Análise de produto","Dia da Mulher","2026-03-08"]],"2026-01-23":[["Montagem","Terçou das Frutas e Verduras","2026-01-27"],["Reunião de compras","Sexta da Carne","2026-03-06"],["Análise de produto","Terçou das Frutas e Verduras","2026-03-10"]],"2026-01-24":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-01-27"]],"2026-01-26":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-01-27"],["Divulgação da campanha","Hora da Economia","2026-01-29"],["Encarte","Terçou das Frutas e Verduras","2026-02-03"],["Recebimento","Sexta da Carne","2026-02-06"],["Pedido","Sexta da Carne","2026-02-20"],["Aprovação","Terçou das Frutas e Verduras","2026-02-24"],["Negociação","Hora da Economia","2026-02-26"],["Reunião de compras","Dia da Mulher","2026-03-08"]],"2026-01-27":[["Montagem","Hora da Economia","2026-01-29"],["Divulgação da campanha","Sexta da Carne","2026-01-30"],["Negociação","Sexta da Carne","2026-02-27"],["Reunião de compras","Terçou das Frutas e Verduras","2026-03-10"]],"2026-01-28":[["Divulgação do encarte","Hora da Economia","2026-01-29"],["Montagem","Sexta da Carne","2026-01-30"],["Recebimento","Terçou das Frutas e Verduras","2026-02-10"],["Pedido","Terçou das Frutas e Verduras","2026-02-24"],["Aprovação","Hora da Economia","2026-02-26"],["Análise de produto","Sexta da Carne","2026-03-13"]],"2026-01-29":[["Divulgação do encarte","Sexta da Carne","2026-01-30"],["Encarte","Sexta da Carne","2026-02-06"],["Aprovação","Sexta da Carne","2026-02-27"],["Negociação","Terçou das Frutas e Verduras","2026-03-03"],["Análise de produto","Dia do Consumidor","2026-03-15"],["Análise de produto","Sábado Bombástico","2026-03-14"],["Análise de produto","Sábado Bombástico","2026-03-15"]],"2026-01-30":[["Montagem","Terçou das Frutas e Verduras","2026-02-03"],["Pedido","Hora da Economia","2026-02-26"],["Reunião de compras","Sexta da Carne","2026-03-13"],["Análise de produto","Terçou das Frutas e Verduras","2026-03-17"]],"2026-01-31":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-02-03"]],"2026-02-02":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-02-03"],["Encarte","Terçou das Frutas e Verduras","2026-02-10"],["Recebimento","Sexta da Carne","2026-02-13"],["Pedido","Sexta da Carne","2026-02-27"],["Aprovação","Terçou das Frutas e Verduras","2026-03-03"],["Reunião de compras","Dia do Consumidor","2026-03-15"],["Reunião de compras","Sábado Bombástico","2026-03-14"],["Reunião de compras","Sábado Bombástico","2026-03-15"]],"2026-02-03":[["Divulgação da campanha","Sexta da Carne","2026-02-06"],["Recebimento","Sábado Bombástico (Prorrogado)","2026-02-15"],["Recebimento","Carnaval","2026-02-16"],["Recebimento","Sábado Bombástico","2026-02-14"],["Negociação","Sexta da Carne","2026-03-06"],["Reunião de compras","Terçou das Frutas e Verduras","2026-03-17"]],"2026-02-04":[["Montagem","Sexta da Carne","2026-02-06"],["Recebimento","Carnaval","2026-02-17"],["Recebimento","Terçou das Frutas e Verduras","2026-02-17"],["Pedido","Terçou das Frutas e Verduras","2026-03-03"],["Negociação","Dia da Mulher","2026-03-08"],["Análise de produto","Sexta da Carne","2026-03-20"]],"2026-02-05":[["Divulgação do encarte","Sexta da Carne","2026-02-06"],["Encarte","Sexta da Carne","2026-02-13"],["Aprovação","Sexta da Carne","2026-03-06"],["Negociação","Terçou das Frutas e Verduras","2026-03-10"]],"2026-02-06":[["Montagem","Terçou das Frutas e Verduras","2026-02-10"],["Encarte","Sábado Bombástico (Prorrogado)","2026-02-15"],["Encarte","Carnaval","2026-02-16"],["Encarte","Sábado Bombástico","2026-02-14"],["Aprovação","Dia da Mulher","2026-03-08"],["Reunião de compras","Sexta da Carne","2026-03-20"],["Análise de produto","Terçou das Frutas e Verduras","2026-03-24"]],"2026-02-07":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-02-10"]],"2026-02-09":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-02-10"],["Encarte","Carnaval","2026-02-17"],["Encarte","Terçou das Frutas e Verduras","2026-02-17"],["Recebimento","Sexta da Carne","2026-02-20"],["Pedido","Sexta da Carne","2026-03-06"],["Aprovação","Terçou das Frutas e Verduras","2026-03-10"]],"2026-02-10":[["Divulgação da campanha","Sexta da Carne","2026-02-13"],["Pedido","Dia da Mulher","2026-03-08"],["Negociação","Sexta da Carne","2026-03-13"],["Reunião de compras","Terçou das Frutas e Verduras","2026-03-24"],["Análise de produto","Hora da Economia","2026-03-26"]],"2026-02-11":[["Montagem","Sexta da Carne","2026-02-13"],["Divulgação da campanha","Sábado Bombástico","2026-02-14"],["Recebimento","Terçou das Frutas e Verduras","2026-02-24"],["Pedido","Terçou das Frutas e Verduras","2026-03-10"],["Negociação","Dia do Consumidor","2026-03-15"],["Negociação","Sábado Bombástico","2026-03-14"],["Negociação","Sábado Bombástico","2026-03-15"],["Análise de produto","Sexta da Carne","2026-03-27"]],"2026-02-12":[["Divulgação do encarte","Sexta da Carne","2026-02-13"],["Divulgação da campanha","Sábado Bombástico (Prorrogado)","2026-02-15"],["Montagem","Sábado Bombástico (Prorrogado)","2026-02-15"],["Montagem","Carnaval","2026-02-16"],["Montagem","Sábado Bombástico","2026-02-14"],["Encarte","Sexta da Carne","2026-02-20"],["Aprovação","Sexta da Carne","2026-03-13"],["Negociação","Terçou das Frutas e Verduras","2026-03-17"],["Reunião de compras","Hora da Economia","2026-03-26"]],"2026-02-13":[["Divulgação da campanha","Carnaval","2026-02-16"],["Divulgação do encarte","Sábado Bombástico","2026-02-14"],["Montagem","Carnaval","2026-02-17"],["Montagem","Terçou das Frutas e Verduras","2026-02-17"],["Recebimento","Hora da Economia","2026-02-26"],["Aprovação","Dia do Consumidor","2026-03-15"],["Aprovação","Sábado Bombástico","2026-03-14"],["Aprovação","Sábado Bombástico","2026-03-15"],["Reunião de compras","Sexta da Carne","2026-03-27"],["Análise de produto","Terçou das Frutas e Verduras","2026-03-31"]],"2026-02-14":[["Divulgação do encarte","Sábado Bombástico (Prorrogado)","2026-02-15"],["Divulgação da campanha","Carnaval","2026-02-17"],["Divulgação da campanha","Terçou das Frutas e Verduras","2026-02-17"]],"2026-02-15":[["Divulgação do encarte","Carnaval","2026-02-16"]],"2026-02-16":[["Divulgação do encarte","Carnaval","2026-02-17"],["Divulgação do encarte","Terçou das Frutas e Verduras","2026-02-17"],["Encarte","Terçou das Frutas e Verduras","2026-02-24"],["Recebimento","Sexta da Carne","2026-02-27"],["Pedido","Sexta da Carne","2026-03-13"],["Aprovação","Terçou das Frutas e Verduras","2026-03-17"]],"2026-02-17":[["Divulgação da campanha","Sexta da Carne","2026-02-20"],["Pedido","Dia do Consumidor","2026-03-15"],["Pedido","Sábado Bombástico","2026-03-14"],["Pedido","Sábado Bombástico","2026-03-15"],["Negociação","Sexta da Carne","2026-03-20"],["Reunião de compras","Terçou das Frutas e Verduras","2026-03-31"]],"2026-02-18":[["Montagem","Sexta da Carne","2026-02-20"],["Encarte","Hora da Economia","2026-02-26"],["Recebimento","Terçou das Frutas e Verduras","2026-03-03"],["Pedido","Terçou das Frutas e Verduras","2026-03-17"],["Análise de produto","Páscoa","2026-04-05"]],"2026-02-19":[["Divulgação do encarte","Sexta da Carne","2026-02-20"],["Encarte","Sexta da Carne","2026-02-27"],["Aprovação","Sexta da Carne","2026-03-20"],["Negociação","Terçou das Frutas e Verduras","2026-03-24"],["Análise de produto","Terçou das Frutas e Verduras","2026-04-07"]],"2026-02-20":[["Montagem","Terçou das Frutas e Verduras","2026-02-24"],["Reunião de compras","Páscoa","2026-04-05"]],"2026-02-21":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-02-24"]],"2026-02-23":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-02-24"],["Divulgação da campanha","Hora da Economia","2026-02-26"],["Encarte","Terçou das Frutas e Verduras","2026-03-03"],["Recebimento","Sexta da Carne","2026-03-06"],["Pedido","Sexta da Carne","2026-03-20"],["Aprovação","Terçou das Frutas e Verduras","2026-03-24"],["Negociação","Hora da Economia","2026-03-26"],["Reunião de compras","Terçou das Frutas e Verduras","2026-04-07"]],"2026-02-24":[["Montagem","Hora da Economia","2026-02-26"],["Divulgação da campanha","Sexta da Carne","2026-02-27"],["Recebimento","Dia da Mulher","2026-03-08"],["Negociação","Sexta da Carne","2026-03-27"],["Análise de produto","Sexta da Carne","2026-04-10"]],"2026-02-25":[["Divulgação do encarte","Hora da Economia","2026-02-26"],["Montagem","Sexta da Carne","2026-02-27"],["Recebimento","Terçou das Frutas e Verduras","2026-03-10"],["Pedido","Terçou das Frutas e Verduras","2026-03-24"],["Aprovação","Hora da Economia","2026-03-26"],["Análise de produto","Sábado Bombástico (Prorrogado)","2026-04-12"],["Análise de produto","Sábado Bombástico","2026-04-11"]],"2026-02-26":[["Divulgação do encarte","Sexta da Carne","2026-02-27"],["Encarte","Sexta da Carne","2026-03-06"],["Aprovação","Sexta da Carne","2026-03-27"],["Negociação","Terçou das Frutas e Verduras","2026-03-31"],["Reunião de compras","Sexta da Carne","2026-04-10"],["Análise de produto","Terçou das Frutas e Verduras","2026-04-14"]],"2026-02-27":[["Montagem","Terçou das Frutas e Verduras","2026-03-03"],["Encarte","Dia da Mulher","2026-03-08"],["Pedido","Hora da Economia","2026-03-26"],["Reunião de compras","Sábado Bombástico (Prorrogado)","2026-04-12"],["Reunião de compras","Sábado Bombástico","2026-04-11"]],"2026-02-28":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-03-03"]],"2026-03-02":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-03-03"],["Encarte","Terçou das Frutas e Verduras","2026-03-10"],["Recebimento","Sexta da Carne","2026-03-13"],["Pedido","Sexta da Carne","2026-03-27"],["Aprovação","Terçou das Frutas e Verduras","2026-03-31"],["Reunião de compras","Terçou das Frutas e Verduras","2026-04-14"]],"2026-03-03":[["Divulgação da campanha","Sexta da Carne","2026-03-06"],["Recebimento","Dia do Consumidor","2026-03-15"],["Recebimento","Sábado Bombástico","2026-03-14"],["Recebimento","Sábado Bombástico","2026-03-15"],["Negociação","Páscoa","2026-04-05"],["Análise de produto","Sexta da Carne","2026-04-17"]],"2026-03-04":[["Montagem","Sexta da Carne","2026-03-06"],["Recebimento","Terçou das Frutas e Verduras","2026-03-17"],["Pedido","Terçou das Frutas e Verduras","2026-03-31"],["Negociação","Terçou das Frutas e Verduras","2026-04-07"]],"2026-03-05":[["Divulgação do encarte","Sexta da Carne","2026-03-06"],["Divulgação da campanha","Dia da Mulher","2026-03-08"],["Montagem","Dia da Mulher","2026-03-08"],["Encarte","Sexta da Carne","2026-03-13"],["Aprovação","Páscoa","2026-04-05"],["Reunião de compras","Sexta da Carne","2026-04-17"],["Análise de produto","Tiradentes","2026-04-21"],["Análise de produto","Terçou das Frutas e Verduras","2026-04-21"]],"2026-03-06":[["Montagem","Terçou das Frutas e Verduras","2026-03-10"],["Encarte","Dia do Consumidor","2026-03-15"],["Encarte","Sábado Bombástico","2026-03-14"],["Encarte","Sábado Bombástico","2026-03-15"],["Aprovação","Terçou das Frutas e Verduras","2026-04-07"]],"2026-03-07":[["Divulgação do encarte","Dia da Mulher","2026-03-08"],["Divulgação da campanha","Terçou das Frutas e Verduras","2026-03-10"]],"2026-03-09":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-03-10"],["Encarte","Terçou das Frutas e Verduras","2026-03-17"],["Recebimento","Sexta da Carne","2026-03-20"],["Pedido","Páscoa","2026-04-05"],["Negociação","Sexta da Carne","2026-04-10"],["Reunião de compras","Tiradentes","2026-04-21"],["Reunião de compras","Terçou das Frutas e Verduras","2026-04-21"]],"2026-03-10":[["Divulgação da campanha","Sexta da Carne","2026-03-13"],["Pedido","Terçou das Frutas e Verduras","2026-04-07"],["Negociação","Sábado Bombástico (Prorrogado)","2026-04-12"],["Negociação","Sábado Bombástico","2026-04-11"],["Análise de produto","Sexta da Carne","2026-04-24"]],"2026-03-11":[["Montagem","Sexta da Carne","2026-03-13"],["Divulgação da campanha","Sábado Bombástico","2026-03-14"],["Recebimento","Terçou das Frutas e Verduras","2026-03-24"],["Aprovação","Sexta da Carne","2026-04-10"],["Negociação","Terçou das Frutas e Verduras","2026-04-14"]],"2026-03-12":[["Divulgação do encarte","Sexta da Carne","2026-03-13"],["Divulgação da campanha","Dia do Consumidor","2026-03-15"],["Montagem","Dia do Consumidor","2026-03-15"],["Montagem","Sábado Bombástico","2026-03-14"],["Divulgação da campanha","Sábado Bombástico","2026-03-15"],["Montagem","Sábado Bombástico","2026-03-15"],["Encarte","Sexta da Carne","2026-03-20"],["Aprovação","Sábado Bombástico (Prorrogado)","2026-04-12"],["Aprovação","Sábado Bombástico","2026-04-11"],["Reunião de compras","Sexta da Carne","2026-04-24"],["Análise de produto","Terçou das Frutas e Verduras","2026-04-28"]],"2026-03-13":[["Divulgação do encarte","Sábado Bombástico","2026-03-14"],["Montagem","Terçou das Frutas e Verduras","2026-03-17"],["Recebimento","Hora da Economia","2026-03-26"],["Pedido","Sexta da Carne","2026-04-10"],["Aprovação","Terçou das Frutas e Verduras","2026-04-14"]],"2026-03-14":[["Divulgação do encarte","Dia do Consumidor","2026-03-15"],["Divulgação do encarte","Sábado Bombástico","2026-03-15"],["Divulgação da campanha","Terçou das Frutas e Verduras","2026-03-17"]],"2026-03-16":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-03-17"],["Encarte","Terçou das Frutas e Verduras","2026-03-24"],["Recebimento","Sexta da Carne","2026-03-27"],["Pedido","Sábado Bombástico (Prorrogado)","2026-04-12"],["Pedido","Sábado Bombástico","2026-04-11"],["Negociação","Sexta da Carne","2026-04-17"],["Reunião de compras","Terçou das Frutas e Verduras","2026-04-28"],["Análise de produto","Hora da Economia","2026-04-30"]],"2026-03-17":[["Divulgação da campanha","Sexta da Carne","2026-03-20"],["Pedido","Terçou das Frutas e Verduras","2026-04-14"]],"2026-03-18":[["Montagem","Sexta da Carne","2026-03-20"],["Encarte","Hora da Economia","2026-03-26"],["Recebimento","Terçou das Frutas e Verduras","2026-03-31"],["Aprovação","Sexta da Carne","2026-04-17"],["Negociação","Tiradentes","2026-04-21"],["Negociação","Terçou das Frutas e Verduras","2026-04-21"],["Reunião de compras","Hora da Economia","2026-04-30"],["Análise de produto","Terçou das Frutas e Verduras","2026-05-05"]],"2026-03-19":[["Divulgação do encarte","Sexta da Carne","2026-03-20"],["Encarte","Sexta da Carne","2026-03-27"]],"2026-03-20":[["Montagem","Terçou das Frutas e Verduras","2026-03-24"],["Pedido","Sexta da Carne","2026-04-17"],["Aprovação","Tiradentes","2026-04-21"],["Aprovação","Terçou das Frutas e Verduras","2026-04-21"],["Reunião de compras","Terçou das Frutas e Verduras","2026-05-05"]],"2026-03-21":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-03-24"]],"2026-03-23":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-03-24"],["Divulgação da campanha","Hora da Economia","2026-03-26"],["Encarte","Terçou das Frutas e Verduras","2026-03-31"],["Recebimento","Páscoa","2026-04-05"],["Negociação","Sexta da Carne","2026-04-24"],["Análise de produto","Sexta da Carne","2026-05-08"]],"2026-03-24":[["Montagem","Hora da Economia","2026-03-26"],["Divulgação da campanha","Sexta da Carne","2026-03-27"],["Recebimento","Terçou das Frutas e Verduras","2026-04-07"],["Pedido","Tiradentes","2026-04-21"],["Pedido","Terçou das Frutas e Verduras","2026-04-21"],["Análise de produto","Dia das Mães","2026-05-10"],["Análise de produto","Sábado Bombástico","2026-05-09"],["Análise de produto","Sábado Bombástico","2026-05-10"]],"2026-03-25":[["Divulgação do encarte","Hora da Economia","2026-03-26"],["Montagem","Sexta da Carne","2026-03-27"],["Aprovação","Sexta da Carne","2026-04-24"],["Negociação","Terçou das Frutas e Verduras","2026-04-28"],["Reunião de compras","Sexta da Carne","2026-05-08"],["Análise de produto","Terçou das Frutas e Verduras","2026-05-12"]],"2026-03-26":[["Divulgação do encarte","Sexta da Carne","2026-03-27"],["Encarte","Páscoa","2026-04-05"],["Reunião de compras","Dia das Mães","2026-05-10"],["Reunião de compras","Sábado Bombástico","2026-05-09"],["Reunião de compras","Sábado Bombástico","2026-05-10"]],"2026-03-27":[["Montagem","Terçou das Frutas e Verduras","2026-03-31"],["Encarte","Terçou das Frutas e Verduras","2026-04-07"],["Recebimento","Sexta da Carne","2026-04-10"],["Pedido","Sexta da Carne","2026-04-24"],["Aprovação","Terçou das Frutas e Verduras","2026-04-28"],["Negociação","Hora da Economia","2026-04-30"],["Reunião de compras","Terçou das Frutas e Verduras","2026-05-12"]],"2026-03-28":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-03-31"]],"2026-03-30":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-03-31"],["Recebimento","Sábado Bombástico (Prorrogado)","2026-04-12"],["Recebimento","Sábado Bombástico","2026-04-11"],["Análise de produto","Sexta da Carne","2026-05-15"]],"2026-03-31":[["Recebimento","Terçou das Frutas e Verduras","2026-04-14"],["Pedido","Terçou das Frutas e Verduras","2026-04-28"],["Aprovação","Hora da Economia","2026-04-30"],["Negociação","Terçou das Frutas e Verduras","2026-05-05"]],"2026-04-01":[["Montagem","Páscoa","2026-04-05"],["Encarte","Sexta da Carne","2026-04-10"],["Reunião de compras","Sexta da Carne","2026-05-15"],["Análise de produto","Terçou das Frutas e Verduras","2026-05-19"]],"2026-04-02":[["Divulgação da campanha","Páscoa","2026-04-05"],["Montagem","Terçou das Frutas e Verduras","2026-04-07"],["Encarte","Sábado Bombástico (Prorrogado)","2026-04-12"],["Encarte","Sábado Bombástico","2026-04-11"],["Pedido","Hora da Economia","2026-04-30"],["Aprovação","Terçou das Frutas e Verduras","2026-05-05"]],"2026-04-04":[["Divulgação do encarte","Páscoa","2026-04-05"],["Divulgação da campanha","Terçou das Frutas e Verduras","2026-04-07"]],"2026-04-06":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-04-07"],["Encarte","Terçou das Frutas e Verduras","2026-04-14"],["Recebimento","Sexta da Carne","2026-04-17"],["Negociação","Sexta da Carne","2026-05-08"],["Reunião de compras","Terçou das Frutas e Verduras","2026-05-19"]],"2026-04-07":[["Divulgação da campanha","Sexta da Carne","2026-04-10"],["Pedido","Terçou das Frutas e Verduras","2026-05-05"],["Negociação","Dia das Mães","2026-05-10"],["Negociação","Sábado Bombástico","2026-05-09"],["Negociação","Sábado Bombástico","2026-05-10"],["Análise de produto","Sexta da Carne","2026-05-22"]],"2026-04-08":[["Montagem","Sexta da Carne","2026-04-10"],["Divulgação da campanha","Sábado Bombástico","2026-04-11"],["Recebimento","Tiradentes","2026-04-21"],["Recebimento","Terçou das Frutas e Verduras","2026-04-21"],["Aprovação","Sexta da Carne","2026-05-08"],["Negociação","Terçou das Frutas e Verduras","2026-05-12"]],"2026-04-09":[["Divulgação do encarte","Sexta da Carne","2026-04-10"],["Divulgação da campanha","Sábado Bombástico (Prorrogado)","2026-04-12"],["Montagem","Sábado Bombástico (Prorrogado)","2026-04-12"],["Montagem","Sábado Bombástico","2026-04-11"],["Encarte","Sexta da Carne","2026-04-17"],["Aprovação","Dia das Mães","2026-05-10"],["Aprovação","Sábado Bombástico","2026-05-09"],["Aprovação","Sábado Bombástico","2026-05-10"],["Reunião de compras","Sexta da Carne","2026-05-22"],["Análise de produto","Terçou das Frutas e Verduras","2026-05-26"]],"2026-04-10":[["Divulgação do encarte","Sábado Bombástico","2026-04-11"],["Montagem","Terçou das Frutas e Verduras","2026-04-14"],["Pedido","Sexta da Carne","2026-05-08"],["Aprovação","Terçou das Frutas e Verduras","2026-05-12"]],"2026-04-11":[["Divulgação do encarte","Sábado Bombástico (Prorrogado)","2026-04-12"],["Divulgação da campanha","Terçou das Frutas e Verduras","2026-04-14"]],"2026-04-13":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-04-14"],["Encarte","Tiradentes","2026-04-21"],["Encarte","Terçou das Frutas e Verduras","2026-04-21"],["Recebimento","Sexta da Carne","2026-04-24"],["Pedido","Dia das Mães","2026-05-10"],["Pedido","Sábado Bombástico","2026-05-09"],["Pedido","Sábado Bombástico","2026-05-10"],["Negociação","Sexta da Carne","2026-05-15"],["Reunião de compras","Terçou das Frutas e Verduras","2026-05-26"],["Análise de produto","Hora da Economia","2026-05-28"]],"2026-04-14":[["Divulgação da campanha","Sexta da Carne","2026-04-17"],["Pedido","Terçou das Frutas e Verduras","2026-05-12"],["Análise de produto","Sexta da Carne","2026-05-29"]],"2026-04-15":[["Montagem","Sexta da Carne","2026-04-17"],["Recebimento","Terçou das Frutas e Verduras","2026-04-28"],["Aprovação","Sexta da Carne","2026-05-15"],["Negociação","Terçou das Frutas e Verduras","2026-05-19"],["Reunião de compras","Hora da Economia","2026-05-28"]],"2026-04-16":[["Divulgação do encarte","Sexta da Carne","2026-04-17"],["Encarte","Sexta da Carne","2026-04-24"],["Reunião de compras","Sexta da Carne","2026-05-29"],["Análise de produto","Terçou das Frutas e Verduras","2026-06-02"]],"2026-04-17":[["Montagem","Tiradentes","2026-04-21"],["Montagem","Terçou das Frutas e Verduras","2026-04-21"],["Recebimento","Hora da Economia","2026-04-30"],["Pedido","Sexta da Carne","2026-05-15"],["Aprovação","Terçou das Frutas e Verduras","2026-05-19"]],"2026-04-18":[["Divulgação da campanha","Tiradentes","2026-04-21"],["Divulgação da campanha","Terçou das Frutas e Verduras","2026-04-21"]],"2026-04-20":[["Divulgação do encarte","Tiradentes","2026-04-21"],["Divulgação do encarte","Terçou das Frutas e Verduras","2026-04-21"],["Encarte","Terçou das Frutas e Verduras","2026-04-28"],["Negociação","Sexta da Carne","2026-05-22"],["Reunião de compras","Terçou das Frutas e Verduras","2026-06-02"]],"2026-04-21":[["Divulgação da campanha","Sexta da Carne","2026-04-24"],["Recebimento","Terçou das Frutas e Verduras","2026-05-05"],["Pedido","Terçou das Frutas e Verduras","2026-05-19"],["Análise de produto","Sexta da Carne","2026-06-05"]],"2026-04-22":[["Montagem","Sexta da Carne","2026-04-24"],["Encarte","Hora da Economia","2026-04-30"],["Aprovação","Sexta da Carne","2026-05-22"],["Negociação","Terçou das Frutas e Verduras","2026-05-26"]],"2026-04-23":[["Divulgação do encarte","Sexta da Carne","2026-04-24"],["Reunião de compras","Sexta da Carne","2026-06-05"],["Análise de produto","Terçou das Frutas e Verduras","2026-06-09"]],"2026-04-24":[["Montagem","Terçou das Frutas e Verduras","2026-04-28"],["Encarte","Terçou das Frutas e Verduras","2026-05-05"],["Recebimento","Sexta da Carne","2026-05-08"],["Pedido","Sexta da Carne","2026-05-22"],["Aprovação","Terçou das Frutas e Verduras","2026-05-26"],["Negociação","Hora da Economia","2026-05-28"]],"2026-04-25":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-04-28"]],"2026-04-27":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-04-28"],["Divulgação da campanha","Hora da Economia","2026-04-30"],["Recebimento","Dia das Mães","2026-05-10"],["Recebimento","Sábado Bombástico","2026-05-09"],["Recebimento","Sábado Bombástico","2026-05-10"],["Negociação","Sexta da Carne","2026-05-29"],["Reunião de compras","Terçou das Frutas e Verduras","2026-06-09"]],"2026-04-28":[["Montagem","Hora da Economia","2026-04-30"],["Recebimento","Terçou das Frutas e Verduras","2026-05-12"],["Pedido","Terçou das Frutas e Verduras","2026-05-26"],["Aprovação","Hora da Economia","2026-05-28"],["Análise de produto","Dia dos Namorados","2026-06-12"],["Análise de produto","Sexta da Carne","2026-06-12"]],"2026-04-29":[["Divulgação do encarte","Hora da Economia","2026-04-30"],["Encarte","Sexta da Carne","2026-05-08"],["Aprovação","Sexta da Carne","2026-05-29"],["Negociação","Terçou das Frutas e Verduras","2026-06-02"],["Análise de produto","Sábado Bombástico (Prorrogado)","2026-06-14"],["Análise de produto","Sábado Bombástico","2026-06-13"]],"2026-04-30":[["Montagem","Terçou das Frutas e Verduras","2026-05-05"],["Encarte","Dia das Mães","2026-05-10"],["Encarte","Sábado Bombástico","2026-05-09"],["Encarte","Sábado Bombástico","2026-05-10"],["Pedido","Hora da Economia","2026-05-28"],["Reunião de compras","Dia dos Namorados","2026-06-12"],["Reunião de compras","Sexta da Carne","2026-06-12"],["Análise de produto","Terçou das Frutas e Verduras","2026-06-16"]],"2026-05-02":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-05-05"]],"2026-05-04":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-05-05"],["Encarte","Terçou das Frutas e Verduras","2026-05-12"],["Recebimento","Sexta da Carne","2026-05-15"],["Pedido","Sexta da Carne","2026-05-29"],["Aprovação","Terçou das Frutas e Verduras","2026-06-02"],["Reunião de compras","Sábado Bombástico (Prorrogado)","2026-06-14"],["Reunião de compras","Sábado Bombástico","2026-06-13"]],"2026-05-05":[["Divulgação da campanha","Sexta da Carne","2026-05-08"],["Negociação","Sexta da Carne","2026-06-05"],["Reunião de compras","Terçou das Frutas e Verduras","2026-06-16"]],"2026-05-06":[["Montagem","Sexta da Carne","2026-05-08"],["Divulgação da campanha","Sábado Bombástico","2026-05-09"],["Recebimento","Terçou das Frutas e Verduras","2026-05-19"],["Pedido","Terçou das Frutas e Verduras","2026-06-02"],["Análise de produto","Sexta da Carne","2026-06-19"]],"2026-05-07":[["Divulgação do encarte","Sexta da Carne","2026-05-08"],["Divulgação da campanha","Dia das Mães","2026-05-10"],["Montagem","Dia das Mães","2026-05-10"],["Montagem","Sábado Bombástico","2026-05-09"],["Divulgação da campanha","Sábado Bombástico","2026-05-10"],["Montagem","Sábado Bombástico","2026-05-10"],["Encarte","Sexta da Carne","2026-05-15"],["Aprovação","Sexta da Carne","2026-06-05"],["Negociação","Terçou das Frutas e Verduras","2026-06-09"]],"2026-05-08":[["Divulgação do encarte","Sábado Bombástico","2026-05-09"],["Montagem","Terçou das Frutas e Verduras","2026-05-12"],["Reunião de compras","Sexta da Carne","2026-06-19"],["Análise de produto","Terçou das Frutas e Verduras","2026-06-23"]],"2026-05-09":[["Divulgação do encarte","Dia das Mães","2026-05-10"],["Divulgação do encarte","Sábado Bombástico","2026-05-10"],["Divulgação da campanha","Terçou das Frutas e Verduras","2026-05-12"]],"2026-05-11":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-05-12"],["Encarte","Terçou das Frutas e Verduras","2026-05-19"],["Recebimento","Sexta da Carne","2026-05-22"],["Pedido","Sexta da Carne","2026-06-05"],["Aprovação","Terçou das Frutas e Verduras","2026-06-09"],["Análise de produto","São João","2026-06-24"]],"2026-05-12":[["Divulgação da campanha","Sexta da Carne","2026-05-15"],["Negociação","Dia dos Namorados","2026-06-12"],["Negociação","Sexta da Carne","2026-06-12"],["Reunião de compras","Terçou das Frutas e Verduras","2026-06-23"],["Análise de produto","Hora da Economia","2026-06-25"]],"2026-05-13":[["Montagem","Sexta da Carne","2026-05-15"],["Recebimento","Terçou das Frutas e Verduras","2026-05-26"],["Pedido","Terçou das Frutas e Verduras","2026-06-09"],["Negociação","Sábado Bombástico (Prorrogado)","2026-06-14"],["Negociação","Sábado Bombástico","2026-06-13"],["Reunião de compras","São João","2026-06-24"],["Análise de produto","Sexta da Carne","2026-06-26"]],"2026-05-14":[["Divulgação do encarte","Sexta da Carne","2026-05-15"],["Encarte","Sexta da Carne","2026-05-22"],["Aprovação","Dia dos Namorados","2026-06-12"],["Aprovação","Sexta da Carne","2026-06-12"],["Negociação","Terçou das Frutas e Verduras","2026-06-16"],["Reunião de compras","Hora da Economia","2026-06-25"],["Análise de produto","São Pedro","2026-06-29"]],"2026-05-15":[["Montagem","Terçou das Frutas e Verduras","2026-05-19"],["Recebimento","Hora da Economia","2026-05-28"],["Aprovação","Sábado Bombástico (Prorrogado)","2026-06-14"],["Aprovação","Sábado Bombástico","2026-06-13"],["Reunião de compras","Sexta da Carne","2026-06-26"],["Análise de produto","Terçou das Frutas e Verduras","2026-06-30"]],"2026-05-16":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-05-19"]],"2026-05-18":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-05-19"],["Encarte","Terçou das Frutas e Verduras","2026-05-26"],["Recebimento","Sexta da Carne","2026-05-29"],["Pedido","Dia dos Namorados","2026-06-12"],["Pedido","Sexta da Carne","2026-06-12"],["Aprovação","Terçou das Frutas e Verduras","2026-06-16"],["Reunião de compras","São Pedro","2026-06-29"]],"2026-05-19":[["Divulgação da campanha","Sexta da Carne","2026-05-22"],["Pedido","Sábado Bombástico (Prorrogado)","2026-06-14"],["Pedido","Sábado Bombástico","2026-06-13"],["Negociação","Sexta da Carne","2026-06-19"],["Reunião de compras","Terçou das Frutas e Verduras","2026-06-30"]],"2026-05-20":[["Montagem","Sexta da Carne","2026-05-22"],["Encarte","Hora da Economia","2026-05-28"],["Recebimento","Terçou das Frutas e Verduras","2026-06-02"],["Pedido","Terçou das Frutas e Verduras","2026-06-16"],["Análise de produto","Sexta da Carne","2026-07-03"]],"2026-05-21":[["Divulgação do encarte","Sexta da Carne","2026-05-22"],["Encarte","Sexta da Carne","2026-05-29"],["Aprovação","Sexta da Carne","2026-06-19"],["Negociação","Terçou das Frutas e Verduras","2026-06-23"]],"2026-05-22":[["Montagem","Terçou das Frutas e Verduras","2026-05-26"],["Negociação","São João","2026-06-24"],["Reunião de compras","Sexta da Carne","2026-07-03"],["Análise de produto","Terçou das Frutas e Verduras","2026-07-07"]],"2026-05-23":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-05-26"]],"2026-05-25":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-05-26"],["Divulgação da campanha","Hora da Economia","2026-05-28"],["Encarte","Terçou das Frutas e Verduras","2026-06-02"],["Recebimento","Sexta da Carne","2026-06-05"],["Pedido","Sexta da Carne","2026-06-19"],["Aprovação","Terçou das Frutas e Verduras","2026-06-23"],["Negociação","Hora da Economia","2026-06-25"]],"2026-05-26":[["Montagem","Hora da Economia","2026-05-28"],["Divulgação da campanha","Sexta da Carne","2026-05-29"],["Aprovação","São João","2026-06-24"],["Negociação","Sexta da Carne","2026-06-26"],["Reunião de compras","Terçou das Frutas e Verduras","2026-07-07"]],"2026-05-27":[["Divulgação do encarte","Hora da Economia","2026-05-28"],["Montagem","Sexta da Carne","2026-05-29"],["Recebimento","Terçou das Frutas e Verduras","2026-06-09"],["Pedido","Terçou das Frutas e Verduras","2026-06-23"],["Aprovação","Hora da Economia","2026-06-25"],["Negociação","São Pedro","2026-06-29"],["Análise de produto","Sexta da Carne","2026-07-10"]],"2026-05-28":[["Divulgação do encarte","Sexta da Carne","2026-05-29"],["Encarte","Sexta da Carne","2026-06-05"],["Pedido","São João","2026-06-24"],["Aprovação","Sexta da Carne","2026-06-26"],["Negociação","Terçou das Frutas e Verduras","2026-06-30"],["Análise de produto","Sábado Bombástico (Prorrogado)","2026-07-12"],["Análise de produto","Sábado Bombástico","2026-07-11"]],"2026-05-29":[["Montagem","Terçou das Frutas e Verduras","2026-06-02"],["Pedido","Hora da Economia","2026-06-25"],["Aprovação","São Pedro","2026-06-29"],["Reunião de compras","Sexta da Carne","2026-07-10"],["Análise de produto","Terçou das Frutas e Verduras","2026-07-14"]],"2026-05-30":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-06-02"]],"2026-06-01":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-06-02"],["Encarte","Terçou das Frutas e Verduras","2026-06-09"],["Recebimento","Dia dos Namorados","2026-06-12"],["Recebimento","Sexta da Carne","2026-06-12"],["Pedido","Sexta da Carne","2026-06-26"],["Aprovação","Terçou das Frutas e Verduras","2026-06-30"],["Reunião de compras","Sábado Bombástico (Prorrogado)","2026-07-12"],["Reunião de compras","Sábado Bombástico","2026-07-11"]],"2026-06-02":[["Divulgação da campanha","Sexta da Carne","2026-06-05"],["Recebimento","Sábado Bombástico (Prorrogado)","2026-06-14"],["Recebimento","Sábado Bombástico","2026-06-13"],["Pedido","São Pedro","2026-06-29"],["Negociação","Sexta da Carne","2026-07-03"],["Reunião de compras","Terçou das Frutas e Verduras","2026-07-14"]],"2026-06-03":[["Montagem","Sexta da Carne","2026-06-05"],["Recebimento","Terçou das Frutas e Verduras","2026-06-16"],["Pedido","Terçou das Frutas e Verduras","2026-06-30"],["Análise de produto","Sexta da Carne","2026-07-17"]],"2026-06-04":[["Divulgação do encarte","Sexta da Carne","2026-06-05"],["Encarte","Dia dos Namorados","2026-06-12"],["Encarte","Sexta da Carne","2026-06-12"],["Aprovação","Sexta da Carne","2026-07-03"],["Negociação","Terçou das Frutas e Verduras","2026-07-07"]],"2026-06-05":[["Montagem","Terçou das Frutas e Verduras","2026-06-09"],["Encarte","Sábado Bombástico (Prorrogado)","2026-06-14"],["Encarte","Sábado Bombástico","2026-06-13"],["Reunião de compras","Sexta da Carne","2026-07-17"],["Análise de produto","Terçou das Frutas e Verduras","2026-07-21"]],"2026-06-06":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-06-09"]],"2026-06-08":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-06-09"],["Encarte","Terçou das Frutas e Verduras","2026-06-16"],["Recebimento","Sexta da Carne","2026-06-19"],["Pedido","Sexta da Carne","2026-07-03"],["Aprovação","Terçou das Frutas e Verduras","2026-07-07"]],"2026-06-09":[["Divulgação da campanha","Dia dos Namorados","2026-06-12"],["Divulgação da campanha","Sexta da Carne","2026-06-12"],["Negociação","Sexta da Carne","2026-07-10"],["Reunião de compras","Terçou das Frutas e Verduras","2026-07-21"]],"2026-06-10":[["Montagem","Dia dos Namorados","2026-06-12"],["Montagem","Sexta da Carne","2026-06-12"],["Divulgação da campanha","Sábado Bombástico","2026-06-13"],["Recebimento","Terçou das Frutas e Verduras","2026-06-23"],["Pedido","Terçou das Frutas e Verduras","2026-07-07"],["Negociação","Sábado Bombástico (Prorrogado)","2026-07-12"],["Negociação","Sábado Bombástico","2026-07-11"],["Análise de produto","Sexta da Carne","2026-07-24"]],"2026-06-11":[["Divulgação do encarte","Dia dos Namorados","2026-06-12"],["Divulgação do encarte","Sexta da Carne","2026-06-12"],["Divulgação da campanha","Sábado Bombástico (Prorrogado)","2026-06-14"],["Montagem","Sábado Bombástico (Prorrogado)","2026-06-14"],["Montagem","Sábado Bombástico","2026-06-13"],["Encarte","Sexta da Carne","2026-06-19"],["Recebimento","São João","2026-06-24"],["Aprovação","Sexta da Carne","2026-07-10"],["Negociação","Terçou das Frutas e Verduras","2026-07-14"]],"2026-06-12":[["Divulgação do encarte","Sábado Bombástico","2026-06-13"],["Montagem","Terçou das Frutas e Verduras","2026-06-16"],["Recebimento","Hora da Economia","2026-06-25"],["Aprovação","Sábado Bombástico (Prorrogado)","2026-07-12"],["Aprovação","Sábado Bombástico","2026-07-11"],["Reunião de compras","Sexta da Carne","2026-07-24"],["Análise de produto","Terçou das Frutas e Verduras","2026-07-28"]],"2026-06-13":[["Divulgação do encarte","Sábado Bombástico (Prorrogado)","2026-06-14"],["Divulgação da campanha","Terçou das Frutas e Verduras","2026-06-16"]],"2026-06-15":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-06-16"],["Encarte","Terçou das Frutas e Verduras","2026-06-23"],["Recebimento","Sexta da Carne","2026-06-26"],["Pedido","Sexta da Carne","2026-07-10"],["Aprovação","Terçou das Frutas e Verduras","2026-07-14"]],"2026-06-16":[["Divulgação da campanha","Sexta da Carne","2026-06-19"],["Encarte","São João","2026-06-24"],["Recebimento","São Pedro","2026-06-29"],["Pedido","Sábado Bombástico (Prorrogado)","2026-07-12"],["Pedido","Sábado Bombástico","2026-07-11"],["Negociação","Sexta da Carne","2026-07-17"],["Reunião de compras","Terçou das Frutas e Verduras","2026-07-28"],["Análise de produto","Hora da Economia","2026-07-30"]],"2026-06-17":[["Montagem","Sexta da Carne","2026-06-19"],["Encarte","Hora da Economia","2026-06-25"],["Recebimento","Terçou das Frutas e Verduras","2026-06-30"],["Pedido","Terçou das Frutas e Verduras","2026-07-14"],["Análise de produto","Sexta da Carne","2026-07-31"]],"2026-06-18":[["Divulgação do encarte","Sexta da Carne","2026-06-19"],["Encarte","Sexta da Carne","2026-06-26"],["Aprovação","Sexta da Carne","2026-07-17"],["Negociação","Terçou das Frutas e Verduras","2026-07-21"],["Reunião de compras","Hora da Economia","2026-07-30"]],"2026-06-19":[["Montagem","Terçou das Frutas e Verduras","2026-06-23"],["Encarte","São Pedro","2026-06-29"],["Reunião de compras","Sexta da Carne","2026-07-31"],["Análise de produto","Terçou das Frutas e Verduras","2026-08-04"]],"2026-06-20":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-06-23"]],"2026-06-21":[["Divulgação da campanha","São João","2026-06-24"]],"2026-06-22":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-06-23"],["Montagem","São João","2026-06-24"],["Divulgação da campanha","Hora da Economia","2026-06-25"],["Encarte","Terçou das Frutas e Verduras","2026-06-30"],["Recebimento","Sexta da Carne","2026-07-03"],["Pedido","Sexta da Carne","2026-07-17"],["Aprovação","Terçou das Frutas e Verduras","2026-07-21"]],"2026-06-23":[["Divulgação do encarte","São João","2026-06-24"],["Montagem","Hora da Economia","2026-06-25"],["Divulgação da campanha","Sexta da Carne","2026-06-26"],["Negociação","Sexta da Carne","2026-07-24"],["Reunião de compras","Terçou das Frutas e Verduras","2026-08-04"]],"2026-06-24":[["Divulgação do encarte","Hora da Economia","2026-06-25"],["Montagem","Sexta da Carne","2026-06-26"],["Recebimento","Terçou das Frutas e Verduras","2026-07-07"],["Pedido","Terçou das Frutas e Verduras","2026-07-21"],["Análise de produto","Sexta da Carne","2026-08-07"]],"2026-06-25":[["Divulgação do encarte","Sexta da Carne","2026-06-26"],["Montagem","São Pedro","2026-06-29"],["Encarte","Sexta da Carne","2026-07-03"],["Aprovação","Sexta da Carne","2026-07-24"],["Negociação","Terçou das Frutas e Verduras","2026-07-28"],["Análise de produto","Dia dos Pais","2026-08-09"],["Análise de produto","Sábado Bombástico","2026-08-08"],["Análise de produto","Sábado Bombástico","2026-08-09"]],"2026-06-26":[["Divulgação da campanha","São Pedro","2026-06-29"],["Montagem","Terçou das Frutas e Verduras","2026-06-30"],["Reunião de compras","Sexta da Carne","2026-08-07"],["Análise de produto","Terçou das Frutas e Verduras","2026-08-11"]],"2026-06-27":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-06-30"]],"2026-06-28":[["Divulgação do encarte","São Pedro","2026-06-29"]],"2026-06-29":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-06-30"],["Encarte","Terçou das Frutas e Verduras","2026-07-07"],["Recebimento","Sexta da Carne","2026-07-10"],["Pedido","Sexta da Carne","2026-07-24"],["Aprovação","Terçou das Frutas e Verduras","2026-07-28"],["Negociação","Hora da Economia","2026-07-30"],["Reunião de compras","Dia dos Pais","2026-08-09"],["Reunião de compras","Sábado Bombástico","2026-08-08"],["Reunião de compras","Sábado Bombástico","2026-08-09"]],"2026-06-30":[["Divulgação da campanha","Sexta da Carne","2026-07-03"],["Recebimento","Sábado Bombástico (Prorrogado)","2026-07-12"],["Recebimento","Sábado Bombástico","2026-07-11"],["Negociação","Sexta da Carne","2026-07-31"],["Reunião de compras","Terçou das Frutas e Verduras","2026-08-11"]],"2026-07-01":[["Montagem","Sexta da Carne","2026-07-03"],["Recebimento","Terçou das Frutas e Verduras","2026-07-14"],["Pedido","Terçou das Frutas e Verduras","2026-07-28"],["Aprovação","Hora da Economia","2026-07-30"],["Análise de produto","Sexta da Carne","2026-08-14"]],"2026-07-02":[["Divulgação do encarte","Sexta da Carne","2026-07-03"],["Encarte","Sexta da Carne","2026-07-10"],["Aprovação","Sexta da Carne","2026-07-31"],["Negociação","Terçou das Frutas e Verduras","2026-08-04"]],"2026-07-03":[["Montagem","Terçou das Frutas e Verduras","2026-07-07"],["Encarte","Sábado Bombástico (Prorrogado)","2026-07-12"],["Encarte","Sábado Bombástico","2026-07-11"],["Pedido","Hora da Economia","2026-07-30"],["Reunião de compras","Sexta da Carne","2026-08-14"],["Análise de produto","Terçou das Frutas e Verduras","2026-08-18"]],"2026-07-04":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-07-07"]],"2026-07-06":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-07-07"],["Encarte","Terçou das Frutas e Verduras","2026-07-14"],["Recebimento","Sexta da Carne","2026-07-17"],["Pedido","Sexta da Carne","2026-07-31"],["Aprovação","Terçou das Frutas e Verduras","2026-08-04"]],"2026-07-07":[["Divulgação da campanha","Sexta da Carne","2026-07-10"],["Negociação","Sexta da Carne","2026-08-07"],["Reunião de compras","Terçou das Frutas e Verduras","2026-08-18"]],"2026-07-08":[["Montagem","Sexta da Carne","2026-07-10"],["Divulgação da campanha","Sábado Bombástico","2026-07-11"],["Recebimento","Terçou das Frutas e Verduras","2026-07-21"],["Pedido","Terçou das Frutas e Verduras","2026-08-04"],["Negociação","Dia dos Pais","2026-08-09"],["Negociação","Sábado Bombástico","2026-08-08"],["Negociação","Sábado Bombástico","2026-08-09"],["Análise de produto","Sexta da Carne","2026-08-21"]],"2026-07-09":[["Divulgação do encarte","Sexta da Carne","2026-07-10"],["Divulgação da campanha","Sábado Bombástico (Prorrogado)","2026-07-12"],["Montagem","Sábado Bombástico (Prorrogado)","2026-07-12"],["Montagem","Sábado Bombástico","2026-07-11"],["Encarte","Sexta da Carne","2026-07-17"],["Aprovação","Sexta da Carne","2026-08-07"],["Negociação","Terçou das Frutas e Verduras","2026-08-11"]],"2026-07-10":[["Divulgação do encarte","Sábado Bombástico","2026-07-11"],["Montagem","Terçou das Frutas e Verduras","2026-07-14"],["Aprovação","Dia dos Pais","2026-08-09"],["Aprovação","Sábado Bombástico","2026-08-08"],["Aprovação","Sábado Bombástico","2026-08-09"],["Reunião de compras","Sexta da Carne","2026-08-21"],["Análise de produto","Terçou das Frutas e Verduras","2026-08-25"]],"2026-07-11":[["Divulgação do encarte","Sábado Bombástico (Prorrogado)","2026-07-12"],["Divulgação da campanha","Terçou das Frutas e Verduras","2026-07-14"]],"2026-07-13":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-07-14"],["Encarte","Terçou das Frutas e Verduras","2026-07-21"],["Recebimento","Sexta da Carne","2026-07-24"],["Pedido","Sexta da Carne","2026-08-07"],["Aprovação","Terçou das Frutas e Verduras","2026-08-11"]],"2026-07-14":[["Divulgação da campanha","Sexta da Carne","2026-07-17"],["Pedido","Dia dos Pais","2026-08-09"],["Pedido","Sábado Bombástico","2026-08-08"],["Pedido","Sábado Bombástico","2026-08-09"],["Negociação","Sexta da Carne","2026-08-14"],["Reunião de compras","Terçou das Frutas e Verduras","2026-08-25"],["Análise de produto","Hora da Economia","2026-08-27"]],"2026-07-15":[["Montagem","Sexta da Carne","2026-07-17"],["Recebimento","Terçou das Frutas e Verduras","2026-07-28"],["Pedido","Terçou das Frutas e Verduras","2026-08-11"],["Análise de produto","Sexta da Carne","2026-08-28"]],"2026-07-16":[["Divulgação do encarte","Sexta da Carne","2026-07-17"],["Encarte","Sexta da Carne","2026-07-24"],["Aprovação","Sexta da Carne","2026-08-14"],["Negociação","Terçou das Frutas e Verduras","2026-08-18"],["Reunião de compras","Hora da Economia","2026-08-27"]],"2026-07-17":[["Montagem","Terçou das Frutas e Verduras","2026-07-21"],["Recebimento","Hora da Economia","2026-07-30"],["Reunião de compras","Sexta da Carne","2026-08-28"],["Análise de produto","Terçou das Frutas e Verduras","2026-09-01"]],"2026-07-18":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-07-21"]],"2026-07-20":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-07-21"],["Encarte","Terçou das Frutas e Verduras","2026-07-28"],["Recebimento","Sexta da Carne","2026-07-31"],["Pedido","Sexta da Carne","2026-08-14"],["Aprovação","Terçou das Frutas e Verduras","2026-08-18"]],"2026-07-21":[["Divulgação da campanha","Sexta da Carne","2026-07-24"],["Negociação","Sexta da Carne","2026-08-21"],["Reunião de compras","Terçou das Frutas e Verduras","2026-09-01"]],"2026-07-22":[["Montagem","Sexta da Carne","2026-07-24"],["Encarte","Hora da Economia","2026-07-30"],["Recebimento","Terçou das Frutas e Verduras","2026-08-04"],["Pedido","Terçou das Frutas e Verduras","2026-08-18"],["Análise de produto","Sexta da Carne","2026-09-04"]],"2026-07-23":[["Divulgação do encarte","Sexta da Carne","2026-07-24"],["Encarte","Sexta da Carne","2026-07-31"],["Aprovação","Sexta da Carne","2026-08-21"],["Negociação","Terçou das Frutas e Verduras","2026-08-25"]],"2026-07-24":[["Montagem","Terçou das Frutas e Verduras","2026-07-28"],["Reunião de compras","Sexta da Carne","2026-09-04"],["Análise de produto","Terçou das Frutas e Verduras","2026-09-08"]],"2026-07-25":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-07-28"]],"2026-07-27":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-07-28"],["Divulgação da campanha","Hora da Economia","2026-07-30"],["Encarte","Terçou das Frutas e Verduras","2026-08-04"],["Recebimento","Sexta da Carne","2026-08-07"],["Pedido","Sexta da Carne","2026-08-21"],["Aprovação","Terçou das Frutas e Verduras","2026-08-25"],["Negociação","Hora da Economia","2026-08-27"]],"2026-07-28":[["Montagem","Hora da Economia","2026-07-30"],["Divulgação da campanha","Sexta da Carne","2026-07-31"],["Recebimento","Dia dos Pais","2026-08-09"],["Recebimento","Sábado Bombástico","2026-08-08"],["Recebimento","Sábado Bombástico","2026-08-09"],["Negociação","Sexta da Carne","2026-08-28"],["Reunião de compras","Terçou das Frutas e Verduras","2026-09-08"]],"2026-07-29":[["Divulgação do encarte","Hora da Economia","2026-07-30"],["Montagem","Sexta da Carne","2026-07-31"],["Recebimento","Terçou das Frutas e Verduras","2026-08-11"],["Pedido","Terçou das Frutas e Verduras","2026-08-25"],["Aprovação","Hora da Economia","2026-08-27"],["Análise de produto","Sexta da Carne","2026-09-11"]],"2026-07-30":[["Divulgação do encarte","Sexta da Carne","2026-07-31"],["Encarte","Sexta da Carne","2026-08-07"],["Aprovação","Sexta da Carne","2026-08-28"],["Negociação","Terçou das Frutas e Verduras","2026-09-01"],["Análise de produto","Sábado Bombástico (Prorrogado)","2026-09-13"],["Análise de produto","Sábado Bombástico","2026-09-12"]],"2026-07-31":[["Montagem","Terçou das Frutas e Verduras","2026-08-04"],["Encarte","Dia dos Pais","2026-08-09"],["Encarte","Sábado Bombástico","2026-08-08"],["Encarte","Sábado Bombástico","2026-08-09"],["Pedido","Hora da Economia","2026-08-27"],["Reunião de compras","Sexta da Carne","2026-09-11"],["Análise de produto","Terçou das Frutas e Verduras","2026-09-15"]],"2026-08-01":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-08-04"]],"2026-08-03":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-08-04"],["Encarte","Terçou das Frutas e Verduras","2026-08-11"],["Recebimento","Sexta da Carne","2026-08-14"],["Pedido","Sexta da Carne","2026-08-28"],["Aprovação","Terçou das Frutas e Verduras","2026-09-01"],["Reunião de compras","Sábado Bombástico (Prorrogado)","2026-09-13"],["Reunião de compras","Sábado Bombástico","2026-09-12"]],"2026-08-04":[["Divulgação da campanha","Sexta da Carne","2026-08-07"],["Negociação","Sexta da Carne","2026-09-04"],["Reunião de compras","Terçou das Frutas e Verduras","2026-09-15"]],"2026-08-05":[["Montagem","Sexta da Carne","2026-08-07"],["Divulgação da campanha","Sábado Bombástico","2026-08-08"],["Recebimento","Terçou das Frutas e Verduras","2026-08-18"],["Pedido","Terçou das Frutas e Verduras","2026-09-01"],["Análise de produto","Sexta da Carne","2026-09-18"]],"2026-08-06":[["Divulgação do encarte","Sexta da Carne","2026-08-07"],["Divulgação da campanha","Dia dos Pais","2026-08-09"],["Montagem","Dia dos Pais","2026-08-09"],["Montagem","Sábado Bombástico","2026-08-08"],["Divulgação da campanha","Sábado Bombástico","2026-08-09"],["Montagem","Sábado Bombástico","2026-08-09"],["Encarte","Sexta da Carne","2026-08-14"],["Aprovação","Sexta da Carne","2026-09-04"],["Negociação","Terçou das Frutas e Verduras","2026-09-08"]],"2026-08-07":[["Divulgação do encarte","Sábado Bombástico","2026-08-08"],["Montagem","Terçou das Frutas e Verduras","2026-08-11"],["Reunião de compras","Sexta da Carne","2026-09-18"],["Análise de produto","Terçou das Frutas e Verduras","2026-09-22"]],"2026-08-08":[["Divulgação do encarte","Dia dos Pais","2026-08-09"],["Divulgação do encarte","Sábado Bombástico","2026-08-09"],["Divulgação da campanha","Terçou das Frutas e Verduras","2026-08-11"]],"2026-08-10":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-08-11"],["Encarte","Terçou das Frutas e Verduras","2026-08-18"],["Recebimento","Sexta da Carne","2026-08-21"],["Pedido","Sexta da Carne","2026-09-04"],["Aprovação","Terçou das Frutas e Verduras","2026-09-08"]],"2026-08-11":[["Divulgação da campanha","Sexta da Carne","2026-08-14"],["Negociação","Sexta da Carne","2026-09-11"],["Reunião de compras","Terçou das Frutas e Verduras","2026-09-22"],["Análise de produto","Hora da Economia","2026-09-24"]],"2026-08-12":[["Montagem","Sexta da Carne","2026-08-14"],["Recebimento","Terçou das Frutas e Verduras","2026-08-25"],["Pedido","Terçou das Frutas e Verduras","2026-09-08"],["Negociação","Sábado Bombástico (Prorrogado)","2026-09-13"],["Negociação","Sábado Bombástico","2026-09-12"],["Análise de produto","Sexta da Carne","2026-09-25"]],"2026-08-13":[["Divulgação do encarte","Sexta da Carne","2026-08-14"],["Encarte","Sexta da Carne","2026-08-21"],["Aprovação","Sexta da Carne","2026-09-11"],["Negociação","Terçou das Frutas e Verduras","2026-09-15"],["Reunião de compras","Hora da Economia","2026-09-24"]],"2026-08-14":[["Montagem","Terçou das Frutas e Verduras","2026-08-18"],["Recebimento","Hora da Economia","2026-08-27"],["Aprovação","Sábado Bombástico (Prorrogado)","2026-09-13"],["Aprovação","Sábado Bombástico","2026-09-12"],["Reunião de compras","Sexta da Carne","2026-09-25"],["Análise de produto","Terçou das Frutas e Verduras","2026-09-29"]],"2026-08-15":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-08-18"]],"2026-08-17":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-08-18"],["Encarte","Terçou das Frutas e Verduras","2026-08-25"],["Recebimento","Sexta da Carne","2026-08-28"],["Pedido","Sexta da Carne","2026-09-11"],["Aprovação","Terçou das Frutas e Verduras","2026-09-15"]],"2026-08-18":[["Divulgação da campanha","Sexta da Carne","2026-08-21"],["Pedido","Sábado Bombástico (Prorrogado)","2026-09-13"],["Pedido","Sábado Bombástico","2026-09-12"],["Negociação","Sexta da Carne","2026-09-18"],["Reunião de compras","Terçou das Frutas e Verduras","2026-09-29"]],"2026-08-19":[["Montagem","Sexta da Carne","2026-08-21"],["Encarte","Hora da Economia","2026-08-27"],["Recebimento","Terçou das Frutas e Verduras","2026-09-01"],["Pedido","Terçou das Frutas e Verduras","2026-09-15"],["Análise de produto","Sexta da Carne","2026-10-02"]],"2026-08-20":[["Divulgação do encarte","Sexta da Carne","2026-08-21"],["Encarte","Sexta da Carne","2026-08-28"],["Aprovação","Sexta da Carne","2026-09-18"],["Negociação","Terçou das Frutas e Verduras","2026-09-22"]],"2026-08-21":[["Montagem","Terçou das Frutas e Verduras","2026-08-25"],["Reunião de compras","Sexta da Carne","2026-10-02"],["Análise de produto","Terçou das Frutas e Verduras","2026-10-06"]],"2026-08-22":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-08-25"]],"2026-08-24":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-08-25"],["Divulgação da campanha","Hora da Economia","2026-08-27"],["Encarte","Terçou das Frutas e Verduras","2026-09-01"],["Recebimento","Sexta da Carne","2026-09-04"],["Pedido","Sexta da Carne","2026-09-18"],["Aprovação","Terçou das Frutas e Verduras","2026-09-22"],["Negociação","Hora da Economia","2026-09-24"]],"2026-08-25":[["Montagem","Hora da Economia","2026-08-27"],["Divulgação da campanha","Sexta da Carne","2026-08-28"],["Negociação","Sexta da Carne","2026-09-25"],["Reunião de compras","Terçou das Frutas e Verduras","2026-10-06"]],"2026-08-26":[["Divulgação do encarte","Hora da Economia","2026-08-27"],["Montagem","Sexta da Carne","2026-08-28"],["Recebimento","Terçou das Frutas e Verduras","2026-09-08"],["Pedido","Terçou das Frutas e Verduras","2026-09-22"],["Aprovação","Hora da Economia","2026-09-24"],["Análise de produto","Sexta da Carne","2026-10-09"]],"2026-08-27":[["Divulgação do encarte","Sexta da Carne","2026-08-28"],["Encarte","Sexta da Carne","2026-09-04"],["Aprovação","Sexta da Carne","2026-09-25"],["Negociação","Terçou das Frutas e Verduras","2026-09-29"],["Análise de produto","Dia das Crianças","2026-10-12"],["Análise de produto","Sábado Bombástico (Prorrogado)","2026-10-11"],["Análise de produto","Sábado Bombástico","2026-10-10"]],"2026-08-28":[["Montagem","Terçou das Frutas e Verduras","2026-09-01"],["Pedido","Hora da Economia","2026-09-24"],["Reunião de compras","Sexta da Carne","2026-10-09"],["Análise de produto","Terçou das Frutas e Verduras","2026-10-13"]],"2026-08-29":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-09-01"]],"2026-08-31":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-09-01"],["Encarte","Terçou das Frutas e Verduras","2026-09-08"],["Recebimento","Sexta da Carne","2026-09-11"],["Pedido","Sexta da Carne","2026-09-25"],["Aprovação","Terçou das Frutas e Verduras","2026-09-29"],["Reunião de compras","Dia das Crianças","2026-10-12"],["Reunião de compras","Sábado Bombástico (Prorrogado)","2026-10-11"],["Reunião de compras","Sábado Bombástico","2026-10-10"]],"2026-09-01":[["Divulgação da campanha","Sexta da Carne","2026-09-04"],["Recebimento","Sábado Bombástico (Prorrogado)","2026-09-13"],["Recebimento","Sábado Bombástico","2026-09-12"],["Negociação","Sexta da Carne","2026-10-02"],["Reunião de compras","Terçou das Frutas e Verduras","2026-10-13"]],"2026-09-02":[["Montagem","Sexta da Carne","2026-09-04"],["Recebimento","Terçou das Frutas e Verduras","2026-09-15"],["Pedido","Terçou das Frutas e Verduras","2026-09-29"],["Análise de produto","Sexta da Carne","2026-10-16"]],"2026-09-03":[["Divulgação do encarte","Sexta da Carne","2026-09-04"],["Encarte","Sexta da Carne","2026-09-11"],["Aprovação","Sexta da Carne","2026-10-02"],["Negociação","Terçou das Frutas e Verduras","2026-10-06"]],"2026-09-04":[["Montagem","Terçou das Frutas e Verduras","2026-09-08"],["Encarte","Sábado Bombástico (Prorrogado)","2026-09-13"],["Encarte","Sábado Bombástico","2026-09-12"],["Reunião de compras","Sexta da Carne","2026-10-16"],["Análise de produto","Terçou das Frutas e Verduras","2026-10-20"]],"2026-09-05":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-09-08"]],"2026-09-07":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-09-08"],["Encarte","Terçou das Frutas e Verduras","2026-09-15"],["Recebimento","Sexta da Carne","2026-09-18"],["Pedido","Sexta da Carne","2026-10-02"],["Aprovação","Terçou das Frutas e Verduras","2026-10-06"]],"2026-09-08":[["Divulgação da campanha","Sexta da Carne","2026-09-11"],["Negociação","Sexta da Carne","2026-10-09"],["Reunião de compras","Terçou das Frutas e Verduras","2026-10-20"]],"2026-09-09":[["Montagem","Sexta da Carne","2026-09-11"],["Divulgação da campanha","Sábado Bombástico","2026-09-12"],["Recebimento","Terçou das Frutas e Verduras","2026-09-22"],["Pedido","Terçou das Frutas e Verduras","2026-10-06"],["Negociação","Dia das Crianças","2026-10-12"],["Negociação","Sábado Bombástico (Prorrogado)","2026-10-11"],["Negociação","Sábado Bombástico","2026-10-10"],["Análise de produto","Sexta da Carne","2026-10-23"]],"2026-09-10":[["Divulgação do encarte","Sexta da Carne","2026-09-11"],["Divulgação da campanha","Sábado Bombástico (Prorrogado)","2026-09-13"],["Montagem","Sábado Bombástico (Prorrogado)","2026-09-13"],["Montagem","Sábado Bombástico","2026-09-12"],["Encarte","Sexta da Carne","2026-09-18"],["Aprovação","Sexta da Carne","2026-10-09"],["Negociação","Terçou das Frutas e Verduras","2026-10-13"]],"2026-09-11":[["Divulgação do encarte","Sábado Bombástico","2026-09-12"],["Montagem","Terçou das Frutas e Verduras","2026-09-15"],["Recebimento","Hora da Economia","2026-09-24"],["Aprovação","Dia das Crianças","2026-10-12"],["Aprovação","Sábado Bombástico (Prorrogado)","2026-10-11"],["Aprovação","Sábado Bombástico","2026-10-10"],["Reunião de compras","Sexta da Carne","2026-10-23"],["Análise de produto","Terçou das Frutas e Verduras","2026-10-27"]],"2026-09-12":[["Divulgação do encarte","Sábado Bombástico (Prorrogado)","2026-09-13"],["Divulgação da campanha","Terçou das Frutas e Verduras","2026-09-15"]],"2026-09-14":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-09-15"],["Encarte","Terçou das Frutas e Verduras","2026-09-22"],["Recebimento","Sexta da Carne","2026-09-25"],["Pedido","Sexta da Carne","2026-10-09"],["Aprovação","Terçou das Frutas e Verduras","2026-10-13"]],"2026-09-15":[["Divulgação da campanha","Sexta da Carne","2026-09-18"],["Pedido","Dia das Crianças","2026-10-12"],["Pedido","Sábado Bombástico (Prorrogado)","2026-10-11"],["Pedido","Sábado Bombástico","2026-10-10"],["Negociação","Sexta da Carne","2026-10-16"],["Reunião de compras","Terçou das Frutas e Verduras","2026-10-27"],["Análise de produto","Hora da Economia","2026-10-29"]],"2026-09-16":[["Montagem","Sexta da Carne","2026-09-18"],["Encarte","Hora da Economia","2026-09-24"],["Recebimento","Terçou das Frutas e Verduras","2026-09-29"],["Pedido","Terçou das Frutas e Verduras","2026-10-13"],["Análise de produto","Sexta da Carne","2026-10-30"]],"2026-09-17":[["Divulgação do encarte","Sexta da Carne","2026-09-18"],["Encarte","Sexta da Carne","2026-09-25"],["Aprovação","Sexta da Carne","2026-10-16"],["Negociação","Terçou das Frutas e Verduras","2026-10-20"],["Reunião de compras","Hora da Economia","2026-10-29"],["Análise de produto","Halloween","2026-10-31"]],"2026-09-18":[["Montagem","Terçou das Frutas e Verduras","2026-09-22"],["Reunião de compras","Sexta da Carne","2026-10-30"],["Análise de produto","Terçou das Frutas e Verduras","2026-11-03"]],"2026-09-19":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-09-22"]],"2026-09-21":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-09-22"],["Divulgação da campanha","Hora da Economia","2026-09-24"],["Encarte","Terçou das Frutas e Verduras","2026-09-29"],["Recebimento","Sexta da Carne","2026-10-02"],["Pedido","Sexta da Carne","2026-10-16"],["Aprovação","Terçou das Frutas e Verduras","2026-10-20"],["Reunião de compras","Halloween","2026-10-31"]],"2026-09-22":[["Montagem","Hora da Economia","2026-09-24"],["Divulgação da campanha","Sexta da Carne","2026-09-25"],["Negociação","Sexta da Carne","2026-10-23"],["Reunião de compras","Terçou das Frutas e Verduras","2026-11-03"]],"2026-09-23":[["Divulgação do encarte","Hora da Economia","2026-09-24"],["Montagem","Sexta da Carne","2026-09-25"],["Recebimento","Terçou das Frutas e Verduras","2026-10-06"],["Pedido","Terçou das Frutas e Verduras","2026-10-20"],["Análise de produto","Sexta da Carne","2026-11-06"]],"2026-09-24":[["Divulgação do encarte","Sexta da Carne","2026-09-25"],["Encarte","Sexta da Carne","2026-10-02"],["Aprovação","Sexta da Carne","2026-10-23"],["Negociação","Terçou das Frutas e Verduras","2026-10-27"]],"2026-09-25":[["Montagem","Terçou das Frutas e Verduras","2026-09-29"],["Reunião de compras","Sexta da Carne","2026-11-06"],["Análise de produto","Terçou das Frutas e Verduras","2026-11-10"]],"2026-09-26":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-09-29"]],"2026-09-28":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-09-29"],["Encarte","Terçou das Frutas e Verduras","2026-10-06"],["Recebimento","Sexta da Carne","2026-10-09"],["Pedido","Sexta da Carne","2026-10-23"],["Aprovação","Terçou das Frutas e Verduras","2026-10-27"],["Negociação","Hora da Economia","2026-10-29"]],"2026-09-29":[["Divulgação da campanha","Sexta da Carne","2026-10-02"],["Recebimento","Dia das Crianças","2026-10-12"],["Recebimento","Sábado Bombástico (Prorrogado)","2026-10-11"],["Recebimento","Sábado Bombástico","2026-10-10"],["Negociação","Sexta da Carne","2026-10-30"],["Reunião de compras","Terçou das Frutas e Verduras","2026-11-10"]],"2026-09-30":[["Montagem","Sexta da Carne","2026-10-02"],["Recebimento","Terçou das Frutas e Verduras","2026-10-13"],["Pedido","Terçou das Frutas e Verduras","2026-10-27"],["Aprovação","Hora da Economia","2026-10-29"],["Negociação","Halloween","2026-10-31"],["Análise de produto","Sexta da Carne","2026-11-13"]],"2026-10-01":[["Divulgação do encarte","Sexta da Carne","2026-10-02"],["Encarte","Sexta da Carne","2026-10-09"],["Aprovação","Sexta da Carne","2026-10-30"],["Negociação","Terçou das Frutas e Verduras","2026-11-03"],["Análise de produto","Sábado Bombástico (Prorrogado)","2026-11-15"],["Análise de produto","Sábado Bombástico","2026-11-14"]],"2026-10-02":[["Montagem","Terçou das Frutas e Verduras","2026-10-06"],["Encarte","Dia das Crianças","2026-10-12"],["Encarte","Sábado Bombástico (Prorrogado)","2026-10-11"],["Encarte","Sábado Bombástico","2026-10-10"],["Pedido","Hora da Economia","2026-10-29"],["Aprovação","Halloween","2026-10-31"],["Reunião de compras","Sexta da Carne","2026-11-13"],["Análise de produto","Terçou das Frutas e Verduras","2026-11-17"]],"2026-10-03":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-10-06"]],"2026-10-05":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-10-06"],["Encarte","Terçou das Frutas e Verduras","2026-10-13"],["Recebimento","Sexta da Carne","2026-10-16"],["Pedido","Sexta da Carne","2026-10-30"],["Aprovação","Terçou das Frutas e Verduras","2026-11-03"],["Reunião de compras","Sábado Bombástico (Prorrogado)","2026-11-15"],["Reunião de compras","Sábado Bombástico","2026-11-14"]],"2026-10-06":[["Divulgação da campanha","Sexta da Carne","2026-10-09"],["Pedido","Halloween","2026-10-31"],["Negociação","Sexta da Carne","2026-11-06"],["Reunião de compras","Terçou das Frutas e Verduras","2026-11-17"]],"2026-10-07":[["Montagem","Sexta da Carne","2026-10-09"],["Divulgação da campanha","Sábado Bombástico","2026-10-10"],["Recebimento","Terçou das Frutas e Verduras","2026-10-20"],["Pedido","Terçou das Frutas e Verduras","2026-11-03"],["Análise de produto","Sexta da Carne","2026-11-20"]],"2026-10-08":[["Divulgação do encarte","Sexta da Carne","2026-10-09"],["Montagem","Dia das Crianças","2026-10-12"],["Divulgação da campanha","Sábado Bombástico (Prorrogado)","2026-10-11"],["Montagem","Sábado Bombástico (Prorrogado)","2026-10-11"],["Montagem","Sábado Bombástico","2026-10-10"],["Encarte","Sexta da Carne","2026-10-16"],["Aprovação","Sexta da Carne","2026-11-06"],["Negociação","Terçou das Frutas e Verduras","2026-11-10"]],"2026-10-09":[["Divulgação da campanha","Dia das Crianças","2026-10-12"],["Divulgação do encarte","Sábado Bombástico","2026-10-10"],["Montagem","Terçou das Frutas e Verduras","2026-10-13"],["Reunião de compras","Sexta da Carne","2026-11-20"],["Análise de produto","Terçou das Frutas e Verduras","2026-11-24"]],"2026-10-10":[["Divulgação do encarte","Sábado Bombástico (Prorrogado)","2026-10-11"],["Divulgação da campanha","Terçou das Frutas e Verduras","2026-10-13"]],"2026-10-11":[["Divulgação do encarte","Dia das Crianças","2026-10-12"]],"2026-10-12":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-10-13"],["Encarte","Terçou das Frutas e Verduras","2026-10-20"],["Recebimento","Sexta da Carne","2026-10-23"],["Pedido","Sexta da Carne","2026-11-06"],["Aprovação","Terçou das Frutas e Verduras","2026-11-10"]],"2026-10-13":[["Divulgação da campanha","Sexta da Carne","2026-10-16"],["Negociação","Sexta da Carne","2026-11-13"],["Reunião de compras","Terçou das Frutas e Verduras","2026-11-24"],["Análise de produto","Hora da Economia","2026-11-26"]],"2026-10-14":[["Montagem","Sexta da Carne","2026-10-16"],["Recebimento","Terçou das Frutas e Verduras","2026-10-27"],["Pedido","Terçou das Frutas e Verduras","2026-11-10"],["Negociação","Sábado Bombástico (Prorrogado)","2026-11-15"],["Negociação","Sábado Bombástico","2026-11-14"],["Análise de produto","Black Friday","2026-11-27"],["Análise de produto","Sexta da Carne","2026-11-27"]],"2026-10-15":[["Divulgação do encarte","Sexta da Carne","2026-10-16"],["Encarte","Sexta da Carne","2026-10-23"],["Aprovação","Sexta da Carne","2026-11-13"],["Negociação","Terçou das Frutas e Verduras","2026-11-17"],["Reunião de compras","Hora da Economia","2026-11-26"]],"2026-10-16":[["Montagem","Terçou das Frutas e Verduras","2026-10-20"],["Recebimento","Hora da Economia","2026-10-29"],["Aprovação","Sábado Bombástico (Prorrogado)","2026-11-15"],["Aprovação","Sábado Bombástico","2026-11-14"],["Reunião de compras","Black Friday","2026-11-27"],["Reunião de compras","Sexta da Carne","2026-11-27"],["Análise de produto","Terçou das Frutas e Verduras","2026-12-01"]],"2026-10-17":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-10-20"]],"2026-10-19":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-10-20"],["Encarte","Terçou das Frutas e Verduras","2026-10-27"],["Recebimento","Sexta da Carne","2026-10-30"],["Pedido","Sexta da Carne","2026-11-13"],["Aprovação","Terçou das Frutas e Verduras","2026-11-17"]],"2026-10-20":[["Divulgação da campanha","Sexta da Carne","2026-10-23"],["Recebimento","Halloween","2026-10-31"],["Pedido","Sábado Bombástico (Prorrogado)","2026-11-15"],["Pedido","Sábado Bombástico","2026-11-14"],["Negociação","Sexta da Carne","2026-11-20"],["Reunião de compras","Terçou das Frutas e Verduras","2026-12-01"]],"2026-10-21":[["Montagem","Sexta da Carne","2026-10-23"],["Encarte","Hora da Economia","2026-10-29"],["Recebimento","Terçou das Frutas e Verduras","2026-11-03"],["Pedido","Terçou das Frutas e Verduras","2026-11-17"],["Análise de produto","Sexta da Carne","2026-12-04"]],"2026-10-22":[["Divulgação do encarte","Sexta da Carne","2026-10-23"],["Encarte","Sexta da Carne","2026-10-30"],["Aprovação","Sexta da Carne","2026-11-20"],["Negociação","Terçou das Frutas e Verduras","2026-11-24"]],"2026-10-23":[["Montagem","Terçou das Frutas e Verduras","2026-10-27"],["Encarte","Halloween","2026-10-31"],["Reunião de compras","Sexta da Carne","2026-12-04"],["Análise de produto","Terçou das Frutas e Verduras","2026-12-08"]],"2026-10-24":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-10-27"]],"2026-10-26":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-10-27"],["Divulgação da campanha","Hora da Economia","2026-10-29"],["Encarte","Terçou das Frutas e Verduras","2026-11-03"],["Recebimento","Sexta da Carne","2026-11-06"],["Pedido","Sexta da Carne","2026-11-20"],["Aprovação","Terçou das Frutas e Verduras","2026-11-24"],["Negociação","Hora da Economia","2026-11-26"]],"2026-10-27":[["Montagem","Hora da Economia","2026-10-29"],["Divulgação da campanha","Sexta da Carne","2026-10-30"],["Negociação","Black Friday","2026-11-27"],["Negociação","Sexta da Carne","2026-11-27"],["Reunião de compras","Terçou das Frutas e Verduras","2026-12-08"]],"2026-10-28":[["Divulgação do encarte","Hora da Economia","2026-10-29"],["Montagem","Sexta da Carne","2026-10-30"],["Divulgação da campanha","Halloween","2026-10-31"],["Recebimento","Terçou das Frutas e Verduras","2026-11-10"],["Pedido","Terçou das Frutas e Verduras","2026-11-24"],["Aprovação","Hora da Economia","2026-11-26"],["Análise de produto","Sexta da Carne","2026-12-11"]],"2026-10-29":[["Divulgação do encarte","Sexta da Carne","2026-10-30"],["Montagem","Halloween","2026-10-31"],["Encarte","Sexta da Carne","2026-11-06"],["Aprovação","Black Friday","2026-11-27"],["Aprovação","Sexta da Carne","2026-11-27"],["Negociação","Terçou das Frutas e Verduras","2026-12-01"],["Análise de produto","Sábado Bombástico (Prorrogado)","2026-12-13"],["Análise de produto","Sábado Bombástico","2026-12-12"]],"2026-10-30":[["Divulgação do encarte","Halloween","2026-10-31"],["Montagem","Terçou das Frutas e Verduras","2026-11-03"],["Pedido","Hora da Economia","2026-11-26"],["Reunião de compras","Sexta da Carne","2026-12-11"],["Análise de produto","Terçou das Frutas e Verduras","2026-12-15"]],"2026-10-31":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-11-03"]],"2026-11-02":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-11-03"],["Encarte","Terçou das Frutas e Verduras","2026-11-10"],["Recebimento","Sexta da Carne","2026-11-13"],["Pedido","Black Friday","2026-11-27"],["Pedido","Sexta da Carne","2026-11-27"],["Aprovação","Terçou das Frutas e Verduras","2026-12-01"],["Reunião de compras","Sábado Bombástico (Prorrogado)","2026-12-13"],["Reunião de compras","Sábado Bombástico","2026-12-12"]],"2026-11-03":[["Divulgação da campanha","Sexta da Carne","2026-11-06"],["Recebimento","Sábado Bombástico (Prorrogado)","2026-11-15"],["Recebimento","Sábado Bombástico","2026-11-14"],["Negociação","Sexta da Carne","2026-12-04"],["Reunião de compras","Terçou das Frutas e Verduras","2026-12-15"]],"2026-11-04":[["Montagem","Sexta da Carne","2026-11-06"],["Recebimento","Terçou das Frutas e Verduras","2026-11-17"],["Pedido","Terçou das Frutas e Verduras","2026-12-01"],["Análise de produto","Sexta da Carne","2026-12-18"]],"2026-11-05":[["Divulgação do encarte","Sexta da Carne","2026-11-06"],["Encarte","Sexta da Carne","2026-11-13"],["Aprovação","Sexta da Carne","2026-12-04"],["Negociação","Terçou das Frutas e Verduras","2026-12-08"]],"2026-11-06":[["Montagem","Terçou das Frutas e Verduras","2026-11-10"],["Encarte","Sábado Bombástico (Prorrogado)","2026-11-15"],["Encarte","Sábado Bombástico","2026-11-14"],["Reunião de compras","Sexta da Carne","2026-12-18"],["Análise de produto","Terçou das Frutas e Verduras","2026-12-22"]],"2026-11-07":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-11-10"]],"2026-11-09":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-11-10"],["Encarte","Terçou das Frutas e Verduras","2026-11-17"],["Recebimento","Sexta da Carne","2026-11-20"],["Pedido","Sexta da Carne","2026-12-04"],["Aprovação","Terçou das Frutas e Verduras","2026-12-08"]],"2026-11-10":[["Divulgação da campanha","Sexta da Carne","2026-11-13"],["Negociação","Sexta da Carne","2026-12-11"],["Reunião de compras","Terçou das Frutas e Verduras","2026-12-22"],["Análise de produto","Véspera de Natal","2026-12-24"]],"2026-11-11":[["Montagem","Sexta da Carne","2026-11-13"],["Divulgação da campanha","Sábado Bombástico","2026-11-14"],["Recebimento","Terçou das Frutas e Verduras","2026-11-24"],["Pedido","Terçou das Frutas e Verduras","2026-12-08"],["Negociação","Sábado Bombástico (Prorrogado)","2026-12-13"],["Negociação","Sábado Bombástico","2026-12-12"]],"2026-11-12":[["Divulgação do encarte","Sexta da Carne","2026-11-13"],["Divulgação da campanha","Sábado Bombástico (Prorrogado)","2026-11-15"],["Montagem","Sábado Bombástico (Prorrogado)","2026-11-15"],["Montagem","Sábado Bombástico","2026-11-14"],["Encarte","Sexta da Carne","2026-11-20"],["Aprovação","Sexta da Carne","2026-12-11"],["Negociação","Terçou das Frutas e Verduras","2026-12-15"],["Reunião de compras","Véspera de Natal","2026-12-24"],["Análise de produto","Terçou das Frutas e Verduras","2026-12-29"]],"2026-11-13":[["Divulgação do encarte","Sábado Bombástico","2026-11-14"],["Montagem","Terçou das Frutas e Verduras","2026-11-17"],["Recebimento","Hora da Economia","2026-11-26"],["Aprovação","Sábado Bombástico (Prorrogado)","2026-12-13"],["Aprovação","Sábado Bombástico","2026-12-12"]],"2026-11-14":[["Divulgação do encarte","Sábado Bombástico (Prorrogado)","2026-11-15"],["Divulgação da campanha","Terçou das Frutas e Verduras","2026-11-17"]],"2026-11-16":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-11-17"],["Encarte","Terçou das Frutas e Verduras","2026-11-24"],["Recebimento","Black Friday","2026-11-27"],["Recebimento","Sexta da Carne","2026-11-27"],["Pedido","Sexta da Carne","2026-12-11"],["Aprovação","Terçou das Frutas e Verduras","2026-12-15"],["Reunião de compras","Terçou das Frutas e Verduras","2026-12-29"],["Análise de produto","Réveillon","2026-12-31"],["Análise de produto","Hora da Economia","2026-12-31"]],"2026-11-17":[["Divulgação da campanha","Sexta da Carne","2026-11-20"],["Pedido","Sábado Bombástico (Prorrogado)","2026-12-13"],["Pedido","Sábado Bombástico","2026-12-12"],["Negociação","Sexta da Carne","2026-12-18"]],"2026-11-18":[["Montagem","Sexta da Carne","2026-11-20"],["Encarte","Hora da Economia","2026-11-26"],["Recebimento","Terçou das Frutas e Verduras","2026-12-01"],["Pedido","Terçou das Frutas e Verduras","2026-12-15"],["Reunião de compras","Réveillon","2026-12-31"],["Reunião de compras","Hora da Economia","2026-12-31"]],"2026-11-19":[["Divulgação do encarte","Sexta da Carne","2026-11-20"],["Encarte","Black Friday","2026-11-27"],["Encarte","Sexta da Carne","2026-11-27"],["Aprovação","Sexta da Carne","2026-12-18"],["Negociação","Terçou das Frutas e Verduras","2026-12-22"]],"2026-11-20":[["Montagem","Terçou das Frutas e Verduras","2026-11-24"]],"2026-11-21":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-11-24"]],"2026-11-23":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-11-24"],["Divulgação da campanha","Hora da Economia","2026-11-26"],["Encarte","Terçou das Frutas e Verduras","2026-12-01"],["Recebimento","Sexta da Carne","2026-12-04"],["Pedido","Sexta da Carne","2026-12-18"],["Aprovação","Terçou das Frutas e Verduras","2026-12-22"],["Negociação","Véspera de Natal","2026-12-24"]],"2026-11-24":[["Montagem","Hora da Economia","2026-11-26"],["Divulgação da campanha","Black Friday","2026-11-27"],["Divulgação da campanha","Sexta da Carne","2026-11-27"]],"2026-11-25":[["Divulgação do encarte","Hora da Economia","2026-11-26"],["Montagem","Black Friday","2026-11-27"],["Montagem","Sexta da Carne","2026-11-27"],["Recebimento","Terçou das Frutas e Verduras","2026-12-08"],["Pedido","Terçou das Frutas e Verduras","2026-12-22"],["Aprovação","Véspera de Natal","2026-12-24"],["Negociação","Terçou das Frutas e Verduras","2026-12-29"]],"2026-11-26":[["Divulgação do encarte","Black Friday","2026-11-27"],["Divulgação do encarte","Sexta da Carne","2026-11-27"],["Encarte","Sexta da Carne","2026-12-04"]],"2026-11-27":[["Montagem","Terçou das Frutas e Verduras","2026-12-01"],["Pedido","Véspera de Natal","2026-12-24"],["Aprovação","Terçou das Frutas e Verduras","2026-12-29"],["Negociação","Réveillon","2026-12-31"],["Negociação","Hora da Economia","2026-12-31"]],"2026-11-28":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-12-01"]],"2026-11-30":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-12-01"],["Encarte","Terçou das Frutas e Verduras","2026-12-08"],["Recebimento","Sexta da Carne","2026-12-11"]],"2026-12-01":[["Divulgação da campanha","Sexta da Carne","2026-12-04"],["Recebimento","Sábado Bombástico (Prorrogado)","2026-12-13"],["Recebimento","Sábado Bombástico","2026-12-12"],["Pedido","Terçou das Frutas e Verduras","2026-12-29"],["Aprovação","Réveillon","2026-12-31"],["Aprovação","Hora da Economia","2026-12-31"]],"2026-12-02":[["Montagem","Sexta da Carne","2026-12-04"],["Recebimento","Terçou das Frutas e Verduras","2026-12-15"]],"2026-12-03":[["Divulgação do encarte","Sexta da Carne","2026-12-04"],["Encarte","Sexta da Carne","2026-12-11"],["Pedido","Réveillon","2026-12-31"],["Pedido","Hora da Economia","2026-12-31"]],"2026-12-04":[["Montagem","Terçou das Frutas e Verduras","2026-12-08"],["Encarte","Sábado Bombástico (Prorrogado)","2026-12-13"],["Encarte","Sábado Bombástico","2026-12-12"]],"2026-12-05":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-12-08"]],"2026-12-07":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-12-08"],["Encarte","Terçou das Frutas e Verduras","2026-12-15"],["Recebimento","Sexta da Carne","2026-12-18"]],"2026-12-08":[["Divulgação da campanha","Sexta da Carne","2026-12-11"]],"2026-12-09":[["Montagem","Sexta da Carne","2026-12-11"],["Divulgação da campanha","Sábado Bombástico","2026-12-12"],["Recebimento","Terçou das Frutas e Verduras","2026-12-22"]],"2026-12-10":[["Divulgação do encarte","Sexta da Carne","2026-12-11"],["Divulgação da campanha","Sábado Bombástico (Prorrogado)","2026-12-13"],["Montagem","Sábado Bombástico (Prorrogado)","2026-12-13"],["Montagem","Sábado Bombástico","2026-12-12"],["Encarte","Sexta da Carne","2026-12-18"]],"2026-12-11":[["Divulgação do encarte","Sábado Bombástico","2026-12-12"],["Montagem","Terçou das Frutas e Verduras","2026-12-15"],["Recebimento","Véspera de Natal","2026-12-24"]],"2026-12-12":[["Divulgação do encarte","Sábado Bombástico (Prorrogado)","2026-12-13"],["Divulgação da campanha","Terçou das Frutas e Verduras","2026-12-15"]],"2026-12-14":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-12-15"],["Encarte","Terçou das Frutas e Verduras","2026-12-22"]],"2026-12-15":[["Divulgação da campanha","Sexta da Carne","2026-12-18"],["Recebimento","Terçou das Frutas e Verduras","2026-12-29"]],"2026-12-16":[["Montagem","Sexta da Carne","2026-12-18"],["Encarte","Véspera de Natal","2026-12-24"]],"2026-12-17":[["Divulgação do encarte","Sexta da Carne","2026-12-18"],["Recebimento","Réveillon","2026-12-31"],["Recebimento","Hora da Economia","2026-12-31"]],"2026-12-18":[["Montagem","Terçou das Frutas e Verduras","2026-12-22"],["Encarte","Terçou das Frutas e Verduras","2026-12-29"]],"2026-12-19":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-12-22"]],"2026-12-21":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-12-22"],["Divulgação da campanha","Véspera de Natal","2026-12-24"]],"2026-12-22":[["Montagem","Véspera de Natal","2026-12-24"],["Encarte","Réveillon","2026-12-31"],["Encarte","Hora da Economia","2026-12-31"]],"2026-12-23":[["Divulgação do encarte","Véspera de Natal","2026-12-24"]],"2026-12-24":[["Montagem","Terçou das Frutas e Verduras","2026-12-29"]],"2026-12-26":[["Divulgação da campanha","Terçou das Frutas e Verduras","2026-12-29"]],"2026-12-28":[["Divulgação do encarte","Terçou das Frutas e Verduras","2026-12-29"],["Divulgação da campanha","Réveillon","2026-12-31"],["Divulgação da campanha","Hora da Economia","2026-12-31"]],"2026-12-29":[["Montagem","Réveillon","2026-12-31"],["Montagem","Hora da Economia","2026-12-31"]],"2026-12-30":[["Divulgação do encarte","Réveillon","2026-12-31"],["Divulgação do encarte","Hora da Economia","2026-12-31"]]};
const escalaRoster = [{"grupo":"Caixas Femininos","nome":"Luzia Lanny","enc":"Macio","folga":"Seg","cargo":"Caixa"},{"grupo":"Caixas Femininos","nome":"Helen Tereza","enc":"Macio","folga":"Qui","cargo":"Caixa"},{"grupo":"Caixas Femininos","nome":"Ana Vitorino","enc":"Josinaldo","folga":"Qui","cargo":"Caixa"},{"grupo":"Caixas Femininos","nome":"Anyedja","enc":"Josinaldo","folga":"Qua","cargo":"Caixa"},{"grupo":"Caixas Femininos","nome":"Eduarda Fernandes","enc":"Macio","folga":"Ter","cargo":"Caixa"},{"grupo":"Caixas Femininos","nome":"Denise","enc":"Josinaldo","folga":"Ter","cargo":"Caixa"},{"grupo":"Caixas Femininos","nome":"Heloiza Alves","enc":"Macio","folga":"Ter","cargo":"Caixa"},{"grupo":"Caixas Femininos","nome":"Rosinete","enc":"Macio","folga":"Qua","cargo":"Caixa"},{"grupo":"Caixas Femininos","nome":"Maria Clara","enc":"Macio","folga":"Seg","cargo":"Caixa"},{"grupo":"Caixas Femininos","nome":"Allany","enc":"Josinaldo","folga":"Seg","cargo":"Caixa"},{"grupo":"Caixas Femininos","nome":"(vaga)","enc":"Macio","folga":"Seg","cargo":"Caixa"},{"grupo":"Caixas Femininos","nome":"Ruth","enc":"Josinaldo","folga":"Ter","cargo":"Caixa"},{"grupo":"Caixas Femininos","nome":"Maria Lucia","enc":"Josinaldo","folga":"Seg","cargo":"Caixa"},{"grupo":"Caixas Femininos","nome":"Veronica","enc":"Josinaldo","folga":"Qui","cargo":"Caixa"},{"grupo":"Caixas Masculino","nome":"(vaga)","enc":"Macio","folga":"Qui","cargo":"Caixa"},{"grupo":"Caixas Masculino","nome":"Lenildo","enc":"Josinaldo","folga":"Qua","cargo":"Caixa"},{"grupo":"Caixas Masculino","nome":"Jose Antão","enc":"Macio","folga":"Qui","cargo":"Caixa"},{"grupo":"Caixas Masculino","nome":"Luan Santos","enc":"Macio","folga":"Qua","cargo":"Caixa"},{"grupo":"Caixas Masculino","nome":"Jhon Lenon","enc":"Josinaldo","folga":"Seg","cargo":"Caixa"},{"grupo":"Caixas Masculino","nome":"Felipe Dias","enc":"Josinaldo","folga":"Qua","cargo":"Caixa"},{"grupo":"Embaladores Masculinos","nome":"Jose Jean","enc":"Josinaldo","folga":"Ter","cargo":"Embalador"},{"grupo":"Embaladores Masculinos","nome":"Leandro Saulo","enc":"Josinaldo","folga":"Qua","cargo":"Embalador"},{"grupo":"Embaladores Masculinos","nome":"Rennan","enc":"Josinaldo","folga":"Seg","cargo":"Embalador"},{"grupo":"Embaladores Masculinos","nome":"Rovanildo de Oliveira","enc":"Macio","folga":"Ter","cargo":"Embalador"},{"grupo":"Embaladores Masculinos","nome":"(vaga)","enc":"Macio","folga":"Qui","cargo":"Embalador"},{"grupo":"Embaladores Masculinos","nome":"(vaga)","enc":"Josinaldo","folga":"Qua","cargo":"Embalador"},{"grupo":"Embaladores Masculinos","nome":"João Ferreira","enc":"Josinaldo","folga":"Seg","cargo":"Embalador"},{"grupo":"Embaladores Masculinos","nome":"Jose Cleverton","enc":"Macio","folga":"Ter","cargo":"Embalador"},{"grupo":"Embaladores Masculinos","nome":"(vaga)","enc":"Josinaldo","folga":"Qui","cargo":"Embalador"},{"grupo":"Embaladores Masculinos","nome":"Jose Lucio","enc":"Macio","folga":"Qua","cargo":"Embalador"},{"grupo":"Embaladores Masculinos","nome":"Everton Caio","enc":"Macio","folga":"Qua","cargo":"Embalador"},{"grupo":"Embaladores Masculinos","nome":"Jailson Araujo","enc":"Macio","folga":"Seg","cargo":"Embalador"},{"grupo":"Abastecedores","nome":"Nilton","enc":"","folga":"—","cargo":"Abastecedor","domRot":0},{"grupo":"Abastecedores","nome":"Edivan","enc":"","folga":"—","cargo":"Abastecedor","domRot":0},{"grupo":"Abastecedores","nome":"Maciel","enc":"","folga":"—","cargo":"Abastecedor","domRot":"U0"},{"grupo":"Abastecedores","nome":"Junior","enc":"","folga":"—","cargo":"Abastecedor","domRot":"U0"}];

// Pontos extras de gôndola (aba "Ponto Extra" da planilha "Alugueis dos Galpoes.xlsx").
// Ponto de partida — o usuário edita no navegador e tudo fica salvo lá.
const pontosSeed = [{"numero":1,"abertura":"2026-02-20","vencimento":"2027-01-20","mesPag":"20 JANEIRO","status":"NÃO PAGO","fornecedor":"Riograndense","vendedor":"Josinaldo","valor":400,"pagamento":"Boleto","contrato":"","vencContrato":"","obs":"Mensalmente todo dia 20"},{"numero":2,"abertura":"","vencimento":"","mesPag":"JANEIRO","status":"NÃO PAGO","fornecedor":"Três Corações","vendedor":"Ilberto","valor":0,"pagamento":"","contrato":"","vencContrato":"","obs":""},{"numero":3,"abertura":"2026-01-20","vencimento":"2026-02-20","mesPag":"20 JANEIRO","status":"NÃO PAGO","fornecedor":"Multigiro","vendedor":"Eudes","valor":400,"pagamento":"Boleto","contrato":"","vencContrato":"","obs":"Mensalmente todo dia 20"},{"numero":4,"abertura":"","vencimento":"","mesPag":"JANEIRO","status":"NÃO PAGO","fornecedor":"Riograndense","vendedor":"Rubinha","valor":200,"pagamento":"Boleto","contrato":"","vencContrato":"","obs":""},{"numero":5,"abertura":"","vencimento":"","mesPag":"JANEIRO","status":"NÃO PAGO","fornecedor":"Riograndense","vendedor":"Junior","valor":0,"pagamento":"","contrato":"","vencContrato":"","obs":""},{"numero":6,"abertura":"2026-01-15","vencimento":"2026-02-15","mesPag":"15 JANEIRO","status":"NÃO PAGO","fornecedor":"Comebom","vendedor":"Artenizio","valor":400,"pagamento":"Boleto","contrato":"","vencContrato":"","obs":"Mensalmente todo dia 15"},{"numero":7,"abertura":"","vencimento":"","mesPag":"JANEIRO","status":"NÃO PAGO","fornecedor":"Três Corações","vendedor":"Ilberto","valor":0,"pagamento":"","contrato":"","vencContrato":"","obs":""},{"numero":8,"abertura":"2025-01-10","vencimento":"2026-02-10","mesPag":"JANEIRO","status":"NÃO PAGO","fornecedor":"Tempero Regina","vendedor":"Felipe","valor":1500,"pagamento":"Boleto","contrato":"","vencContrato":"","obs":""},{"numero":9,"abertura":"2026-01-30","vencimento":"30/02/2026","mesPag":"30 JANEIRO","status":"NÃO PAGO","fornecedor":"Acioly","vendedor":"Murielli","valor":500,"pagamento":"Boleto","contrato":"","vencContrato":"","obs":"Mensalmente todo dia 30"},{"numero":10,"abertura":"","vencimento":"","mesPag":"JANEIRO","status":"NÃO PAGO","fornecedor":"Riograndense","vendedor":"Junior","valor":0,"pagamento":"","contrato":"","vencContrato":"","obs":""},{"numero":11,"abertura":"","vencimento":"","mesPag":"JANEIRO","status":"NÃO PAGO","fornecedor":"M. Dias","vendedor":"Sueli","valor":400,"pagamento":"Bonificação","contrato":"","vencContrato":"","obs":""},{"numero":12,"abertura":"2026-01-28","vencimento":"2026-12-28","mesPag":"28 JANEIRO","status":"NÃO PAGO","fornecedor":"Distribuidora Seridó","vendedor":"Michelli","valor":400,"pagamento":"Boleto","contrato":"","vencContrato":"","obs":""},{"numero":13,"abertura":"","vencimento":"","mesPag":"JANEIRO","status":"NÃO PAGO","fornecedor":"Três Corações","vendedor":"Ilberto","valor":0,"pagamento":"","contrato":"","vencContrato":"","obs":""},{"numero":14,"abertura":"","vencimento":"","mesPag":"JANEIRO","status":"NÃO PAGO","fornecedor":"Riograndense","vendedor":"Cidinha","valor":500,"pagamento":"","contrato":"","vencContrato":"","obs":""},{"numero":15,"abertura":"","vencimento":"","mesPag":"JANEIRO","status":"NÃO PAGO","fornecedor":"Mili","vendedor":"André","valor":0,"pagamento":"","contrato":"","vencContrato":"","obs":""},{"numero":16,"abertura":"","vencimento":"","mesPag":"JANEIRO","status":"NÃO PAGO","fornecedor":"Três Corações","vendedor":"Ilberto","valor":0,"pagamento":"","contrato":"","vencContrato":"","obs":""},{"numero":17,"abertura":"","vencimento":"","mesPag":"JANEIRO","status":"NÃO PAGO","fornecedor":"M. Dias","vendedor":"Sueli","valor":400,"pagamento":"Bonificação","contrato":"","vencContrato":"","obs":""},{"numero":18,"abertura":"","vencimento":"","mesPag":"JANEIRO","status":"NÃO PAGO","fornecedor":"Riograndense","vendedor":"Junior","valor":0,"pagamento":"","contrato":"","vencContrato":"","obs":""},{"numero":19,"abertura":"","vencimento":"","mesPag":"JANEIRO","status":"NÃO PAGO","fornecedor":"Limpamil","vendedor":"Marcos","valor":0,"pagamento":"Boleto","contrato":"","vencContrato":"","obs":""},{"numero":20,"abertura":"","vencimento":"","mesPag":"JANEIRO","status":"NÃO PAGO","fornecedor":"Riograndense","vendedor":"Junior","valor":0,"pagamento":"","contrato":"","vencContrato":"","obs":""},{"numero":21,"abertura":"2026-01-30","vencimento":"30/02/2026","mesPag":"30 JANEIRO","status":"NÃO PAGO","fornecedor":"Acioly","vendedor":"Murielli","valor":200,"pagamento":"Boleto","contrato":"","vencContrato":"","obs":"Mensalmente todo dia 30"}];

const html = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Painel — Supermercado Santa Rita</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; margin:0; background:#eef1f6; color:#1a2233; }
  header { background:linear-gradient(120deg,#0a4d21 0%,#157a35 55%,#1f9d3f 100%); color:#fff; padding:18px 32px; border-bottom:3px solid #e11b0e; }
  header .hwrap { display:flex; align-items:center; gap:16px; max-width:none; margin:0; }
  header .logo { flex:none; display:flex; align-items:center; justify-content:center; }
  header .logo img { height:56px; width:auto; display:block; filter:drop-shadow(0 2px 6px rgba(0,0,0,.35)); }
  header .htxt { flex:1; min-width:0; }
  header h1 { margin:0; font-size:22px; letter-spacing:.2px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  header p { margin:4px 0 0; opacity:.9; font-size:12.5px; }
  .tag { display:inline-flex; align-items:center; gap:6px; background:#ffffff22; border:1px solid #ffffff55; padding:3px 11px; border-radius:20px; font-size:11px; font-weight:600; letter-spacing:.3px; vertical-align:middle; }
  .tag .dot { width:7px; height:7px; border-radius:50%; background:#5df08a; animation:pulseDot 1.8s infinite; }
  @keyframes pulseDot { 0%{box-shadow:0 0 0 0 rgba(93,240,138,.6);} 70%{box-shadow:0 0 0 7px rgba(93,240,138,0);} 100%{box-shadow:0 0 0 0 rgba(93,240,138,0);} }
  .layout { display:flex; align-items:flex-start; max-width:none; margin:0; }
  .sidebar { width:210px; flex:none; padding:22px 14px; position:sticky; top:0; }
  .sidebar .titulo { font-size:11px; color:#8a97a8; text-transform:uppercase; letter-spacing:.5px; padding:0 12px 8px; }
  .nav-item { display:flex; align-items:center; gap:10px; width:100%; text-align:left; background:none; border:0; cursor:pointer; padding:11px 12px; border-radius:9px; font-size:14px; color:#33404f; font-weight:500; margin-bottom:3px; }
  .nav-item:hover { background:#e2e8f1; }
  .nav-item.ativo { background:#157a35; color:#fff; font-weight:600; }
  .nav-item .ico { width:20px; display:inline-flex; align-items:center; justify-content:center; flex:none; color:#8a97a8; }
  .nav-item.ativo .ico { color:#fff; }
  .nav-item .ico svg { width:18px; height:18px; display:block; }
  .nav-item .soon { margin-left:auto; font-size:9px; background:#cdd6e0; color:#5a6678; padding:1px 6px; border-radius:20px; text-transform:uppercase; letter-spacing:.3px; }
  .nav-badge { margin-left:auto; min-width:19px; height:19px; padding:0 5px; background:#c0392b; color:#fff; border-radius:10px; font-size:11px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; box-shadow:0 0 0 2px #fff; }
  .nav-item.ativo .nav-badge { box-shadow:0 0 0 2px #157a35; }
  .nav-item.ativo .soon { background:#ffffff33; color:#fff; }
  main { flex:1 1 auto; min-width:0; max-width:1340px; margin:0 auto; padding:22px 32px 60px; }
  .page { display:none; }
  .page.ativo { display:grid; grid-template-columns:minmax(0,1fr); gap:22px; }
  .page.ativo > * { min-width:0; }
  .em-breve { background:#fff; border-radius:12px; padding:60px 40px; text-align:center; box-shadow:0 1px 4px rgba(0,0,0,.07); }
  .em-breve .big { font-size:46px; }
  .em-breve h2 { margin:14px 0 6px; color:#0c5a26; }
  .em-breve p { color:#6b7787; font-size:14px; margin:0; max-width:460px; margin-inline:auto; }
  .filtros { background:#fff; border-radius:12px; padding:16px 20px; box-shadow:0 1px 4px rgba(0,0,0,.07); display:flex; align-items:flex-end; gap:18px; flex-wrap:wrap; }
  .filtros .campo { display:flex; flex-direction:column; gap:5px; }
  .filtros label { font-size:11px; color:#6b7787; text-transform:uppercase; letter-spacing:.4px; }
  .filtros input { padding:9px 11px; border:1px solid #cdd6e0; border-radius:8px; font-size:14px; }
  .filtros button { padding:9px 16px; border:0; border-radius:8px; font-size:14px; cursor:pointer; font-weight:600; }
  .btn-p { background:#157a35; color:#fff; border:0; border-radius:9px; padding:8px 16px; font-size:13px; font-weight:600; cursor:pointer; box-shadow:0 1px 3px rgba(21,122,53,.25); transition:background .15s, box-shadow .15s, transform .05s; }
  .btn-p:hover { background:#0c5a26; box-shadow:0 2px 7px rgba(21,122,53,.32); }
  .btn-p:active { transform:translateY(1px); box-shadow:0 1px 2px rgba(21,122,53,.25); }
  .btn-s { background:#eef2f7; color:#33404f; border:1px solid #dbe2ea; border-radius:9px; padding:8px 16px; font-size:13px; font-weight:600; cursor:pointer; transition:background .15s, border-color .15s, box-shadow .15s, transform .05s; }
  .btn-s:hover { background:#e3f0e8; border-color:#9ccfb1; color:#157a35; box-shadow:0 1px 3px rgba(21,122,53,.15); }
  .btn-s:active { transform:translateY(1px); background:#d6e9de; }
  .periodo-info { margin-left:auto; font-size:12px; color:#6b7787; }
  .modal-bg { position:fixed; inset:0; background:rgba(20,28,38,.45); display:none; align-items:center; justify-content:center; z-index:9999; padding:20px; }
  .modal-bg.show { display:flex; }
  .modal-cx { background:#fff; border-radius:14px; max-width:430px; width:100%; box-shadow:0 18px 50px rgba(0,0,0,.28); overflow:hidden; animation:modalIn .15s ease; }
  @keyframes modalIn { from { transform:translateY(10px); opacity:0; } to { transform:none; opacity:1; } }
  .modal-top { display:flex; align-items:center; gap:12px; padding:20px 24px 0; }
  .modal-ic { width:40px; height:40px; border-radius:50%; background:#fff4e0; color:#e08600; display:flex; align-items:center; justify-content:center; flex:0 0 auto; }
  .modal-tit { font-size:16px; font-weight:700; color:#1a2233; }
  .modal-msg { padding:12px 24px 4px; color:#46535f; font-size:14px; line-height:1.5; }
  .modal-acts { display:flex; justify-content:flex-end; gap:10px; padding:18px 24px 20px; }
  .modal-acts .btn-p { padding:9px 18px; border-radius:9px; font-weight:600; transition:filter .15s; }
  .modal-acts .btn-p:hover { filter:brightness(1.08); }
  .obrig { color:#c0392b; font-weight:700; margin-left:2px; }
  .campo-erro { border-color:#c0392b !important; box-shadow:0 0 0 3px rgba(192,57,43,.15); }
  .kpis { display:grid; grid-template-columns:repeat(5,1fr); gap:14px; }
  .kpi { background:#fff; border-radius:12px; padding:16px 18px; box-shadow:0 1px 4px rgba(0,0,0,.07); }
  .kpi .v { font-size:22px; font-weight:700; color:#0c5a26; }
  .kpi .l { font-size:12px; color:#6b7787; margin-top:3px; text-transform:uppercase; letter-spacing:.4px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:22px; }
  .card { background:#fff; border-radius:12px; padding:18px 20px; box-shadow:0 1px 4px rgba(0,0,0,.07); }
  .card h2 { font-size:14px; margin:0 0 16px; color:#0c5a26; }
  .bars { display:flex; align-items:flex-end; gap:10px; height:170px; padding-top:10px; }
  .bar-col { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; }
  .bar-v { width:70%; border-radius:5px 5px 0 0; min-height:3px; transition:height .85s cubic-bezier(.22,1,.36,1), opacity .2s; }
  .bar-col:hover .bar-v { opacity:.8; }
  .bar-lbl { font-size:10px; color:#6b7787; margin-top:6px; white-space:nowrap; }
  .hbars { display:flex; flex-direction:column; gap:11px; }
  .hbar-row { display:grid; grid-template-columns:130px 1fr 110px; align-items:center; gap:10px; }
  .hbar-lbl { font-size:12px; color:#33404f; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .hbar-track { background:#eef2f7; border-radius:6px; height:18px; overflow:hidden; }
  .hbar-fill { height:100%; border-radius:6px; transition:width .85s cubic-bezier(.22,1,.36,1); }
  .hbar-val { font-size:12px; text-align:right; color:#33404f; font-weight:600; }
  table { border-collapse:collapse; width:100%; font-size:13px; }
  th { background:#f3f6fa; text-align:left; padding:9px 11px; color:#46546a; font-size:11px; text-transform:uppercase; letter-spacing:.3px; }
  td { padding:9px 11px; border-top:1px solid #eef2f7; }
  .badge { display:inline-block; padding:2px 9px; border-radius:20px; color:#fff; font-size:11px; font-weight:700; white-space:nowrap; }
  .badge-status { display:inline-flex; align-items:center; gap:5px; padding:4px 12px; cursor:default; user-select:none; }
  .px-exp { background:none; border:0; cursor:pointer; color:#6b7787; padding:4px; display:inline-flex; align-items:center; border-radius:6px; transition:background .12s, color .12s; }
  .px-exp:hover { background:#e3f0e8; color:#157a35; }
  .px-exp svg { transition:transform .15s; }
  .px-exp.aberto svg { transform:rotate(90deg); }
  .px-det > td { background:#f7f9fc; padding:0; border-top:0; }
  .px-det-wrap { border-left:3px solid #157a35; }
  .px-det-box { padding:14px 20px; display:grid; grid-template-columns:repeat(5, auto); justify-content:center; gap:14px 56px; align-items:center; }
  .px-det-box .px-det-item { max-width:300px; }
  .px-det-item { display:flex; flex-direction:column; gap:2px; }
  .px-det-contrato { justify-self:end; width:210px; }
  .px-det-contrato .px-arq-link { max-width:130px; }
  .px-det-item b { font-size:10px; text-transform:uppercase; letter-spacing:.5px; color:#6b7787; font-weight:700; }
  .px-det-item span { font-size:14px; color:#2a3340; }
  .px-arq { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .px-arq-link { display:inline-flex; align-items:center; gap:6px; max-width:240px; padding:5px 12px; background:#e3f0e8; color:#157a35; border-radius:7px; font-size:13px; font-weight:600; text-decoration:none; }
  .px-arq-link span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#157a35; font-size:13px; }
  .px-arq-link:hover { background:#d3e8dc; }
  .px-arq-anexar { display:inline-flex; align-items:center; gap:6px; padding:6px 14px; background:#157a35; color:#fff; border:0; border-radius:7px; font-size:13px; font-weight:600; cursor:pointer; }
  .px-arq-anexar:hover { background:#11652b; }
  .px-arq-btn { padding:5px 11px; background:#fff; color:#46535f; border:1px solid #cdd6e0; border-radius:7px; font-size:12px; font-weight:600; cursor:pointer; }
  .px-arq-btn:hover { background:#f3f6fa; }
  .px-arq-icon { display:inline-flex; align-items:center; justify-content:center; padding:5px 8px; background:#fff; color:#46535f; border:1px solid #cdd6e0; border-radius:7px; cursor:pointer; }
  .px-arq-icon:hover { background:#f3f6fa; }
  .px-arq-icon.rem { color:#c0392b; border-color:#e3b7b1; }
  .px-arq-icon.rem:hover { background:#fbeae8; }
  .px-arq-rem { color:#c0392b; border-color:#e3b7b1; }
  .px-arq-rem:hover { background:#fbeae8; }
  .px-gerar-ct { align-self:flex-start; display:inline-flex; align-items:center; gap:6px; margin-top:8px; padding:6px 14px; background:#157a35; color:#fff; border:0; border-radius:7px; font-size:13px; font-weight:600; cursor:pointer; }
  .px-gerar-ct:hover { background:#11652b; }
  .px-filtro { padding:8px 34px 8px 12px; border:1px solid #cdd6e0; border-radius:8px; font-size:14px; color:#2a3340; background-color:#fff; -webkit-appearance:none; appearance:none; background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2346535f' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 11px center; cursor:pointer; }
  .px-filtro:hover { border-color:#9aa6b2; }
  .px-filtro:focus { outline:none; border-color:#2f6fed; box-shadow:0 0 0 3px rgba(47,111,237,.15); }
  .px-agenda { padding:0 20px 16px; margin-top:14px; }
  .px-agenda-vazia { padding:0 20px 16px; color:#6b7787; font-size:13px; font-style:italic; }
  .px-agenda-tit { font-size:11px; text-transform:uppercase; letter-spacing:.5px; color:#157a35; font-weight:700; margin-bottom:8px; }
  .px-agenda-tb { border-collapse:collapse; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 1px 3px rgba(0,0,0,.08); }
  .px-agenda-tb th { background:#157a35; color:#fff; font-size:10px; text-transform:uppercase; letter-spacing:.5px; font-weight:700; padding:7px 16px; text-align:center; }
  .px-agenda-tb td { padding:6px 16px; font-size:13px; color:#2a3340; border-top:1px solid #eef2f6; text-align:center; }
  .px-agenda-tb td .px-data { text-align:left; }
  .px-data { display:inline-flex; align-items:baseline; gap:5px; font-variant-numeric:tabular-nums; }
  .px-data-dia { font-size:12px; font-weight:600; letter-spacing:0; color:#1d2733; line-height:1; min-width:18px; }
  .px-data-my { display:flex; flex-direction:column; line-height:1.25; }
  .px-data-mes { font-size:12px; font-weight:600; color:#3b4756; text-transform:capitalize; }
  .px-data-sem { font-size:10px; font-weight:600; color:#9aa6b2; text-transform:uppercase; letter-spacing:.5px; }
  .px-agenda-tb tbody tr:first-child td { border-top:0; }
  .px-comp-cell { white-space:nowrap; }
  .px-comp-add { padding:3px 12px; background:#157a35; color:#fff; border:0; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; }
  .px-comp-add:hover { background:#11652b; }
  .px-comp-link { display:inline-flex; align-items:center; gap:5px; color:#157a35; font-size:12px; font-weight:600; text-decoration:none; }
  .px-comp-link:hover { text-decoration:underline; }
  .px-comp-x { margin-left:8px; padding:0 5px; background:none; border:0; color:#c0392b; font-size:13px; font-weight:700; cursor:pointer; border-radius:4px; }
  .px-comp-x:hover { background:#fbeae8; }
  .pix-cfg-sum { cursor:pointer; font-weight:700; color:#1a2233; font-size:14px; display:flex; align-items:center; gap:8px; list-style:none; }
  .pix-cfg-sum::-webkit-details-marker { display:none; }
  .pix-cfg-sum .ico { font-size:15px; }
  .pix-cfg-st { font-size:11px; font-weight:700; padding:2px 8px; border-radius:20px; }
  .pix-cfg-st.ok { background:#e3f0e8; color:#157a35; }
  .pix-cfg-st.no { background:#fdecea; color:#c0392b; }
  .pix-cfg-grid { display:grid; grid-template-columns:1.2fr 1fr; gap:16px; align-items:end; margin-top:16px; }
  .pix-cfg-grid .campo { display:flex; flex-direction:column; gap:6px; min-width:0; }
  .pix-cfg-grid label { font-size:11px; color:#6b7787; text-transform:uppercase; letter-spacing:.4px; font-weight:600; }
  .pix-cfg-grid input { width:100%; box-sizing:border-box; padding:9px 11px; border:1px solid #cdd6e0; border-radius:8px; font-size:14px; min-width:0; }
  .pix-cfg-grid input:focus { outline:none; border-color:#157a35; box-shadow:0 0 0 2px rgba(21,122,53,.15); }
  .pix-cfg-grid input:disabled { background:#f3f5f8; color:#8a96a3; cursor:not-allowed; }
  .pix-cfg-acoes { display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-top:18px; }
  .pix-cfg-acoes button { display:inline-flex; align-items:center; gap:7px; height:42px; padding:0 20px; border-radius:10px; font-size:14px; font-weight:600; cursor:pointer; transition:background .15s, border-color .15s, box-shadow .15s, transform .05s, filter .15s; }
  .pix-cfg-acoes .btn-p { border:0; box-shadow:0 1px 3px rgba(21,122,53,.25); }
  .pix-cfg-acoes .btn-p:hover { filter:brightness(1.08); box-shadow:0 2px 6px rgba(21,122,53,.3); }
  .pix-cfg-acoes .btn-p:active { transform:translateY(1px); }
  .pix-cfg-acoes .btn-s { background:#fff; border:1px solid #dbe2ea; color:#33404f; }
  .pix-cfg-acoes .btn-s:hover { background:#e3f0e8; border-color:#9ccfb1; color:#157a35; box-shadow:0 1px 3px rgba(21,122,53,.15); }
  .pix-cfg-acoes .btn-s:active { transform:translateY(1px); background:#d6e9de; }
  .pix-cfg-acoes button .ico { font-size:15px; }
  .pix-cfg-aviso { font-size:12px; color:#6b7787; line-height:1.5; margin:14px 0 2px; }
  .pix-trava-nota { font-size:12px; color:#8a6d3b; line-height:1.5; margin:8px 0 0; }
  @media (max-width:720px){ .pix-cfg-grid { grid-template-columns:1fr; } }
  .up-inp { width:100%; box-sizing:border-box; padding:9px 11px; border:1px solid #cfd6dd; border-radius:8px; font-size:14px; }
  .up-inp:focus { outline:none; border-color:#157a35; box-shadow:0 0 0 2px rgba(21,122,53,.15); }
  .ui-ic-lock { background:#fef3e2; }
  .px-pix-cell { white-space:nowrap; }
  .px-pix-btn { display:inline-flex; align-items:center; gap:5px; padding:3px 12px; background:#0a8a6f; color:#fff; border:0; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; }
  .px-pix-btn:hover { background:#087a62; }
  .px-mark { display:inline-flex; align-items:center; padding:3px 10px; background:#fff; color:#56606d; border:1px solid #cdd6e0; border-radius:6px; font-size:11.5px; font-weight:600; cursor:pointer; margin-left:5px; }
  .px-mark:hover { background:#f4f7fb; }
  .px-aguard { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; background:#fff4d6; color:#9a6b00; border:1px solid #f0d68a; border-radius:6px; font-size:11.5px; font-weight:700; }
  .px-aut { display:inline-flex; align-items:center; padding:3px 11px; background:#157a35; color:#fff; border:0; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer; margin-left:5px; }
  .px-aut:hover { background:#0c5a26; }
  .px-rec { display:inline-flex; align-items:center; padding:3px 8px; background:#fff; color:#c0392b; border:1px solid #e3b4ad; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer; margin-left:4px; }
  .px-inad { background:#fff5f4; border:1px solid #f3c9c2; border-radius:12px; padding:14px 18px; margin:0; }
  .px-inad-top { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-bottom:10px; }
  .px-inad-tit { font-size:15px; font-weight:800; color:#b8362a; }
  .px-inad-tot { font-size:13px; font-weight:700; color:#b8362a; background:#fff; border:1px solid #f0c0b8; padding:4px 12px; border-radius:20px; }
  .px-inad-tb { width:100%; border-collapse:collapse; font-size:13px; }
  .px-inad-tb th { text-align:left; color:#9a4a40; font-weight:700; padding:6px 10px; border-bottom:1px solid #f0d0ca; font-size:11.5px; text-transform:uppercase; letter-spacing:.3px; }
  .px-inad-tb td { padding:7px 10px; border-bottom:1px solid #f6e3df; color:#3a2b29; }
  .px-inad-tb tr:last-child td { border-bottom:0; }
  .px-inad-desde { color:#9aa0a6; font-size:11.5px; }
  .px-quitado { display:inline-flex; align-items:center; gap:5px; padding:3px 11px; background:#eaf7ee; color:#157a35; border:1px solid #c4e6cf; border-radius:6px; font-size:12px; font-weight:700; white-space:nowrap; }
  .pix-cx { max-width:380px; }
  .pix-ic { background:#e3f0e8; color:#157a35; }
  .pix-body { padding:6px 24px 4px; }
  .pix-sub { font-size:13px; color:#46535f; line-height:1.5; margin-bottom:12px; }
  .pix-qr { text-align:center; }
  .pix-qr img { width:210px; height:210px; image-rendering:pixelated; border:1px solid #eef2f6; border-radius:8px; }
  .pix-cc-lbl { font-size:10px; text-transform:uppercase; letter-spacing:.5px; color:#6b7787; font-weight:700; margin:14px 0 4px; }
  .pix-cc { width:100%; box-sizing:border-box; font-family:monospace; font-size:11px; color:#2a3340; border:1px solid #cdd6e0; border-radius:8px; padding:8px; resize:none; word-break:break-all; }
  .pix-copiar { width:100%; margin-top:10px; display:inline-flex; align-items:center; justify-content:center; gap:8px; height:44px; border:0; border-radius:10px; background:#157a35; color:#fff; font-size:14px; font-weight:700; cursor:pointer; box-shadow:0 2px 6px rgba(21,122,53,.28); transition:background .15s, box-shadow .15s, transform .05s; }
  .pix-copiar:hover { background:#12692e; box-shadow:0 3px 10px rgba(21,122,53,.34); }
  .pix-copiar:active { transform:translateY(1px); box-shadow:0 1px 3px rgba(21,122,53,.28); }
  .pix-copiar.ok { background:#0c8a4a; }
  .pix-copiar svg { width:16px; height:16px; flex:0 0 auto; }
  .pix-ficha-cx { max-width:520px; width:100%; }
  .pix-ficha-scroll { max-height:70vh; overflow:auto; padding:14px; background:#eaeef3; border-radius:10px; }
  .pix-ficha-scroll img { width:100%; display:block; border-radius:8px; box-shadow:0 4px 18px rgba(20,30,45,.18); }
  a.px-arq-btn { text-decoration:none; display:inline-flex; align-items:center; }
  .pill { display:flex; align-items:center; gap:8px; margin-bottom:9px; }
  .pill .dot { width:11px; height:11px; border-radius:50%; }
  .pill .nm { font-size:13px; flex:1; }
  .pill .vl { font-size:13px; font-weight:600; }
  .vazio { color:#8a97a8; font-style:italic; font-size:13px; }
  footer { text-align:center; font-size:12px; color:#8a97a8; padding:10px; }
  .cal-top { display:flex; align-items:center; gap:14px; margin-bottom:16px; }
  .cal-nav { width:34px; height:34px; border:1px solid #cdd6e0; background:#fff; border-radius:8px; font-size:20px; line-height:1; cursor:pointer; color:#33404f; }
  .cal-nav:hover { background:#eef2f7; }
  .cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:6px; }
  .cal-head div { text-align:center; font-size:11px; font-weight:700; color:#6b7787; text-transform:uppercase; letter-spacing:.4px; padding:6px 0; }
  .cal-cell { min-height:96px; border:1px solid #e6ebf1; border-radius:9px; padding:7px 8px; background:#fff; display:flex; flex-direction:column; gap:4px; }
  .cal-cell .dia { font-size:13px; font-weight:600; color:#33404f; }
  .cal-cell.fora { background:#f6f8fb; }
  .cal-cell.fora .dia { color:#b7c0cd; }
  .cal-cell.fds .dia { color:#c0392b; }
  .cal-cell.hoje { border:2px solid #157a35; }
  .cal-cell.hoje .dia { background:#157a35; color:#fff; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; }
  .cal-toggle { display:flex; border:1px solid #cdd6e0; border-radius:8px; overflow:hidden; }
  .cal-toggle .seg { border:0; background:#fff; padding:8px 16px; font-size:13px; cursor:pointer; color:#33404f; font-weight:600; }
  .cal-toggle .seg.ativo { background:#157a35; color:#fff; }
  .cal-ano { display:grid; grid-template-columns:repeat(3,1fr); gap:20px; }
  .mini { border:1px solid #e6ebf1; border-radius:10px; padding:12px; cursor:pointer; }
  .mini:hover { box-shadow:0 2px 8px rgba(0,0,0,.08); }
  .mini h3 { margin:0 0 8px; font-size:13px; color:#0c5a26; text-align:center; }
  .mini-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:2px; }
  .mini-grid .mh { font-size:9px; color:#8a97a8; text-align:center; font-weight:700; }
  .mini-cell { font-size:11px; text-align:center; padding:4px 0; border-radius:4px; color:#33404f; }
  .mini-cell.fora { color:#cdd6e0; }
  .mini-cell.fds { color:#c0392b; }
  .mini-cell.hoje { background:#157a35; color:#fff; font-weight:700; }
  .cal-cell.fechado { background:#fdecec; border-color:#f3c6c6; }
  .cal-cell.fechado .fechado-tag { font-size:10px; font-weight:700; color:#c0392b; text-transform:uppercase; letter-spacing:.3px; line-height:1.2; }
  .mini-cell.fechado { background:#fdecec; color:#c0392b; font-weight:700; }
  .cal-legenda { display:flex; gap:16px; margin-top:14px; font-size:12px; color:#6b7787; flex-wrap:wrap; }
  .cal-legenda span { display:flex; align-items:center; gap:6px; }
  .cal-legenda .qd { width:13px; height:13px; border-radius:3px; }
  .camp { font-size:10px; line-height:1.25; padding:2px 5px; border-radius:5px; color:#fff; font-weight:600; margin-top:auto; }
  .mini-cell.tem-camp { color:#fff; font-weight:700; }
  /* Legenda clicável + destaque dos dias da campanha selecionada */
  .leg-item { cursor:pointer; padding:2px 5px; border-radius:6px; transition:background .15s; }
  .leg-item:hover { background:#e8eef5; }
  .leg-item.sel { background:#dce6f2; font-weight:700; color:#0c5a26; }
  .cal-cell.destacado { outline:3px solid #0c5a26; outline-offset:-3px; box-shadow:0 0 0 4px rgba(13,59,102,.18); z-index:1; }
  .cal-cell.atenuado { opacity:.32; }
  .mini-cell.destacado { outline:2px solid #0c5a26; outline-offset:-2px; box-shadow:0 0 0 2px rgba(13,59,102,.22); }
  .mini-cell.atenuado { opacity:.3; }
  /* ---- Escala de trabalho ---- */
  .esc-top { display:flex; align-items:center; gap:12px; margin-bottom:14px; flex-wrap:wrap; }
  .esc-print-cab { display:none; }
  .esc-legenda { display:flex; gap:16px; margin-bottom:12px; font-size:12px; color:#6b7787; flex-wrap:wrap; }
  .esc-legenda span { display:flex; align-items:center; gap:6px; }
  .esc-legenda .qd { width:16px; height:16px; border-radius:4px; border:1px solid #d4dbe5; }
  .esc-grupo { font-size:14px; font-weight:700; color:#0c5a26; margin:18px 0 6px; }
  .esc-scroll { overflow-x:auto; border:1px solid #e6ebf1; border-radius:8px; }
  table.esc { border-collapse:collapse; font-size:11px; white-space:nowrap; width:100%; }
  table.esc th, table.esc td { border:1px solid #e6ebf1; padding:4px 6px; text-align:center; }
  table.esc th { background:#f3f6fa; color:#46546a; font-weight:700; }
  table.esc th.nome, table.esc td.nome { position:sticky; left:0; text-align:left; min-width:170px; z-index:2; background:#fff; }
  table.esc th.nome { background:#f3f6fa; z-index:3; }
  table.esc th.dom { background:#dcebfb; }
  table.esc th.dom, table.esc th.domh { background:#e3eefb; color:#0c5a26; }
  table.esc td.cel { cursor:default; font-weight:700; min-width:38px; }
  table.esc td.cel.dom { }
  .cel-t1 { background:#FFB154; color:#fff; }
  .cel-t2 { background:#01B0F0; color:#fff; }
  .cel-folga { background:#48DC62; color:#fff; }
  .esc-enc { color:#8a97a8; font-weight:400; font-size:10px; }
  .esc-del { cursor:pointer; color:#c0392b; font-weight:700; margin-right:5px; }
  .esc-nome { cursor:pointer; }
  .esc-nome:hover { text-decoration:underline; }
  .esc-hub-tit { font-size:18px; font-weight:700; color:#157a35; margin:4px 2px 16px; }
  .esc-hub { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:16px; padding:2px; }
  .esc-setor { background:#fff; border:1px solid #e6ebf1; border-radius:14px; padding:20px; cursor:pointer; transition:.13s; box-shadow:0 1px 4px rgba(0,0,0,.06); display:flex; align-items:center; gap:14px; }
  .esc-setor:hover { border-color:#157a35; box-shadow:0 5px 16px rgba(21,122,53,.16); transform:translateY(-2px); }
  .esc-setor .ic { width:48px; height:48px; border-radius:12px; background:#e3f0e8; color:#157a35; display:flex; align-items:center; justify-content:center; flex:none; }
  .esc-setor .ic svg { width:24px; height:24px; }
  .esc-setor .nm { font-size:16px; font-weight:700; color:#1a2233; }
  .esc-setor .qt { font-size:12.5px; color:#8a97a8; margin-top:3px; }
  .esc-nome-input { font:inherit; color:#1a2233; border:2px solid #157a35; border-radius:6px; padding:3px 7px; width:155px; outline:none; box-shadow:0 0 0 3px rgba(21,122,53,.15); }
  .esc-domcol { font-weight:700; color:#0c5a26; }
  .px-venc-vencido { color:#c0392b; font-weight:700; }
  .px-venc-prox { color:#e8820e; font-weight:700; }
  #pxTabela td .esc-nome { color:#157a35; }
  @media print {
    @page { size: landscape; margin: 6mm; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
    html, body, .layout, main, .card, #page-escala { background:#fff !important; }
    header, .sidebar, footer, .esc-top, .esc-legenda, #escVoltar, #escHub { display:none !important; }
    .esc-print-cab { display:flex !important; align-items:baseline; justify-content:space-between; margin-bottom:8px; padding-bottom:4px; border-bottom:2px solid #157a35; }
    #escPrintTitulo { font-size:15px; font-weight:700; color:#157a35; }
    #escPrintData { font-size:9px; color:#6b7787; }
    .page:not(#page-escala) { display:none !important; }
    main { padding:0; }
    .card { box-shadow:none; padding:0; }
    /* deixa a tabela inteira caber na folha: sem rolagem e sem coluna fixa */
    .esc-scroll { overflow:visible !important; border:none !important; }
    table.esc { font-size:8px; width:100% !important; table-layout:fixed; }
    table.esc th, table.esc td { padding:2px 0; min-width:0 !important; overflow:hidden; }
    table.esc th { font-size:6px; line-height:1.05; }
    table.esc th.nome, table.esc td.nome { position:static !important; min-width:0 !important; width:132px; box-shadow:none !important; white-space:nowrap; overflow:visible; font-size:8px; line-height:1.1; padding-left:7px !important; text-align:left !important; }
    table.esc th.nome { font-size:7px; }
    table.esc th:nth-child(2), table.esc td:nth-child(2) { width:30px; white-space:normal; }
    .esc-enc { display:inline !important; color:#6b7787 !important; font-size:7px; }
    .cel-t1 { background:#FFB154 !important; color:#fff !important; }
    .cel-t2 { background:#01B0F0 !important; color:#fff !important; }
    .cel-folga { background:#48DC62 !important; color:#fff !important; }
  }
</style></head>
<body>
  <header>
    <div class="hwrap">
      <div class="logo">
        <img src="${logoDataUri}" alt="Supermercado Santa Rita">
      </div>
      <div class="htxt">
        <h1>Painel de Gestão <span class="tag"><span class="dot"></span> dados reais do VR</span></h1>
        <p>Visão geral de vendas · lido do sistema VR da loja · gerado em ${geradoEm}</p>
      </div>
    </div>
  </header>
  <div class="layout">
  <nav class="sidebar">
    <div class="titulo">Painel de controle</div>
    <button class="nav-item ativo" data-page="vendas"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></span> Vendas</button>
    <button class="nav-item" data-page="analise"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg></span> Análise</button>
    <button class="nav-item" data-page="estoque"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></span> Estoque</button>
    <button class="nav-item" data-page="calendario"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span> Calendário</button>
    <button class="nav-item" data-page="escala"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg></span> Escala</button>
    <button class="nav-item" data-page="ferias"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M17.66 17.66l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M6.34 17.66l-1.41 1.41"/><path d="M19.07 4.93l-1.41 1.41"/></svg></span> Férias</button>
    <button class="nav-item" data-page="pontos"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></span> Pontos extras<span class="nav-badge" id="pxNavBadge" style="display:none;"></span></button>
    <button class="nav-item" data-page="mapa"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></span> Mapa dos pontos</button>
    <button class="nav-item" data-page="layout"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg></span> Layout da loja</button>
    <button class="nav-item" data-page="organograma"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v6"/><path d="M5 17v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/></svg></span> Organograma</button>
    <button class="nav-item" data-page="fluxograma"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg></span> Fluxograma</button>
    <button class="nav-item" data-page="perdas"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span> Perdas/Quebras</button>
    <button class="nav-item" data-page="acougue"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3z"/><path d="M15 8h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-4"/><path d="M3 19h13"/></svg></span> Perdas açougue</button>
    <button class="nav-item" data-page="negociar"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></span> Negociar<span class="nav-badge" id="negNavBadge" style="display:none;"></span></button>
    <button class="nav-item" data-page="metas"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></span> Metas <span class="soon">em breve</span></button>
    <button class="nav-item" data-page="entregas"><span class="ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg></span> Entregas</button>
  </nav>
  <main>
    <section id="page-vendas" class="page ativo">
    <div class="filtros">
      <div class="campo">
        <label for="de">Data inicial</label>
        <input type="date" id="de" min="${dataMin}" max="${dataMax}" value="${defaultDe}">
      </div>
      <div class="campo">
        <label for="ate">Data final</label>
        <input type="date" id="ate" min="${dataMin}" max="${dataMax}" value="${dataMax}">
      </div>
      <div class="campo">
        <label for="cod">Código do produto</label>
        <input type="text" id="cod" list="listaCodigos" placeholder="ex: 001" autocomplete="off">
        <datalist id="listaCodigos">${datalistCodigos}</datalist>
      </div>
      <div class="campo">
        <label for="nome">Nome do produto</label>
        <input type="text" id="nome" list="listaNomes" placeholder="ex: Arroz" autocomplete="off">
        <datalist id="listaNomes">${datalistNomes}</datalist>
      </div>
      <button class="btn-p" id="aplicar">Pesquisar</button>
      <button class="btn-s" id="limpar">Limpar (tudo)</button>
      <span class="periodo-info" id="periodoInfo"></span>
    </div>

    <div class="kpis" id="kpis"></div>

    <div class="grid2">
      <div class="card"><h2>Faturamento por dia</h2><div id="porDia"></div></div>
      <div class="card"><h2>Faturamento por hora</h2><div id="porHora"></div></div>
    </div>

    <div class="grid2">
      <div class="card"><h2>Produtos mais vendidos (faturamento)</h2><div id="rankProd"></div></div>
      <div class="card"><h2>Ranking de operadores</h2><div id="rankOp"></div></div>
    </div>

    <div class="grid2">
      <div class="card"><h2>Curva ABC (quais produtos puxam o faturamento)</h2><div id="abc"></div></div>
      <div class="card"><h2>Estoque / Ruptura <small style="color:#8a97a8;font-weight:normal">(atual, não filtra por data)</small></h2><div id="estoque"></div></div>
    </div>

    <div class="card"><h2>Formas de pagamento</h2><div id="pagamentos"></div></div>
    </section>

    <section id="page-analise" class="page">
      <style>
        #page-analise .kpi .v.ind-ok{color:#1b9e4b;}
        #page-analise .kpi .v.ind-bad{color:#c0392b;}
        #page-analise .kpi .v.ind-est{color:#1565c0;}
        #page-analise .kpi-help{display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;border-radius:50%;background:#c2ccd8;color:#fff;font-size:10px;font-weight:800;cursor:help;margin-left:5px;position:relative;vertical-align:middle;}
        #page-analise .kpi-help:hover{background:#157a35;}
        #page-analise .kpi-help:hover::after{content:attr(data-tip);position:absolute;bottom:160%;left:50%;transform:translateX(-50%);width:230px;background:#1f2d3d;color:#fff;font-size:11.5px;font-weight:500;line-height:1.45;padding:9px 11px;border-radius:8px;box-shadow:0 3px 14px rgba(0,0,0,.28);z-index:60;text-align:left;white-space:normal;}
        #page-analise .kpi-help:hover::before{content:"";position:absolute;bottom:160%;left:50%;transform:translate(-50%,90%);border:6px solid transparent;border-top-color:#1f2d3d;z-index:60;}
        #page-analise #anKpis .kpi{display:flex;flex-direction:column;}
        #page-analise #anKpis .l{margin-top:0;margin-bottom:7px;}
        #page-analise #anKpis .an-top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}
        #page-analise #anKpis .an-trend{font-size:12.5px;font-weight:700;white-space:nowrap;}
        #page-analise #anKpis .an-trend.up{color:#1b9e4b;}
        #page-analise #anKpis .an-trend.down{color:#c0392b;}
        #page-analise #anKpis .an-spark{margin-top:auto;padding-top:10px;width:100%;}
        #page-analise #anKpis .an-spark svg{width:100%;height:30px;display:block;}
      </style>
      <div class="filtros">
        <div class="campo">
          <label for="anDe">Data inicial</label>
          <input type="date" id="anDe" min="${dataMin}" max="${dataMax}" value="${defaultDe}">
        </div>
        <div class="campo">
          <label for="anAte">Data final</label>
          <input type="date" id="anAte" min="${dataMin}" max="${dataMax}" value="${dataMax}">
        </div>
        <button class="btn-p" id="anAplicar">Pesquisar</button>
        <button class="btn-s" id="anLimpar">Limpar</button>
        <span class="periodo-info" id="anPeriodoInfo"></span>
      </div>
      <div class="kpis" id="anKpis" style="grid-template-columns:repeat(5,1fr);"></div>
      <div class="kpis" id="anIndicadores" style="grid-template-columns:repeat(auto-fit,minmax(205px,1fr));margin-top:6px;"></div>
    </section>

    <section id="page-estoque" class="page">
      <div class="filtros">
        <div class="campo">
          <label for="codE">Código do produto</label>
          <input type="text" id="codE" list="listaCodigos" placeholder="ex: 001" autocomplete="off">
        </div>
        <div class="campo">
          <label for="nomeE">Nome do produto</label>
          <input type="text" id="nomeE" list="listaNomes" placeholder="ex: Arroz" autocomplete="off">
        </div>
        <div class="campo">
          <label for="statusE">Status</label>
          <select id="statusE" style="padding:9px 11px;border:1px solid #cdd6e0;border-radius:8px;font-size:14px;">
            <option value="">Todos</option>
            <option value="OK">OK</option>
            <option value="BAIXO">Baixo</option>
            <option value="RUPTURA">Ruptura</option>
          </select>
        </div>
        <button class="btn-p" id="aplicarE">Pesquisar</button>
        <button class="btn-s" id="limparE">Limpar (tudo)</button>
        <span class="periodo-info" id="estoqueInfo"></span>
      </div>
      <div class="card"><h2>Estoque por produto <small style="color:#8a97a8;font-weight:normal">(situação atual — não depende de data)</small></h2><div id="estoquePage"></div></div>
    </section>

    <section id="page-calendario" class="page">
      <div class="card">
        <div class="cal-top">
          <button class="cal-nav" id="calPrev">‹</button>
          <h2 id="calTitulo" style="margin:0;min-width:230px;text-align:center;font-size:18px;"></h2>
          <button class="cal-nav" id="calNext">›</button>
          <div class="cal-toggle">
            <button class="seg ativo" id="viewMes">Mês</button>
            <button class="seg" id="viewAno">Ano</button>
          </div>
          <div class="cal-toggle">
            <button class="seg ativo" id="modoCamp">Campanhas</button>
            <button class="seg" id="modoOper">Operação</button>
          </div>
          <button class="btn-s" id="calHoje" style="margin-left:auto;">Hoje</button>
        </div>
        <div id="calMesView">
          <div class="cal-grid cal-head">
            <div>DOM</div><div>SEG</div><div>TER</div><div>QUA</div><div>QUI</div><div>SEX</div><div>SÁB</div>
          </div>
          <div class="cal-grid" id="calDias"></div>
        </div>
        <div id="calAnoView" style="display:none;"></div>
        <div class="cal-legenda">
          <span class="leg-item" data-camp="__fechado__"><span class="qd" style="background:#fdecec;border:1px solid #f3c6c6;"></span> Loja fechada (feriado)</span>
          <span class="leg-item" data-camp="__hoje__"><span class="qd" style="background:#157a35;"></span> Hoje</span>
        </div>
        <div class="cal-legenda" id="calLegSetores" style="margin-top:8px;border-top:1px solid #eef1f4;padding-top:10px;"></div>
        <div class="cal-legenda" id="calLegDatas" style="margin-top:8px;border-top:1px solid #eef1f4;padding-top:10px;"></div>
        <div class="cal-legenda" id="calLegUser" style="margin-top:8px;border-top:1px solid #eef1f4;padding-top:10px;display:none;"></div>
      </div>
      <div class="card">
        <details id="ccBox">
          <summary style="cursor:pointer;font-weight:700;color:#0c5a26;font-size:15px;">➕ Adicionar campanha / data comemorativa</summary>
          <p style="margin:10px 0 6px;color:#6b7787;font-size:13px;">Crie suas próprias campanhas (ex: "Quarta do Hortifruti", "Aniversário do Cliente"). Elas aparecem no calendário e na legenda.</p>
          <div class="filtros" style="box-shadow:none;padding:0;flex-wrap:wrap;align-items:flex-start;">
            <div class="campo" style="flex:1;min-width:180px;"><label for="ccNome">Nome da campanha</label><input type="text" id="ccNome" placeholder="ex: Quarta do Hortifruti"></div>
            <div class="campo"><label for="ccCor">Cor</label><input type="color" id="ccCor" value="#157a35" style="width:54px;height:40px;padding:2px;cursor:pointer;"></div>
            <div class="campo"><label for="ccTipo">Quando acontece</label>
              <select id="ccTipo" style="padding:9px 11px;border:1px solid #cdd6e0;border-radius:8px;font-size:14px;">
                <option value="data">Numa data específica</option>
                <option value="semana">Toda semana (dia fixo)</option>
              </select>
            </div>
            <div class="campo" id="ccDataBox"><label for="ccData">Data</label>
              <input type="date" id="ccData">
              <label style="font-size:12px;color:#6b7787;font-weight:400;margin-top:5px;display:flex;align-items:center;gap:5px;"><input type="checkbox" id="ccAnual" style="width:auto;"> repetir todo ano</label>
            </div>
            <div class="campo" id="ccSemanaBox" style="display:none;"><label for="ccDow">Dia da semana</label>
              <select id="ccDow" style="padding:9px 11px;border:1px solid #cdd6e0;border-radius:8px;font-size:14px;">
                <option value="0">Domingo</option><option value="1">Segunda</option><option value="2">Terça</option><option value="3">Quarta</option><option value="4">Quinta</option><option value="5">Sexta</option><option value="6">Sábado</option>
              </select>
            </div>
            <button class="btn-p" id="ccAdd" style="margin-top:18px;">Adicionar</button>
            <span id="ccMsg" style="flex-basis:100%;font-size:12.5px;color:#c0392b;margin-top:6px;display:none;"></span>
          </div>
          <div id="ccLista" style="margin-top:12px;"></div>
        </details>
      </div>
    </section>

    <section id="page-escala" class="page">
      <div id="escHub"></div>
      <div id="escDetalhe" style="display:none">
      <button class="btn-s" id="escVoltar" style="margin-bottom:14px;display:inline-flex;align-items:center;gap:6px;font-weight:600;">‹ Voltar aos setores</button>
      <div class="card">
        <div id="escPrintCab" class="esc-print-cab"><span id="escPrintTitulo"></span><span id="escPrintData"></span></div>
        <div class="esc-top">
          <button class="cal-nav" id="escPrev">‹</button>
          <h2 id="escTitulo" style="margin:0;min-width:200px;text-align:center;font-size:18px;"></h2>
          <button class="cal-nav" id="escNext">›</button>
          <button class="btn-s" id="escHoje">Mês atual</button>
          <button class="btn-s" id="escImprimir" style="margin-left:auto;display:inline-flex;align-items:center;gap:7px;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>Imprimir</button>
        </div>
        <div class="esc-legenda">
          <span><span class="qd cel-t1"></span> T.1</span>
          <span><span class="qd cel-t2"></span> T.2</span>
          <span><span class="qd cel-folga"></span> Folga</span>
          <span><span class="qd" style="background:#e3eefb;border-color:#b9d3f2;"></span> Domingo</span>
          <span style="color:#8a97a8;">A escala é gerada automaticamente e não pode ser editada célula a célula. Para trocar quem ocupa uma vaga (saiu um, entra outro), clique no nome do funcionário — o rodízio da vaga continua o mesmo.</span>
        </div>
        <div id="escGrade"></div>
      </div>
      </div>
    </section>

    <section id="page-pontos" class="page">
      <div class="kpis" id="pxKpis" style="grid-template-columns:repeat(5,1fr);"></div>
      <div id="pxInadimplentes"></div>

      <div class="card">
        <h2 id="pxFormTitulo">Adicionar ponto extra</h2>
        <div class="filtros" style="box-shadow:none;padding:0;flex-wrap:wrap;align-items:flex-start;">
          <div class="campo"><label for="pxNum">Nº do ponto</label><input type="number" id="pxNum" min="1" max="21" style="width:90px;"></div>
          <div class="campo"><label for="pxCnpj">CNPJ (busca o nome)</label>
            <span style="display:inline-flex;gap:6px;align-items:center;">
              <input type="text" id="pxCnpj" placeholder="00.000.000/0000-00" style="width:175px;">
              <button type="button" class="btn-s" id="pxCnpjBuscar">Buscar</button>
            </span>
          </div>
          <div class="campo" style="flex:1;min-width:170px;"><label for="pxForn">Fornecedor</label><input type="text" id="pxForn" placeholder="preenchido pelo CNPJ" readonly style="background:#f3f6fa;color:#46535f;cursor:not-allowed;"><input type="hidden" id="pxRazao"><span id="pxCnpjMsg" style="font-size:11px;display:block;margin-top:4px;line-height:1.25;"></span></div>
          <div class="campo"><label for="pxVend">Vendedor</label><input type="text" id="pxVend" placeholder="ex: Josinaldo"></div>
          <div class="campo"><label for="pxTel">Contato</label><input type="tel" id="pxTel" placeholder="ex: (84) 99999-0000" style="width:160px;"></div>
          <div class="campo"><label for="pxEmail">E-mail (p/ cobrança)</label><input type="email" id="pxEmail" placeholder="ex: financeiro@empresa.com" style="width:230px;"></div>
          <div class="campo" style="flex:1;min-width:200px;"><label for="pxEndereco">Endereço</label><input type="text" id="pxEndereco" placeholder="preenchido pelo CNPJ" readonly style="background:#f3f6fa;color:#46535f;cursor:not-allowed;"></div>
          <div class="campo"><label for="pxValor">Valor (R$)</label><input type="number" id="pxValor" step="0.01" min="0" style="width:120px;"></div>
          <div class="campo"><label for="pxPag">Modo de pagamento</label>
            <input type="text" id="pxPag" list="pxPagList" style="width:150px;" placeholder="Boleto">
            <datalist id="pxPagList"><option value="Boleto"></option><option value="Bonificação"></option><option value="Pix"></option></datalist>
          </div>
          <div class="campo"><label for="pxAbertura">Abertura do contrato</label><input type="date" id="pxAbertura"></div>
          <div class="campo"><label for="pxVenc">Vencimento do contrato</label><input type="date" id="pxVenc"></div>
          <div class="campo" style="flex:1;min-width:180px;"><label for="pxObs">Observação</label><input type="text" id="pxObs" placeholder="ex: Mensalmente todo dia 20"></div>
          <button class="btn-p" id="pxSalvar" style="margin-top:18px;">Adicionar</button>
          <button class="btn-s" id="pxCancelar" style="display:none;margin-top:18px;">Cancelar</button>
        </div>
      </div>

      <div class="card">
        <details id="pixCfgBox">
          <summary class="pix-cfg-sum"><span class="ico">💠</span> Cobrança via Pix — chave do supermercado <span id="pixCfgStatus" class="pix-cfg-st"></span></summary>
          <div class="pix-cfg-grid">
            <div class="campo"><label for="pixChave">Chave Pix</label><input type="text" id="pixChave" placeholder="CPF/CNPJ, e-mail, telefone ou aleatória"></div>
            <div class="campo"><label for="pixNome">Nome do recebedor</label><input type="text" id="pixNome" placeholder="ex: Supermercado Santa Rita" maxlength="25"></div>
          </div>
          <div class="pix-cfg-acoes">
            <button class="btn-p" id="pixSalvarCfg">Salvar chave</button>
            <button class="btn-s" id="pixTravaBtn">Desbloquear (admin)</button>
          </div>
          <p id="pixTravaNota" class="pix-trava-nota"></p>
          <p class="pix-cfg-aviso">Esses dados ficam salvos só neste navegador e são usados para gerar o QR Code e o código copia e cola de cada parcela. O dinheiro cai direto na conta da chave Pix informada — não passa por nenhum sistema externo.</p>
        </details>
      </div>

      <div class="card">
        <div class="esc-top">
          <h2 style="margin:0;">Pontos extras</h2>
          <input type="text" id="pxBusca" placeholder="Buscar fornecedor / vendedor" style="padding:8px 11px;border:1px solid #cdd6e0;border-radius:8px;font-size:14px;min-width:210px;">
          <select id="pxFiltroStatus" class="px-filtro">
            <option value="">Todos os status</option>
            <option value="PAGO">Pago</option>
            <option value="ATRASADO">Atrasado</option>
            <option value="NÃO PAGO">Em aberto</option>
          </select>
          <select id="pxFiltroPagamento" class="px-filtro">
            <option value="">Todos os pagamentos</option>
            <option value="Pix">Pix</option>
            <option value="Boleto">Boleto</option>
            <option value="Bonificação">Bonificação</option>
          </select>
          <select id="pxFiltroVenc" class="px-filtro">
            <option value="">Todos os vencimentos</option>
            <option value="vencidos">Vencidos</option>
            <option value="avencer">A vencer</option>
          </select>
          <span class="periodo-info" id="pxInfo" style="margin-left:auto;"></span>
        </div>
        <div class="esc-scroll"><div id="pxTabela"></div></div>
      </div>
    </section>

    <section id="page-mapa" class="page">
      <style>
        .mapa-legenda{display:flex;gap:8px;flex-wrap:wrap;font-size:12px;align-items:center;}
        .mapa-legenda span{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #e6ebf1;border-radius:20px;padding:4px 11px;color:#56606d;font-weight:600;}
        .mapa-legenda i{width:11px;height:11px;border-radius:50%;display:inline-block;}
        .mapa-wrap{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;margin-top:16px;}
        .mapa-loja{position:relative;background:linear-gradient(160deg,#fbfcfe,#eef2f7);border:1px solid #e2e8f1;border-radius:16px;padding:26px 26px 30px;flex:1;min-width:520px;box-shadow:inset 0 1px 0 #fff,0 1px 3px rgba(20,40,70,.05);}
        .mapa-entrada{display:flex;align-items:center;justify-content:center;gap:8px;margin-bottom:18px;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#90a0b2;}
        .mapa-entrada:before,.mapa-entrada:after{content:"";height:1px;flex:1;background:linear-gradient(90deg,transparent,#d4dde7,transparent);}
        .mapa-espaco{height:30px;}
        .mapa-grupo{display:grid;grid-template-columns:repeat(5,1fr);column-gap:30px;row-gap:16px;margin-bottom:38px;}
        .mapa-gond{display:flex;flex-direction:column;gap:6px;}
        .mapa-cap{position:relative;border:0;cursor:pointer;color:#fff;font-weight:700;font-size:14px;border-radius:8px;padding:10px 0;text-align:center;letter-spacing:.3px;text-shadow:0 1px 1px rgba(0,0,0,.18);box-shadow:0 2px 4px rgba(20,40,70,.12);transition:transform .1s ease,box-shadow .14s ease,filter .14s;}
        .mapa-cap:hover{transform:translateY(-2px);box-shadow:0 6px 14px rgba(20,40,70,.22);filter:brightness(1.04);}
        .mapa-cap.livre{background:linear-gradient(180deg,#aab6c4,#8d9bab);color:#f4f7fb;}
        .mapa-cap.pago{background:linear-gradient(180deg,#23ad57,#15913f);}
        .mapa-cap.naopago{background:linear-gradient(180deg,#d6452f,#b5331f);}
        .mapa-cap.venc{box-shadow:0 0 0 2px #fff,0 0 0 5px #f5901e,0 2px 6px rgba(245,144,30,.45);}
        .mapa-cap.sel{outline:3px solid #157a35;outline-offset:2px;transform:translateY(-2px);box-shadow:0 6px 16px rgba(21,122,53,.3);}
        .mapa-body{background:linear-gradient(180deg,#d7dee7,#c4cdd8);border-radius:8px;display:grid;grid-template-columns:1fr 1fr;gap:7px;padding:9px;box-shadow:inset 0 1px 3px rgba(20,40,70,.12);}
        .mapa-body i{background:linear-gradient(180deg,#eef2f6,#c9d2dc);border-radius:3px;height:30px;display:block;box-shadow:inset 0 -3px 0 rgba(20,40,70,.07);}
        .mapa-detalhe{background:#fff;border:1px solid #e2e8f1;border-radius:16px;padding:0;flex:0 0 300px;min-width:260px;overflow:hidden;box-shadow:0 1px 3px rgba(20,40,70,.06);}
        .mapa-detalhe .det-vazio{padding:24px 20px;color:#7a8794;font-size:14px;line-height:1.5;text-align:center;}
        .mapa-det-head{padding:16px 18px;color:#fff;background:linear-gradient(135deg,#157a35,#1b9e4b);}
        .mapa-det-head.off{background:linear-gradient(135deg,#c0392b,#d6452f);}
        .mapa-det-head.free{background:linear-gradient(135deg,#8d9bab,#aab6c4);}
        .mapa-det-head .pnum{font-size:12px;font-weight:600;opacity:.85;letter-spacing:.5px;text-transform:uppercase;}
        .mapa-det-head .pforn{font-size:19px;font-weight:800;margin-top:2px;line-height:1.15;}
        .mapa-det-badge{display:inline-flex;align-items:center;gap:5px;margin-top:9px;background:rgba(255,255,255,.22);border-radius:20px;padding:3px 11px;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;}
        .mapa-det-badge + .mapa-det-badge{margin-left:7px;}
        .mapa-det-body{padding:6px 18px 16px;}
        .mapa-detalhe .lin{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #f0f3f7;font-size:14px;}
        .mapa-detalhe .lin:last-child{border-bottom:0;}
        .mapa-detalhe .lin b{color:#33404f;font-weight:600;}
        .mapa-detalhe .lin span{color:#5a6678;text-align:right;}
        .mapa-cfg{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #d7dee7;border-radius:9px;padding:6px 12px;font-size:12.5px;font-weight:600;color:#56606d;cursor:pointer;transition:background .14s,border-color .14s,color .14s;}
        .mapa-cfg:hover{background:#f4f7fb;border-color:#c2cdda;}
        .mapa-cfg svg{width:15px;height:15px;}
        .mapa-cfg.ativo{background:#157a35;border-color:#157a35;color:#fff;}
        .mapa-val-edit{display:flex;align-items:center;gap:6px;}
        .mapa-val-edit input{width:108px;border:1px solid #c2cdda;border-radius:7px;padding:5px 8px;font-size:13px;text-align:right;color:#1d2733;}
        .mapa-val-edit input:focus{outline:none;border-color:#157a35;box-shadow:0 0 0 2px rgba(21,122,53,.15);}
        .mapa-val-edit button{border:0;background:#157a35;color:#fff;font-weight:700;font-size:12px;border-radius:7px;padding:6px 10px;cursor:pointer;}
        .mapa-val-edit button:hover{background:#12692e;}
        .mapa-detalhe .lin.editando{background:#f6fbf7;margin:0 -18px;padding:9px 18px;}
        @media (max-width:860px){ .mapa-loja{min-width:0;} }
      </style>
      <div class="card">
        <div class="esc-top">
          <h2 style="margin:0;">Mapa dos pontos de gôndola</h2>
          <div class="mapa-legenda">
            <span><i style="background:#c0392b"></i> Não pago</span>
            <span><i style="background:#1b9e4b"></i> Pago</span>
            <span><i style="background:#9aa7b5"></i> Livre</span>
            <span><i style="background:#f5901e"></i> Vencendo/vencido</span>
          </div>
          <span class="periodo-info" id="mapaInfo" style="margin-left:auto;"></span>
          <button class="mapa-cfg" id="mapaCfgBtn" type="button" title="Editar preços (somente administrador)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            <span id="mapaCfgLbl">Editar preços</span>
          </button>
        </div>
        <div class="mapa-wrap">
          <div class="mapa-loja" id="mapaLoja"></div>
          <div class="mapa-detalhe" id="mapaDetalhe"><div class="det-vazio">Clique em um ponto no mapa pra ver os detalhes do fornecedor.</div></div>
        </div>
      </div>
    </section>

    <section id="page-organograma" class="page">
      <style>
        .org-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:center;margin-bottom:14px;}
        .org-toolbar .grp{display:flex;gap:7px;align-items:center;background:#f4f7fb;border:1px solid #e2e8f1;border-radius:9px;padding:6px 10px;}
        .org-swatch{width:20px;height:20px;border-radius:5px;border:2px solid #fff;box-shadow:0 0 0 1px #cdd6e0;cursor:pointer;padding:0;}
        .org-swatch.sel{box-shadow:0 0 0 2px #157a35;}
        .org-conectar.on{background:#157a35;color:#fff;border-color:#157a35;}
        .org-tabs{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px;}
        .org-tab{display:inline-flex;align-items:center;gap:6px;background:#eef2f7;border:1px solid #dce3ec;color:#3a4756;border-radius:9px 9px 0 0;padding:8px 12px;font-size:13px;font-weight:600;cursor:pointer;}
        .org-tab.on{background:#157a35;border-color:#157a35;color:#fff;}
        .org-tab .org-tab-x{font-size:12px;opacity:.7;border-radius:50%;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;}
        .org-tab .org-tab-x:hover{background:rgba(0,0,0,.15);opacity:1;}
        .org-tab-add{background:#fff;border:1px dashed #b7c2d0;color:#157a35;border-radius:9px;padding:8px 12px;font-size:13px;font-weight:700;cursor:pointer;}
        .org-tab-input{border:none;outline:none;background:rgba(255,255,255,.92);color:#1a2330;border-radius:5px;padding:2px 6px;font-size:13px;font-weight:600;width:110px;}
        #page-organograma .card{min-width:0;}
        .org-stage{position:relative;}
        .org-canvas{position:relative;background:#f4f7fb;border:1px solid #e2e8f1;border-radius:12px;height:740px;overflow:hidden;cursor:crosshair;}
        .org-inner{position:relative;width:1800px;height:1100px;transform-origin:0 0;}
        .org-svg{position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;pointer-events:none;}
        .org-svg .hit{stroke:transparent;stroke-width:16px;fill:none;pointer-events:stroke;cursor:pointer;}
        .org-svg .org-eh{fill:#fff;stroke:#157a35;stroke-width:2.5;pointer-events:all;cursor:grab;}
        .org-svg .org-ehmid{fill:#5b7cff;stroke:#fff;stroke-width:1.5;pointer-events:all;cursor:grab;}
        .org-node{position:absolute;width:150px;min-height:46px;display:flex;align-items:center;justify-content:center;cursor:grab;box-sizing:border-box;}
        .org-node.dec{width:172px;min-height:96px;}
        .org-shape{position:absolute;inset:0;border-radius:10px;box-shadow:0 2px 6px rgba(0,0,0,.16);}
        .org-node.fim .org-shape{border-radius:999px;}
        .org-node.dec .org-shape{border-radius:0;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);}
        .org-node.sel{transform:scale(1.04);}
        .org-node.sel .org-shape{box-shadow:0 0 0 3px #157a35,0 2px 6px rgba(0,0,0,.16);}
        .org-node.src .org-shape{box-shadow:0 0 0 3px #e8820e,0 2px 6px rgba(0,0,0,.16);}
        .org-stack{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;padding:7px 12px;width:100%;}
        .org-txt{color:#fff;font-weight:700;font-size:13px;text-align:center;word-break:break-word;line-height:1.15;letter-spacing:.2px;}
        .org-sub{color:#fff;font-weight:400;font-size:11.5px;opacity:.92;text-align:center;word-break:break-word;line-height:1.15;}
        .org-sub:empty::before{content:"＋ nome";opacity:.5;font-style:italic;font-size:11px;}
        .org-del{position:absolute;z-index:3;top:-8px;right:-8px;width:20px;height:20px;border-radius:50%;background:#fff;color:#c0392b;border:1px solid #cdd6e0;font-size:13px;line-height:1;cursor:pointer;display:none;align-items:center;justify-content:center;padding:0;}
        .org-node:hover .org-del{display:flex;}
        .org-handle{position:absolute;z-index:4;width:13px;height:13px;border-radius:50%;background:#fff;color:#157a35;border:2px solid #157a35;box-shadow:0 1px 2px rgba(0,0,0,.25);font-size:9px;font-weight:700;line-height:1;cursor:crosshair;display:none;align-items:center;justify-content:center;padding:0;transition:transform .08s;}
        .org-node.sel .org-handle{display:flex;}
        .org-mq{position:absolute;z-index:5;border:1.5px solid #157a35;background:rgba(21,122,53,.12);pointer-events:none;border-radius:4px;}
        .org-node.linktarget .org-shape{outline:3px solid #157a35;outline-offset:2px;}
        .org-handle:hover{background:#157a35;color:#fff;transform:scale(1.45);}
        .org-handle.t{top:-7px;left:50%;margin-left:-7px;}
        .org-handle.b{bottom:-7px;left:50%;margin-left:-7px;}
        .org-handle.l{left:-7px;top:50%;margin-top:-7px;}
        .org-handle.r{right:-7px;top:50%;margin-top:-7px;}
        .org-hint{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#8a97a6;font-size:14px;text-align:center;pointer-events:none;line-height:1.6;width:90%;}
        .org-geral-msg{display:none;background:#eef6f0;border:1px solid #cfe6d6;color:#1c5a32;font-size:13px;border-radius:9px;padding:9px 13px;margin-bottom:10px;}
        .org-inner.org-ro .org-node{cursor:default;}
  .org-inner.org-ro .org-node.org-gedit{cursor:text;}
  .org-inner.org-ro .org-node.org-gedit .org-shape{outline:2px dashed rgba(255,255,255,.55);outline-offset:-4px;}
  .org-node.org-gedit .org-txt,.org-node.org-gedit .org-sub{cursor:text;}
  .org-node.org-ctx{cursor:default;opacity:.92;}
  .org-node.org-ctx .org-del,.org-node.org-ctx .org-handle{display:none!important;}
        #orgCard:fullscreen{background:#fff;overflow:auto;padding:18px 22px;}
        #orgCard:fullscreen .org-canvas{height:calc(100vh - 210px);}
      </style>
      <div class="card" id="orgCard">
        <div class="org-toolbar">
          <button class="btn-p" id="orgAdd">＋ Adicionar caixa</button>
          <div class="grp" id="orgCores"><label style="font-size:12px;color:#5a6678;">Cor</label></div>
          <div class="grp"><button class="btn-s" id="orgZoomOut" title="Afastar" style="min-width:30px;">−</button><span id="orgZoomLbl" style="font-size:12px;color:#5a6678;min-width:38px;text-align:center;display:inline-block;">100%</span><button class="btn-s" id="orgZoomIn" title="Aproximar" style="min-width:30px;">＋</button><button class="btn-s" id="orgFit" title="Mostrar tudo na tela">⤢ Ver tudo</button></div>
          <button class="btn-s" id="orgExemplo">Exemplo pronto</button>
          <button class="btn-s" id="orgFull">⛶ Tela cheia</button>
          <button class="btn-s" id="orgLimpar">Limpar tudo</button>
        </div>
        <div class="org-tabs" id="orgTabs"></div>
        <div class="org-geral-msg" id="orgGeralMsg">📊 Esta é a visão <b>Geral</b> — montada automaticamente a partir dos setores. Para editar, abra a aba de um setor.</div>
        <div class="org-stage">
          <div class="org-canvas"><div class="org-inner" id="orgInner"></div></div>
          <div class="org-hint" id="orgHint">Clique em <b>＋ Adicionar caixa</b> para começar.<br>Arraste pra mover · duplo-clique renomeia.</div>
        </div>
        <p style="margin:10px 2px 0;color:#8a97a6;font-size:12.5px;">Dica: arraste as caixas pra posicionar · duplo-clique pra renomear · clique numa seta pra removê-la.</p>
      </div>
    </section>

    <section id="page-fluxograma" class="page">
      <style>
        .flux-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px;}
        .flux-toolbar .grp{display:flex;gap:7px;align-items:center;background:#f4f7fb;border:1px solid #e2e8f1;border-radius:9px;padding:6px 10px;}
        .flux-swatch{width:20px;height:20px;border-radius:5px;border:2px solid #fff;box-shadow:0 0 0 1px #cdd6e0;cursor:pointer;padding:0;}
        .flux-swatch.sel{box-shadow:0 0 0 2px #157a35;}
        .flux-conectar.on{background:#157a35;color:#fff;border-color:#157a35;}
        #page-fluxograma .card{min-width:0;}
        .flux-stage{position:relative;}
        .flux-canvas{position:relative;background:#f4f7fb;border:1px solid #e2e8f1;border-radius:12px;height:600px;overflow:hidden;cursor:crosshair;}
        .flux-inner{position:relative;width:1800px;height:1100px;transform-origin:0 0;}
        .flux-svg{position:absolute;top:0;left:0;width:1800px;height:1100px;pointer-events:none;}
        .flux-svg .hit{stroke:transparent;stroke-width:16px;fill:none;pointer-events:stroke;cursor:pointer;}
        .flux-svg .flux-eh{fill:#fff;stroke:#157a35;stroke-width:2.5;pointer-events:all;cursor:grab;}
        .flux-svg .flux-ehmid{fill:#5b7cff;stroke:#fff;stroke-width:1.5;pointer-events:all;cursor:grab;}
        .flux-node{position:absolute;width:150px;min-height:46px;display:flex;align-items:center;justify-content:center;cursor:grab;box-sizing:border-box;}
        .flux-node.dec{width:172px;min-height:96px;}
        .flux-shape{position:absolute;inset:0;border-radius:10px;box-shadow:0 2px 6px rgba(0,0,0,.16);}
        .flux-node.fim .flux-shape{border-radius:999px;}
        .flux-node.dec .flux-shape{border-radius:0;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%);}
        .flux-node.io .flux-shape{border-radius:0;clip-path:polygon(16% 0,100% 0,84% 100%,0 100%);}
        .flux-node.sel{transform:scale(1.04);}
        .flux-node.sel .flux-shape{box-shadow:0 0 0 3px #157a35,0 2px 6px rgba(0,0,0,.16);}
        .flux-node.src .flux-shape{box-shadow:0 0 0 3px #e8820e,0 2px 6px rgba(0,0,0,.16);}
        .flux-txt{position:relative;z-index:2;color:#fff;font-weight:600;font-size:13px;text-align:center;padding:8px 12px;word-break:break-word;}
        .flux-del{position:absolute;z-index:3;top:-8px;right:-8px;width:20px;height:20px;border-radius:50%;background:#fff;color:#c0392b;border:1px solid #cdd6e0;font-size:13px;line-height:1;cursor:pointer;display:none;align-items:center;justify-content:center;padding:0;}
        .flux-node:hover .flux-del{display:flex;}
        .flux-handle{position:absolute;z-index:4;width:13px;height:13px;border-radius:50%;background:#fff;color:#157a35;border:2px solid #157a35;box-shadow:0 1px 2px rgba(0,0,0,.25);font-size:9px;font-weight:700;line-height:1;cursor:crosshair;display:none;align-items:center;justify-content:center;padding:0;transition:transform .08s;}
        .flux-node.sel .flux-handle{display:flex;}
        .flux-mq{position:absolute;z-index:5;border:1.5px solid #157a35;background:rgba(21,122,53,.12);pointer-events:none;border-radius:4px;}
        .flux-node.linktarget .flux-shape{outline:3px solid #157a35;outline-offset:2px;}
        .flux-handle:hover{background:#157a35;color:#fff;transform:scale(1.45);}
        .flux-handle.t{top:-7px;left:50%;margin-left:-7px;}
        .flux-handle.b{bottom:-7px;left:50%;margin-left:-7px;}
        .flux-handle.l{left:-7px;top:50%;margin-top:-7px;}
        .flux-handle.r{right:-7px;top:50%;margin-top:-7px;}
        .flux-hint{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#8a97a6;font-size:14px;text-align:center;pointer-events:none;line-height:1.6;width:90%;}
      </style>
      <div class="card">
        <div class="flux-toolbar">
          <button class="btn-p" id="fluxAdd">＋ Adicionar etapa</button>
          <div class="grp">
            <label style="font-size:12px;color:#5a6678;">Forma</label>
            <select id="fluxForma" style="padding:7px 9px;border:1px solid #cdd6e0;border-radius:8px;font-size:13px;">
              <option value="fim">Início / Fim</option>
              <option value="ret">Processo (retângulo)</option>
              <option value="dec">Decisão (losango)</option>
              <option value="io">Entrada / Saída</option>
            </select>
          </div>
          <div class="grp" id="fluxCores"><label style="font-size:12px;color:#5a6678;">Cor</label></div>
          <div class="grp"><button class="btn-s" id="fluxZoomOut" title="Afastar" style="min-width:30px;">−</button><span id="fluxZoomLbl" style="font-size:12px;color:#5a6678;min-width:38px;text-align:center;display:inline-block;">100%</span><button class="btn-s" id="fluxZoomIn" title="Aproximar" style="min-width:30px;">＋</button></div>
          <button class="btn-s flux-conectar" id="fluxConectar">🔗 Conectar</button>
          <button class="btn-s" id="fluxExemplo">Exemplo pronto</button>
          <button class="btn-s" id="fluxLimpar" style="margin-left:auto;">Limpar tudo</button>
        </div>
        <div class="flux-stage">
          <div class="flux-canvas"><div class="flux-inner" id="fluxInner"></div></div>
          <div class="flux-hint" id="fluxHint">Clique em <b>＋ Adicionar etapa</b> para começar — ou em <b>Exemplo pronto</b>.<br>Arraste pra mover · duplo-clique renomeia · use <b>Conectar</b> pra ligar com setas.</div>
        </div>
        <p style="margin:10px 2px 0;color:#8a97a6;font-size:12.5px;">Dica: comece e termine com <b>Início / Fim</b>, use <b>Processo</b> para as ações, <b>Decisão</b> para perguntas (sim/não) e <b>Entrada / Saída</b> para dados. Clique em <b>Conectar</b> e depois em duas etapas pra ligá-las com seta.</p>
      </div>
    </section>

    <section id="page-layout" class="page">
      <style>
        .lay-subtabs{display:flex;gap:8px;margin-bottom:16px;border-bottom:2px solid #eef2f6;}
        .lay-subtab{border:0;background:none;padding:9px 16px;font-size:14px;font-weight:600;color:#7a8696;cursor:pointer;border-bottom:3px solid transparent;margin-bottom:-2px;}
        .lay-subtab:hover{color:#157a35;}
        .lay-subtab.on{color:#0c5a26;border-bottom-color:#157a35;}
        .lay-toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px;}
        .lay-toolbar .grp{display:flex;gap:7px;align-items:center;flex-wrap:wrap;background:#f4f7fb;border:1px solid #e2e8f1;border-radius:9px;padding:6px 10px;}
        .lay-toolbar .btn-p{font-size:12.5px;padding:7px 12px;}
        .lay-swatch{width:20px;height:20px;border-radius:5px;border:2px solid #fff;box-shadow:0 0 0 1px #cdd6e0;cursor:pointer;padding:0;}
        .lay-swatch.sel{box-shadow:0 0 0 2px #157a35;}
        .lay-canvas{position:relative;background:#f4f7fb;background-image:linear-gradient(#e7edf4 1px,transparent 1px),linear-gradient(90deg,#e7edf4 1px,transparent 1px);background-size:28px 28px;border:1px solid #e2e8f1;border-radius:12px;height:640px;overflow:hidden;cursor:crosshair;}
        .lay-inner{position:relative;width:1400px;height:800px;transform-origin:0 0;}
        .lay-bloco{position:absolute;border-radius:8px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:12.5px;font-weight:700;box-shadow:0 1px 3px rgba(20,40,70,.18);box-sizing:border-box;z-index:2;user-select:none;overflow:hidden;padding:4px 6px;}
        .lay-bloco.area{z-index:1;font-weight:800;align-items:flex-start;justify-content:flex-start;border:2px dashed rgba(80,110,150,.45);box-shadow:none;text-transform:uppercase;letter-spacing:.5px;font-size:12px;}
        .lay-bloco.sel{outline:2.5px solid #1f6dd6;outline-offset:1px;}
        .lay-txt{pointer-events:auto;outline:none;max-width:100%;overflow:hidden;text-overflow:ellipsis;}
        .lay-bloco.area .lay-txt{padding:3px 5px;}
        .lay-h{position:absolute;right:-1px;bottom:-1px;width:14px;height:14px;background:#1f6dd6;border:2px solid #fff;border-radius:3px;cursor:nwse-resize;z-index:3;display:none;}
        .lay-bloco.sel .lay-h{display:block;}
        .lay-hint{font-size:12.5px;color:#8a97a8;margin:10px 2px 0;}
        .lay-plano-head{display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap;}
        .lay-plano-nome{border:1px solid #d4dde6;border-radius:8px;padding:8px 11px;font:inherit;font-weight:700;color:#0c5a26;min-width:200px;}
        .lay-plano-nome:focus{outline:none;border-color:#157a35;box-shadow:0 0 0 2px rgba(21,122,53,.15);}
        .lay-ptab{border:1px solid #d7dee7;background:#fff;border-radius:8px;padding:7px 13px;font-size:13px;font-weight:600;color:#56606d;cursor:pointer;}
        .lay-ptab.on{background:#157a35;border-color:#157a35;color:#fff;}
        .lay-gondola{border:2px solid #b9846b;border-radius:10px;background:#f3e9e2;padding:10px;display:flex;flex-direction:column;gap:8px;}
        .lay-prat{background:#fff;border:1px solid #e6d6ca;border-radius:8px;padding:8px 10px;}
        .lay-prat-lbl{font-size:11px;font-weight:700;color:#9a7b66;text-transform:uppercase;letter-spacing:.4px;margin-bottom:6px;}
        .lay-prat-itens{display:flex;gap:7px;align-items:center;flex-wrap:wrap;}
        .lay-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:20px;font-size:12.5px;font-weight:600;}
        .lay-chip b{cursor:pointer;font-size:13px;opacity:.7;}
        .lay-chip b:hover{opacity:1;}
        .lay-prat-add{border:1px dashed #cbb6a6;border-radius:20px;padding:5px 12px;font:inherit;font-size:12.5px;min-width:120px;background:#fffdfb;}
        .lay-prat-add:focus{outline:none;border-color:#157a35;border-style:solid;}
        .lay-prat-del{border:0;background:none;cursor:pointer;font-size:14px;margin-left:auto;opacity:.5;}
        .lay-prat-del:hover{opacity:1;}
        #layCard:fullscreen{background:#fff;overflow:auto;padding:18px 22px;}
        #layCard:fullscreen .lay-canvas{height:calc(100vh - 200px);}
      </style>
      <div class="card" id="layCard">
        <div class="lay-subtabs">
          <button class="lay-subtab on" data-sub="planta" type="button">🏬 Planta da loja</button>
          <button class="lay-subtab" data-sub="plano" type="button">🧺 Planograma</button>
        </div>
        <div id="laySubPlanta">
          <div class="lay-toolbar">
            <div class="grp">
              <button class="btn-p" data-add="gondola" type="button">＋ Gôndola</button>
              <button class="btn-p" data-add="setor" type="button">＋ Setor/Área</button>
              <button class="btn-p" data-add="caixa" type="button">＋ Caixa</button>
              <button class="btn-p" data-add="entrada" type="button">＋ Entrada</button>
              <button class="btn-p" data-add="camara" type="button">＋ Câmara fria</button>
              <button class="btn-p" data-add="parede" type="button">＋ Parede</button>
            </div>
            <div class="grp" id="layCores"></div>
            <div class="grp"><button class="btn-s" id="layZoomOut" title="Afastar" style="min-width:30px;">−</button><span id="layZoomLbl" style="font-size:12px;color:#5a6678;min-width:38px;text-align:center;display:inline-block;">100%</span><button class="btn-s" id="layZoomIn" title="Aproximar" style="min-width:30px;">＋</button><button class="btn-s" id="layFit" title="Mostrar tudo">⤢ Ver tudo</button></div>
            <button class="btn-s" id="layFull" type="button">⛶ Tela cheia</button>
            <button class="btn-s" id="layLimpar" type="button">Limpar</button>
          </div>
          <div class="lay-canvas" id="layCanvasWrap"><div class="lay-inner" id="layInner"></div></div>
          <p class="lay-hint">Clique em ＋ para criar · arraste pra mover · alça azul no canto pra redimensionar · duplo-clique renomeia · clique e tecla Delete apaga · botão direito do mouse arrasta a tela · pinça (dois dedos) dá zoom.</p>
        </div>
        <div id="laySubPlano" style="display:none;">
          <div class="lay-toolbar">
            <div class="grp" id="layPlanoTabs"></div>
            <button class="btn-p" id="layPlanoAddG" type="button">＋ Nova gôndola</button>
          </div>
          <div id="layPlanoArea"></div>
          <p class="lay-hint">Cada faixa é uma prateleira (a de cima é a Prateleira 1). Digite o produto e aperte Enter para adicionar. Clique no ✕ pra tirar.</p>
        </div>
      </div>
    </section>

    <section id="page-perdas" class="page">
      <style>
        .prd-top{display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;}
        .prd-nav{display:inline-flex;align-items:center;gap:4px;}
        .prd-nav button{width:30px;height:30px;border:1px solid #d7dee7;background:#fff;border-radius:8px;cursor:pointer;font-size:16px;color:#46535f;line-height:1;}
        .prd-nav button:hover{background:#f4f7fb;}
        .prd-titulo{font-size:17px;font-weight:700;color:#0c5a26;min-width:150px;text-align:center;}
        .prd-btn{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #d7dee7;border-radius:9px;padding:7px 13px;font-size:13px;font-weight:600;color:#56606d;cursor:pointer;}
        .prd-btn:hover{background:#f4f7fb;}
        .prd-btn.ativo{background:#157a35;border-color:#157a35;color:#fff;}
        #prdKpis .kpi{padding:18px 16px;min-width:0;overflow:hidden;}
        #prdKpis .kpi .v{font-size:23px;line-height:1.1;overflow-wrap:anywhere;}
        #prdKpis .kpi .l{font-size:12px;margin-top:6px;overflow-wrap:anywhere;}
        .prd-form{border:1px solid #e6ebf1;border-radius:10px;padding:14px 16px;margin:6px 0 18px;background:#fafcfe;}
        .prd-form h4{margin:0 0 12px;font-size:13px;color:#0c5a26;}
        .prd-grid{display:grid;grid-template-columns:130px 1.4fr 1fr 1fr .8fr 1fr auto;gap:8px;align-items:end;}
        @media (max-width:900px){ .prd-grid{grid-template-columns:1fr 1fr;} }
        .prd-fld{display:flex;flex-direction:column;gap:3px;min-width:0;}
        .prd-fld label{font-size:11px;color:#7a8696;font-weight:600;text-transform:uppercase;letter-spacing:.3px;}
        .prd-fld input,.prd-fld select{border:1px solid #d4dde6;border-radius:7px;padding:7px 9px;font:inherit;color:#1d2733;background:#fff;width:100%;box-sizing:border-box;}
        .prd-fld input:focus,.prd-fld select:focus{outline:none;border-color:#157a35;box-shadow:0 0 0 2px rgba(21,122,53,.15);}
        .prd-add{border:0;background:#157a35;color:#fff;border-radius:8px;padding:9px 16px;font-size:13px;font-weight:700;cursor:pointer;height:36px;white-space:nowrap;}
        .prd-add:hover{background:#0c5a26;}
        .prd-lista-wrap{overflow-x:auto;max-width:100%;border:1px solid #e6ebf1;border-radius:10px;margin-top:14px;}
        table.prd-lista{border-collapse:collapse;font-size:12.5px;width:100%;white-space:nowrap;}
        table.prd-lista th,table.prd-lista td{border:1px solid #eef2f6;padding:7px 9px;text-align:left;}
        table.prd-lista th{background:#f3f6fa;color:#46546a;font-weight:700;}
        table.prd-lista td.r{text-align:right;}
        table.prd-lista td.val{text-align:right;font-weight:700;color:#c0392b;}
        table.prd-lista tr:hover td{background:#fafcff;}
        .prd-tag{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;}
        .prd-rm{border:0;background:#fdecec;color:#c0392b;border-radius:6px;width:26px;height:26px;font-size:14px;font-weight:700;cursor:pointer;}
        .prd-rm:hover{background:#f7d4d4;}
        .prd-origem{font-size:10px;color:#8a97a8;}
        .prd-graf{background:#fff;border:1px solid #e6ebf1;border-radius:12px;padding:16px 18px;margin-bottom:16px;box-shadow:0 1px 3px rgba(20,40,70,.05);}
        .prd-graf h3{margin:0 0 14px;font-size:14px;font-weight:800;color:#0c5a26;text-transform:uppercase;letter-spacing:.6px;}
        .prd-graf2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
        @media (max-width:820px){ .prd-graf2{grid-template-columns:1fr;} }
        .prd-vazio{padding:36px 20px;text-align:center;color:#8a97a8;font-size:14px;}
        #prdGraficos,#prdEditWrap{min-width:0;}
      </style>
      <div class="card">
        <div class="prd-top">
          <div class="prd-nav"><button id="prdPrev" type="button">‹</button><button id="prdNext" type="button">›</button></div>
          <div class="prd-titulo" id="prdTitulo"></div>
          <button class="prd-btn" id="prdHoje" type="button">Hoje</button>
          <button class="prd-btn" id="prdEditar" type="button" style="margin-left:auto;">＋ Lançar perda</button>
        </div>
        <div class="kpis" id="prdKpis" style="grid-template-columns:repeat(6,minmax(0,1fr));margin-bottom:22px;"></div>
        <div id="prdEditWrap" style="display:none;"></div>
        <div id="prdGraficos"></div>
      </div>
    </section>

    <section id="page-acougue" class="page">
      <style>
        .aco-mapa{display:flex;gap:22px;flex-wrap:wrap;align-items:flex-start;}
        .aco-boi{flex:1;min-width:300px;max-width:580px;width:100%;height:auto;border:1px solid #e6ebf1;border-radius:12px;background:#fff;padding:10px;box-sizing:border-box;}
        .aco-chips{flex:1;min-width:260px;display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:8px;align-content:start;}
        .aco-chip{background:#fff;border:1px solid #e6ebf1;border-radius:9px;padding:8px 11px;cursor:pointer;transition:.12s;display:flex;flex-direction:column;gap:2px;}
        .aco-chip:hover{border-color:#157a35;box-shadow:0 2px 9px rgba(21,122,53,.13);transform:translateY(-1px);}
        .aco-chip .nm{font-size:13px;font-weight:700;color:#1a2233;}
        .aco-chip .pp{font-size:11.5px;color:#8a97a8;}
        .des-top{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;max-width:520px;}
        .des-tbwrap{overflow-x:auto;border:1px solid #e6ebf1;border-radius:10px;margin-bottom:16px;}
        table.des{border-collapse:collapse;width:100%;font-size:13px;min-width:600px;}
        table.des th,table.des td{border:1px solid #eef2f6;padding:6px 9px;text-align:right;white-space:nowrap;}
        table.des th{background:#f3f6fa;color:#46546a;font-weight:700;font-size:11.5px;}
        table.des th:first-child,table.des td:first-child{text-align:left;font-weight:600;color:#1a2233;}
        table.des input{width:88px;border:1px solid #d4dde6;border-radius:6px;padding:5px 7px;font:inherit;text-align:right;}
        table.des input:focus{outline:none;border-color:#157a35;box-shadow:0 0 0 2px rgba(21,122,53,.15);}
        table.des tr.osso td{background:#fbf3ec;color:#9a5a2b;font-weight:700;}
        .des-pos{color:#1b9e4b;font-weight:700;}.des-neg{color:#c0392b;font-weight:700;}
        .des-sum .kpi{padding:14px 16px;}.des-sum .kpi .v{font-size:19px;}
        .uf{position:relative;display:block;}
        .uf-sfx > input{padding-right:38px !important;}
        .uf-pfx > input{padding-left:36px !important;}
        .uf .sfx{position:absolute;right:12px;top:50%;transform:translateY(-50%);font-size:13px;color:#7a8696;font-weight:700;pointer-events:none;}
        .uf .pfx{position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:13px;color:#7a8696;font-weight:700;pointer-events:none;}
      </style>
      <div class="card" style="margin-bottom:18px;">
        <h2 style="margin:0 0 3px;font-size:18px;color:#0c5a26;">Mapa dos cortes do boi</h2>
        <p style="margin:0 0 16px;font-size:13px;color:#6b7787;">Clique numa peça pra já lançar a perda dela. Os % de perda são valores de referência — depois a gente ajusta pro seu açougue.</p>
        <div class="aco-mapa">
          <img class="aco-boi" id="acoBoiImg" alt="Mapa dos cortes do boi">
          <div class="aco-chips" id="acoChips"></div>
        </div>
      </div>
      <div class="card" id="desCard" style="margin-bottom:18px;">
        <h2 style="margin:0 0 3px;font-size:18px;color:#0c5a26;">Desossa / Rendimento do boi</h2>
        <p style="margin:0 0 16px;font-size:13px;color:#6b7787;">Lance o peso e o custo do boi e quanto saiu de cada corte. O sistema calcula o rendimento, a perda no osso e o <b>custo real do kg</b> — e o lucro de cada corte pelo preço de venda que você puser.</p>
        <div class="des-top">
          <div class="prd-fld"><label>Peso total do boi</label><span class="uf uf-sfx"><input id="desPeso" type="text" inputmode="decimal" placeholder="Ex: 250"><span class="sfx">kg</span></span></div>
          <div class="prd-fld"><label>Custo total do boi</label><span class="uf uf-pfx"><span class="pfx">R$</span><input id="desCusto" type="text" inputmode="decimal" placeholder="Ex: 5.000,00"></span></div>
        </div>
        <div class="des-tbwrap"><table class="des"><thead><tr><th>Corte</th><th>Saiu (kg)</th><th>Preço venda (R$/kg)</th><th>Custo real (R$/kg)</th><th>Lucro/kg</th><th>Lucro total</th></tr></thead><tbody id="desBody"></tbody><tfoot id="desFoot"></tfoot></table></div>
        <div class="kpis des-sum" id="desResumo" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:14px;"></div>
        <button class="prd-add" id="desSalvar" type="button" style="height:auto;padding:10px 18px;">Salvar esta desossa</button>
        <div id="desHist" style="margin-top:18px;"></div>
      </div>
      <div class="card">
        <div class="prd-top">
          <div class="prd-nav"><button id="acoPrev" type="button">‹</button><button id="acoNext" type="button">›</button></div>
          <div class="prd-titulo" id="acoTitulo"></div>
          <button class="prd-btn" id="acoHoje" type="button">Hoje</button>
          <button class="prd-btn" id="acoEditar" type="button" style="margin-left:auto;">＋ Lançar perda</button>
        </div>
        <div class="kpis" id="acoKpis" style="grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:22px;"></div>
        <div id="acoEditWrap" style="display:none;"></div>
        <div id="acoGraficos"></div>
      </div>
    </section>

    <section id="page-metas" class="page">
      <div class="em-breve"><div class="big">🎯</div><h2>Metas</h2>
        <p>Aqui você vai definir metas de faturamento (diária/mensal) e acompanhar o quanto já bateu — com semáforo de quem está atingindo. Em breve.</p></div>
    </section>

    <section id="page-entregas" class="page">
      <style>
        .ent-top{display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap;}
        .ent-nav{display:inline-flex;align-items:center;gap:4px;}
        .ent-nav button{width:30px;height:30px;border:1px solid #d7dee7;background:#fff;border-radius:8px;cursor:pointer;font-size:16px;color:#46535f;line-height:1;}
        .ent-nav button:hover{background:#f4f7fb;}
        .ent-titulo{font-size:17px;font-weight:700;color:#0c5a26;min-width:150px;text-align:center;}
        .ent-btn{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #d7dee7;border-radius:9px;padding:7px 13px;font-size:13px;font-weight:600;color:#56606d;cursor:pointer;}
        .ent-btn:hover{background:#f4f7fb;}
        .ent-btn.ativo{background:#157a35;border-color:#157a35;color:#fff;}
        #entKpis .kpi{padding:20px 16px;min-width:0;overflow:hidden;}
        #entKpis .kpi .v{font-size:26px;line-height:1.1;overflow-wrap:anywhere;}
        #entKpis .kpi .l{font-size:12.5px;margin-top:6px;overflow-wrap:anywhere;}
        .ent-grade-wrap{overflow-x:auto;max-width:100%;border:1px solid #e6ebf1;border-radius:10px;margin:6px 0 22px;}
        .ent-edit-box{border:1px solid #e6ebf1;border-radius:10px;padding:12px 14px;margin:6px 0 14px;background:#fafcfe;}
        .ent-edit-tit{display:flex;align-items:center;justify-content:space-between;gap:10px;}
        .ent-edit-tit b{font-size:13px;color:#0c5a26;}
        .ent-edit-toggle{border:1px solid #cfe0d6;background:#fff;color:#157a35;border-radius:7px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;}
        .ent-edit-toggle:hover{background:#e3f0e8;}
        .ent-edit-body{margin-top:12px;}
        .ent-edit-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
        .ent-edit-row input{flex:1;max-width:280px;border:1px solid #d4dde6;border-radius:7px;padding:6px 10px;font:inherit;color:#1d2733;}
        .ent-edit-row input:focus{outline:none;border-color:#157a35;box-shadow:0 0 0 2px rgba(21,122,53,.15);}
        .ent-edit-row .rm{border:0;background:#fdecec;color:#c0392b;border-radius:7px;width:30px;height:30px;font-size:15px;font-weight:700;cursor:pointer;flex:none;}
        .ent-edit-row .rm:hover{background:#f7d4d4;}
        .ent-edit-add{display:flex;gap:8px;margin-top:10px;border-top:1px dashed #d9e2ea;padding-top:12px;}
        .ent-edit-add input{flex:1;max-width:280px;border:1px solid #d4dde6;border-radius:7px;padding:6px 10px;font:inherit;}
        .ent-edit-add input:focus{outline:none;border-color:#157a35;box-shadow:0 0 0 2px rgba(21,122,53,.15);}
        .ent-edit-add button{border:0;background:#157a35;color:#fff;border-radius:7px;padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer;flex:none;}
        .ent-edit-add button:hover{background:#0c5a26;}
        table.ent-grade{border-collapse:collapse;font-size:12px;white-space:nowrap;width:100%;}
        table.ent-grade th,table.ent-grade td{border:1px solid #eef2f6;padding:4px 6px;text-align:center;}
        table.ent-grade th{background:#f3f6fa;color:#46546a;font-weight:700;}
        table.ent-grade th.dom{background:#dcebfb;color:#0c5a26;}
        table.ent-grade th .ent-dow{font-weight:400;font-size:10px;color:#8a97a8;letter-spacing:.3px;}
        table.ent-grade td.dom-fix{background:#eef4fb;color:#9aa7b6;font-weight:600;}
        table.ent-grade th.nome,table.ent-grade td.nome{position:sticky;left:0;text-align:left;min-width:130px;background:#fff;font-weight:600;color:#33404f;z-index:2;}
        table.ent-grade th.nome{background:#f3f6fa;z-index:3;}
        table.ent-grade td.tot{background:#f6faf7;font-weight:700;color:#0c5a26;}
        table.ent-grade tr.linha-tot td{background:#eef6f0;font-weight:700;color:#0c5a26;}
        table.ent-grade input{width:42px;border:1px solid transparent;border-radius:5px;padding:3px 2px;text-align:center;font:inherit;color:#1d2733;background:transparent;}
        table.ent-grade input:focus{outline:none;border-color:#157a35;background:#fff;box-shadow:0 0 0 2px rgba(21,122,53,.15);}
        .ent-grade-info{font-size:12.5px;color:#8a97a8;margin:0 0 8px;}
        .ent-graf{background:#fff;border:1px solid #e6ebf1;border-radius:12px;padding:16px 18px;margin-bottom:16px;box-shadow:0 1px 3px rgba(20,40,70,.05);}
        .ent-graf h3{margin:0 0 14px;font-size:14px;font-weight:800;color:#0c5a26;text-align:center;text-transform:uppercase;letter-spacing:.6px;}
        .ent-graf2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
        @media (max-width:820px){ .ent-graf2{grid-template-columns:1fr;} }
        .ent-barra-row{display:flex;align-items:center;gap:10px;margin-bottom:9px;font-size:13px;}
        .ent-barra-row .nm{flex:0 0 90px;text-align:right;font-weight:600;color:#33404f;}
        .ent-barra-track{position:relative;flex:1;background:#eef2f6;border-radius:6px;height:22px;}
        .ent-barra-fill{position:absolute;left:0;top:0;height:100%;border-radius:6px;display:flex;align-items:center;justify-content:flex-end;padding-right:7px;color:#fff;font-size:12px;font-weight:700;min-width:22px;box-sizing:border-box;}
        .ent-meta-line{position:absolute;top:-3px;bottom:-3px;width:0;border-left:2px dashed #1d2733;}
        .ent-meta-line span{position:absolute;top:-20px;left:50%;transform:translateX(-50%);font-size:12px;font-weight:700;color:#1d2733;background:#fff;padding:1px 5px;border-radius:4px;white-space:nowrap;}
        .ent-meta-line span.esq{left:auto;right:0;transform:none;}
        .ent-leg{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-bottom:10px;font-size:12px;}
        .ent-leg span{display:inline-flex;align-items:center;gap:5px;color:#56606d;font-weight:600;}
        .ent-leg i{width:11px;height:11px;border-radius:50%;display:inline-block;}
        .ent-pt-hit{cursor:pointer;}
        .ent-tip{position:fixed;z-index:9999;display:none;pointer-events:none;background:#1f2d3d;color:#fff;font-size:12px;font-weight:600;padding:8px 11px;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.3);white-space:nowrap;text-align:left;}
        .ent-svg-wrap{overflow-x:auto;max-width:100%;}
        #entGraficos,#entGradeWrap{min-width:0;}
        .ent-vazio{padding:40px 20px;text-align:center;color:#8a97a8;font-size:14px;}
      </style>
      <div class="card">
        <div class="ent-top">
          <div class="ent-nav"><button id="entPrev" type="button">‹</button><button id="entNext" type="button">›</button></div>
          <div class="ent-titulo" id="entTitulo"></div>
          <button class="ent-btn" id="entHoje" type="button">Hoje</button>
          <button class="ent-btn" id="entEditar" type="button" style="margin-left:auto;">✏️ Lançar entregas</button>
        </div>
        <div class="kpis" id="entKpis" style="grid-template-columns:repeat(6,minmax(0,1fr));margin-bottom:22px;"></div>
        <div id="entGradeWrap" style="display:none;">
          <p class="ent-grade-info">Digite quantas entregas cada entregador fez em cada dia (deixe em branco se não houve). O painel calcula tudo sozinho.</p>
          <div id="entEntregadoresEdit"></div>
          <div class="ent-grade-wrap" id="entGrade"></div>
        </div>
        <div id="entGraficos"></div>
        <div id="entTip" class="ent-tip"></div>
      </div>
    </section>

    <section id="page-ferias" class="page">
      <style>
        .fer-badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11.5px;font-weight:700;letter-spacing:.2px;}
        .fer-b-ferias{background:#e8f5ec;color:#1b9e4b;}
        .fer-b-agendada{background:#fff4d6;color:#9a6b00;}
        .fer-b-concluida{background:#eef1f5;color:#7a8696;}
        #ferConsultaResultado{margin-top:12px;}
        .fer-chip{display:inline-flex;align-items:center;gap:7px;background:#f3f8f4;border:1px solid #d4e6da;border-radius:10px;padding:8px 13px;margin:0 8px 8px 0;font-size:14px;color:#1d2733;font-weight:600;}
        .fer-chip .ico{font-size:15px;}
        .fer-vazio{padding:18px 4px;color:#8a97a8;font-size:14px;}
        #ferTabela table{width:100%;border-collapse:collapse;font-size:14px;}
        #ferTabela th,#ferTabela td{text-align:left;padding:10px 12px;border-bottom:1px solid #eef2f6;}
        #ferTabela th{font-size:11.5px;text-transform:uppercase;letter-spacing:.3px;color:#6b7787;font-weight:700;background:#f7f9fc;}
        #ferTabela td.acoes{white-space:nowrap;}
        .fer-del{color:#c0392b;cursor:pointer;font-weight:700;}
        .fer-del:hover{text-decoration:underline;}
      </style>
      <div class="kpis" id="ferKpis" style="grid-template-columns:repeat(3,1fr);"></div>

      <div class="card">
        <h2>Cadastrar férias</h2>
        <div class="filtros" style="box-shadow:none;padding:0;flex-wrap:wrap;align-items:flex-start;">
          <div class="campo" style="flex:1;min-width:200px;"><label for="ferNome">Funcionário</label>
            <input type="text" id="ferNome" list="ferFuncList" placeholder="nome do funcionário">
            <datalist id="ferFuncList"></datalist>
          </div>
          <div class="campo"><label for="ferIni">Início das férias</label><input type="date" id="ferIni"></div>
          <div class="campo"><label for="ferFim">Fim das férias</label><input type="date" id="ferFim"></div>
          <div class="campo" style="flex:1;min-width:160px;"><label for="ferObs">Observação</label><input type="text" id="ferObs" placeholder="opcional"></div>
          <button class="btn-p" id="ferSalvar" style="margin-top:18px;">Adicionar</button>
          <button class="btn-s" id="ferCancelar" style="display:none;margin-top:18px;">Cancelar</button>
          <span id="ferMsg" style="flex-basis:100%;font-size:12.5px;color:#c0392b;margin-top:6px;display:none;"></span>
        </div>
      </div>

      <div class="card">
        <h2>Quem está de férias?</h2>
        <p style="margin:0 0 6px;color:#6b7787;font-size:13.5px;">Escolha um dia pra ver quem estará de férias — assim você se programa e não é pego de surpresa.</p>
        <input type="date" id="ferConsultaDia" style="padding:8px 11px;border:1px solid #cdd6e0;border-radius:8px;font-size:14px;">
        <div id="ferConsultaResultado"></div>
      </div>

      <div class="card">
        <h2>Férias cadastradas</h2>
        <div id="ferTabela"></div>
      </div>
    </section>

    <section id="page-negociar" class="page">
      <style>
        .neg-badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11.5px;font-weight:700;letter-spacing:.2px;}
        .neg-b-pendente{background:#fff4d6;color:#9a6b00;}
        .neg-b-lancado{background:#e8f5ec;color:#1b9e4b;}
        .neg-vazio{padding:18px 4px;color:#8a97a8;font-size:14px;}
        #negTabela table{width:100%;border-collapse:collapse;font-size:14px;}
        #negTabela th,#negTabela td{text-align:left;padding:10px 12px;border-bottom:1px solid #eef2f6;vertical-align:top;}
        #negTabela th{font-size:11.5px;text-transform:uppercase;letter-spacing:.3px;color:#6b7787;font-weight:700;background:#f7f9fc;}
        #negTabela td.acoes{white-space:nowrap;}
        .neg-del{color:#c0392b;cursor:pointer;font-weight:700;}
        .neg-del:hover{text-decoration:underline;}
        .neg-mark{border:1px solid #cfe0d6;background:#fff;color:#157a35;border-radius:7px;padding:4px 11px;font-size:12px;font-weight:700;cursor:pointer;}
        .neg-mark:hover{background:#e3f0e8;}
        .neg-reabrir{border:1px solid #e3d3a3;background:#fffdf6;color:#9a6b00;border-radius:7px;padding:4px 11px;font-size:12px;font-weight:700;cursor:pointer;}
      </style>
      <div class="kpis" id="negKpis" style="grid-template-columns:repeat(3,1fr);"></div>

      <div class="card">
        <h2>Anotar negociação</h2>
        <p style="margin:0 0 6px;color:#6b7787;font-size:13.5px;">Anote aqui o que você negociou direto com o fornecedor. O comprador vê a lista e lança no sistema do VR.</p>
        <div class="filtros" style="box-shadow:none;padding:0;flex-wrap:wrap;align-items:flex-start;">
          <div class="campo" style="flex:1;min-width:180px;"><label for="negProd">Produto</label><input type="text" id="negProd" placeholder="ex: Arroz 5kg Tio João"></div>
          <div class="campo" style="flex:1;min-width:160px;"><label for="negForn">Fornecedor</label><input type="text" id="negForn" placeholder="ex: Distribuidora Seridó"></div>
          <div class="campo"><label for="negPreco">Preço / condição</label><input type="text" id="negPreco" placeholder="ex: R$ 22,00 a unid."></div>
          <div class="campo"><label for="negQtd">Quantidade</label><input type="text" id="negQtd" placeholder="ex: 50 caixas" style="width:120px;"></div>
          <div class="campo" style="flex:1;min-width:160px;"><label for="negObs">Observação</label><input type="text" id="negObs" placeholder="opcional"></div>
          <button class="btn-p" id="negSalvar" style="margin-top:18px;">Adicionar</button>
          <button class="btn-s" id="negCancelar" style="display:none;margin-top:18px;">Cancelar</button>
          <span id="negMsg" style="flex-basis:100%;font-size:12.5px;color:#c0392b;margin-top:6px;display:none;"></span>
        </div>
      </div>

      <div class="card">
        <h2>Negociações</h2>
        <div id="negTabela"></div>
      </div>
    </section>
  </main>
  </div>
  <footer>Dados reais lidos do sistema VR da loja · resumos gerados em ${geradoEm} · o filtro recalcula no seu navegador.</footer>

<script>
const DIA = ${JSON.stringify(DIA)};
const HORA = ${JSON.stringify(HORA)};
const OPER = ${JSON.stringify(OP)};
const PAGS = ${JSON.stringify(PAG)};
const SETORES = ${JSON.stringify(SETOR)};
const MESPROD = ${JSON.stringify(MESPROD)};
const ESTOQUE = ${JSON.stringify(estoque)};
const PRODUTOS = ${JSON.stringify(produtosUnicos)}; // [[codigo, nome], ...]
const DATA_MIN = ${JSON.stringify(dataMin)};
const DATA_MAX = ${JSON.stringify(dataMax)};
const DATA_DEF_DE = ${JSON.stringify(defaultDe)};

const brl = (x) => (x||0).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
const num = (x) => (x||0).toLocaleString("pt-BR");
const corClasse = { A:"#1b9e4b", B:"#e8a800", C:"#c0392b" };
const corRuptura = { OK:"#1b9e4b", BAIXO:"#e8a800", RUPTURA:"#c0392b" };
const cores = ["#157a35","#2a9d8f","#e8a800","#c0392b","#7048b6"];

function soma(arr){ return arr.reduce((a,b)=>a+b,0); }
function sparkline(cur, prev, color){
  if(!cur || cur.length<2) return '';
  var w=100, h=30;
  var all=cur.concat(prev&&prev.length?prev:[]);
  var mn=Math.min.apply(null,all), mx=Math.max.apply(null,all), rng=(mx-mn)||1;
  var path=function(vals){ var n=vals.length; return vals.map(function(v,i){ var x=(i/(n-1))*w; var y=h-3-((v-mn)/rng)*(h-6); return x.toFixed(1)+','+y.toFixed(1); }).join(' '); };
  var s='<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">';
  if(prev && prev.length>1){ s+='<polyline fill="none" stroke="#aeb8c2" stroke-width="1.4" stroke-dasharray="2.5 2.5" stroke-linecap="round" stroke-linejoin="round" points="'+path(prev)+'"/>'; }
  s+='<polyline fill="none" stroke="'+color+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" points="'+path(cur)+'"/></svg>';
  return s;
}
function grupo(arr, keyFn){ const m=new Map(); for(const x of arr){ const k=keyFn(x); (m.get(k)??m.set(k,[]).get(k)).push(x);} return m; }

function barsVertical(data, cor){
  if(!data.length) return '<p class="vazio">Sem dados no período.</p>';
  const max=Math.max(...data.map(d=>d.value),1);
  return '<div class="bars">'+data.map(d=>
    '<div class="bar-col"><div class="bar-v" data-h="'+(d.value/max*140)+'px" style="height:0;background:'+cor+';min-height:'+(d.value>0?3:0)+'px" title="'+brl(d.value)+'"></div><span class="bar-lbl">'+d.label+'</span></div>'
  ).join('')+'</div>';
}
function barsHorizontal(data, cor){
  if(!data.length) return '<p class="vazio">Sem dados no período.</p>';
  const max=Math.max(...data.map(d=>d.value),1);
  return '<div class="hbars">'+data.map(d=>
    '<div class="hbar-row"><span class="hbar-lbl">'+d.label+'</span><div class="hbar-track"><div class="hbar-fill" data-w="'+(d.value/max*100)+'%" style="width:0;background:'+cor+'"></div></div><span class="hbar-val">'+(d.sub??brl(d.value))+'</span></div>'
  ).join('')+'</div>';
}

// Anima os números (KPIs) subindo de 0 até o valor final — efeito de contagem rodando.
function animarContagem(container){
  if(!container) return;
  var els = container.querySelectorAll('.v[data-alvo]');
  for(var i=0;i<els.length;i++){
    (function(el){
      var alvo = parseFloat(el.getAttribute('data-alvo'));
      var fmt = el.getAttribute('data-fmt');
      if(!isFinite(alvo)) return;
      var dur = 900, ini = null;
      function fmtVal(v){ return fmt==="n" ? num(Math.round(v)) : brl(v); }
      function passo(ts){
        if(ini===null) ini=ts;
        var p = Math.min((ts-ini)/dur, 1);
        var eased = 1-Math.pow(1-p,3);
        el.textContent = fmtVal(alvo*eased);
        if(p<1) requestAnimationFrame(passo); else el.textContent = fmtVal(alvo);
      }
      requestAnimationFrame(passo);
    })(els[i]);
  }
}
// Faz as barras dos gráficos crescerem de 0 até o tamanho final (animação de subida).
function animarBarras(root){
  if(!root) return;
  requestAnimationFrame(function(){ requestAnimationFrame(function(){
    var vs=root.querySelectorAll('.bar-v[data-h]');
    for(var i=0;i<vs.length;i++) vs[i].style.height=vs[i].getAttribute('data-h');
    var hs=root.querySelectorAll('.hbar-fill[data-w]');
    for(var j=0;j<hs.length;j++) hs[j].style.width=hs[j].getAttribute('data-w');
  }); });
}
function render(){
  let de = document.getElementById("de").value || DATA_MIN;
  let ate = document.getElementById("ate").value || DATA_MAX;
  if(de>ate){ const t=de; de=ate; ate=t; }
  try{ localStorage.setItem("vendas_periodo2", JSON.stringify({de:de,ate:ate})); }catch(e){}
  const tCod = (document.getElementById("cod").value || "").trim().toLowerCase();
  const tNome = (document.getElementById("nome").value || "").trim().toLowerCase();
  const temProd = tCod!=="" || tNome!=="";
  const inRange = d => d>=de && d<=ate;

  const fDia = DIA.filter(x=>inRange(x.d));
  const mesIni = de.slice(0,7), mesFim = ate.slice(0,7);

  // ranking de produtos (resumo mensal) + filtro de produto
  const prodMap = new Map();
  for(const r of MESPROD){
    if(r.m < mesIni || r.m > mesFim) continue;
    if(tCod!=="" && !(r.id.toLowerCase()===tCod || r.id.toLowerCase().endsWith(tCod))) continue;
    if(tNome!=="" && r.nome.toLowerCase().indexOf(tNome)<0) continue;
    const e = prodMap.get(r.id) || {nome:r.nome, fat:0, qtd:0};
    e.fat+=r.fat; e.qtd+=r.qtd; prodMap.set(r.id, e);
  }
  const rankProd = [...prodMap.values()].sort((a,b)=>b.fat-a.fat);

  const infoData = "Período: "+de.split('-').reverse().join('/')+" a "+ate.split('-').reverse().join('/');
  document.getElementById("periodoInfo").textContent = infoData + (temProd ? " · filtro de produto aplicado" : "");

  // KPIs
  let fat, marg, qtd, cupons, ticket, margPerc;
  if(temProd){
    fat = soma(rankProd.map(p=>p.fat)); qtd = soma(rankProd.map(p=>p.qtd));
    marg = null; cupons = null; ticket = null; margPerc = null;
  } else {
    fat = soma(fDia.map(x=>x.fat)); marg = soma(fDia.map(x=>x.marg));
    qtd = soma(fDia.map(x=>x.qtd)); cupons = soma(fDia.map(x=>x.cup));
    ticket = cupons ? fat/cupons : 0; margPerc = fat ? marg/fat*100 : 0;
  }
  function kpiVal(t,val){ if(val===null||val===undefined) return "—"; return t==="n"?num(Math.round(val)):brl(val); }
  document.getElementById("kpis").innerHTML =
    [["v_brl",fat,"Faturamento"],["n",cupons,"Vendas (cupons)"],["v_brl",ticket,"Ticket médio"],
     ["m",marg,"Margem"+(margPerc!==null?" ("+margPerc.toFixed(0)+"%)":"")],["n",qtd,"Itens vendidos"]]
    .map(function(a){
      var nulo = a[1]===null||a[1]===undefined;
      var fmt = a[0]==="n" ? "n" : "brl";
      var dataAttr = nulo ? "" : (' data-alvo="'+a[1]+'" data-fmt="'+fmt+'"');
      return '<div class="kpi"><div class="v"'+dataAttr+'>'+kpiVal(a[0],a[1])+'</div><div class="l">'+a[2]+'</div></div>';
    }).join('');
  animarContagem(document.getElementById("kpis"));

  // por dia — preenche dias vazios com 0 pra a linha do tempo ficar contínua
  const mapaDia=new Map(fDia.map(x=>[x.d,x.fat]));
  let porDia=[];
  if(fDia.length){
    const d0=new Date(fDia[0].d+"T00:00:00Z"), dN=new Date(fDia[fDia.length-1].d+"T00:00:00Z");
    for(let d=new Date(d0); d<=dN; d.setUTCDate(d.getUTCDate()+1)){
      const k=d.toISOString().slice(0,10);
      porDia.push({label:k.slice(8,10)+"/"+k.slice(5,7), value:mapaDia.get(k)||0});
    }
  }
  document.getElementById("porDia").innerHTML=barsVertical(porDia,"#157a35");

  // por hora
  const mh=new Map();
  for(const x of HORA){ if(inRange(x.d)) mh.set(x.h,(mh.get(x.h)||0)+x.fat); }
  const horas=[...mh.keys()].map(Number).sort((a,b)=>a-b);
  let porHora=[];
  if(horas.length){ for(let h=horas[0];h<=horas[horas.length-1];h++){ const k=String(h).padStart(2,"0"); porHora.push({label:k+":00",value:mh.get(k)||0}); } }
  document.getElementById("porHora").innerHTML=barsVertical(porHora,"#157a35");

  // ranking produtos (top 20)
  document.getElementById("rankProd").innerHTML=barsHorizontal(rankProd.slice(0,20).map(p=>({label:p.nome,value:p.fat})),"#157a35");

  // ranking operadores
  const mo=new Map();
  for(const x of OPER){ if(inRange(x.d)){ const e=mo.get(x.o)||{fat:0,cup:0}; e.fat+=x.fat; e.cup+=x.cup; mo.set(x.o,e); } }
  const rankOp=[...mo.entries()].map(e=>({operador:e[0],value:e[1].fat,cupons:e[1].cup})).sort((a,b)=>b.value-a.value);
  document.getElementById("rankOp").innerHTML=barsHorizontal(rankOp.slice(0,20).map(o=>({label:o.operador,value:o.value,sub:brl(o.value)+" · "+num(o.cupons)+" vendas"})),"#7048b6");

  // curva ABC (top 50 do período)
  const totalP=soma(rankProd.map(r=>r.fat)); let ac=0;
  const abc=rankProd.slice(0,50).map(r=>{ac+=r.fat;const p=totalP?ac/totalP*100:0;return{produto:r.nome,value:r.fat,perc:p,classe:p<=80?"A":p<=95?"B":"C"};});
  document.getElementById("abc").innerHTML = abc.length ?
    '<table><thead><tr><th>Produto</th><th>Faturamento</th><th>% acum.</th><th>Classe</th></tr></thead><tbody>'+
    abc.map(r=>'<tr><td>'+r.produto+'</td><td>'+brl(r.value)+'</td><td>'+r.perc.toFixed(0)+'%</td><td><span class="badge" style="background:'+corClasse[r.classe]+'">'+r.classe+'</span></td></tr>').join('')+
    '</tbody></table>' : '<p class="vazio">Sem dados no período.</p>';

  // estoque (em integração)
  document.getElementById("estoque").innerHTML = ESTOQUE.length ?
    '<table><thead><tr><th>Produto</th><th>Setor</th><th>Estoque</th><th>Status</th></tr></thead><tbody>'+
    ESTOQUE.map(e=>'<tr><td>'+e.produto+'</td><td>'+e.setor+'</td><td>'+num(e.estoque)+'</td><td><span class="badge" style="background:'+corRuptura[e.ruptura]+'">'+e.ruptura+'</span></td></tr>').join('')+
    '</tbody></table>' : '<p class="vazio">Estoque em integração — em breve com dados reais.</p>';

  // pagamentos
  const mp2=new Map();
  for(const x of PAGS){ if(inRange(x.d)) mp2.set(x.p,(mp2.get(x.p)||0)+x.fat); }
  const pag=[...mp2.entries()].map(e=>({nome:e[0],total:e[1]})).sort((a,b)=>b.total-a.total);
  const tot=soma(pag.map(p=>p.total));
  document.getElementById("pagamentos").innerHTML = pag.length ?
    pag.map((p,i)=>'<div class="pill"><span class="dot" style="background:'+cores[i%cores.length]+'"></span><span class="nm">'+p.nome+'</span><span class="vl">'+brl(p.total)+' · '+(p.total/Math.max(tot,1)*100).toFixed(0)+'%</span></div>').join('')
    : '<p class="vazio">Sem dados no período.</p>';
  animarBarras(document.getElementById("page-vendas"));
}

document.getElementById("aplicar").addEventListener("click", function(){
  // "Pesquisar" recarrega a página buscando os dados mais recentes do servidor
  // e mantém a data/filtro que você escolheu.
  try{
    sessionStorage.setItem("vendas_pesquisar", JSON.stringify({
      de: document.getElementById("de").value,
      ate: document.getElementById("ate").value,
      cod: document.getElementById("cod").value,
      nome: document.getElementById("nome").value
    }));
  }catch(e){}
  window.location.replace(window.location.pathname + "?r=" + Date.now());
});
document.getElementById("limpar").addEventListener("click", ()=>{
  document.getElementById("de").value=DATA_DEF_DE;
  document.getElementById("ate").value=DATA_MAX;
  document.getElementById("cod").value="";
  document.getElementById("nome").value="";
  render();
});

// ---- Página de Análise (números consolidados; começa com os 5 KPIs, vamos adicionando) ----
var AREA_VENDA_M2 = 1050;         // área de venda da loja (m²)
var META_CLIENTES_M2 = 2.77;      // meta de clientes por m² por dia (fluxo)
var META_PRODUTOS_CLIENTE = 4.5;  // meta de produtos por cliente (layout/organização)
function renderAnalise(){
  var de = document.getElementById("anDe").value || DATA_MIN;
  var ate = document.getElementById("anAte").value || DATA_MAX;
  if(de>ate){ var t=de; de=ate; ate=t; }
  var f = DIA.filter(function(x){ return x.d>=de && x.d<=ate; });
  var fat = f.reduce(function(s,x){ return s+(x.fat||0); },0);
  var marg = f.reduce(function(s,x){ return s+(x.marg||0); },0);
  var qtd = f.reduce(function(s,x){ return s+(x.qtd||0); },0);
  var cup = f.reduce(function(s,x){ return s+(x.cup||0); },0);
  var ticket = cup ? fat/cup : 0;
  var margPerc = fat ? marg/fat*100 : 0;
  var fmtData = function(s){ return s.split("-").reverse().join("/"); };
  document.getElementById("anPeriodoInfo").textContent = "Período: "+fmtData(de)+" a "+fmtData(ate);
  // tendência (vs período anterior de mesma duração) + série dos últimos 30 dias pro mini-gráfico
  var _add = function(iso,n){ var p=iso.split("-"); var d=new Date(Date.UTC(+p[0],+p[1]-1,+p[2])); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
  var _len = Math.round((Date.UTC(+ate.slice(0,4),+ate.slice(5,7)-1,+ate.slice(8,10)) - Date.UTC(+de.slice(0,4),+de.slice(5,7)-1,+de.slice(8,10)))/86400000)+1;
  var _pAte=_add(de,-1), _pDe=_add(_pAte,-(_len-1));
  var _fp = DIA.filter(function(x){ return x.d>=_pDe && x.d<=_pAte; });
  var _fatP=_fp.reduce(function(s,x){return s+(x.fat||0);},0), _margP=_fp.reduce(function(s,x){return s+(x.marg||0);},0);
  var _qtdP=_fp.reduce(function(s,x){return s+(x.qtd||0);},0), _cupP=_fp.reduce(function(s,x){return s+(x.cup||0);},0);
  var _tkP=_cupP?_fatP/_cupP:0, temPrevK=_fp.length>0;
  var _all = DIA.filter(function(x){ return x.d<=ate; });
  var _W=30, _cur=_all.slice(-_W), _prev=_all.slice(-(2*_W), -_W);
  var serieOf=function(arr,k){ return arr.map(function(x){ return k==="tk"?(x.cup?x.fat/x.cup:0):(x[k]||0); }); };

  var cards = [
    ["brl", fat, "Faturamento", _fatP, serieOf(_cur,"fat"), serieOf(_prev,"fat")],
    ["n", cup, "Vendas (cupons)", _cupP, serieOf(_cur,"cup"), serieOf(_prev,"cup")],
    ["brl", ticket, "Ticket médio", _tkP, serieOf(_cur,"tk"), serieOf(_prev,"tk")],
    ["brl", marg, "Margem ("+margPerc.toFixed(0)+"%)", _margP, serieOf(_cur,"marg"), serieOf(_prev,"marg")],
    ["n", qtd, "Itens vendidos", _qtdP, serieOf(_cur,"qtd"), serieOf(_prev,"qtd")]
  ];
  document.getElementById("anKpis").innerHTML = cards.map(function(a){
    var txt = a[0]==="n" ? num(Math.round(a[1])) : brl(a[1]);
    var trendHtml="";
    if(temPrevK && a[3]>0){
      var pct=(a[1]-a[3])/a[3]*100, up=pct>=0;
      trendHtml='<span class="an-trend '+(up?"up":"down")+'">'+(up?"▲":"▼")+' '+Math.abs(pct).toFixed(0)+'%</span>';
    }
    return '<div class="kpi"><div class="l">'+a[2]+'</div><div class="an-top"><div class="v" data-alvo="'+a[1]+'" data-fmt="'+a[0]+'">'+txt+'</div>'+trendHtml+'</div><div class="an-spark">'+sparkline(a[4],a[5],"#2f9e44")+'</div></div>';
  }).join('');
  animarContagem(document.getElementById("anKpis"));

  // --- Indicadores compactos (cards pequenos + bolinha "?" com a explicação no hover) ---
  var nf2 = function(n){ return Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); };
  var ni = function(n){ return Math.round(n).toLocaleString('pt-BR'); };
  var dias = f.length || 1;
  var inds = [];

  // Clientes por m² (fluxo)
  var clientesDia = cup / dias;
  var densidade = clientesDia / AREA_VENDA_M2;
  var bateu = densidade >= META_CLIENTES_M2;
  var necessarioDia = Math.round(META_CLIENTES_M2*AREA_VENDA_M2);
  var faltam = Math.max(0, Math.round(necessarioDia - clientesDia));
  var tipDens = bateu
    ? "Clientes por m² de área de venda, por dia (meta 2,77). Mostra o fluxo de gente na loja. Você está batendo — média de "+ni(clientesDia)+" clientes/dia."
    : "Clientes por m² de área de venda, por dia (meta 2,77 = ~"+ni(necessarioDia)+" clientes/dia). Mostra o fluxo de gente na loja. Você está abaixo — faltam ~"+ni(faltam)+"/dia. Sinal de reforçar o marketing: carro de som, outdoor, rádio, cartaz, WhatsApp, anúncios pagos, app próprio.";
  inds.push({ v:nf2(densidade), cls:bateu?'ind-ok':'ind-bad', l:'Clientes/m² (meta 2,77)', tip:tipDens });

  // Produtos por cliente (layout)
  var nprod = f.reduce(function(s,x){ return s+(x.nprod||0); },0);
  if(nprod>0){
    var prodCli = cup ? nprod/cup : 0;
    var bateuP = prodCli >= META_PRODUTOS_CLIENTE;
    var tipProd = bateuP
      ? "Produtos que cada cliente leva em média (meta 4,5). Mede se o layout estimula o cliente a levar mais. Você está batendo ("+nf2(prodCli)+") — layout e organização funcionando."
      : "Produtos que cada cliente leva em média (meta 4,5). Mede se o layout estimula o cliente a levar mais. Está abaixo ("+nf2(prodCli)+") — sinal de rever o layout, o cross-merchandising e os pontos de impulso da loja.";
    inds.push({ v:nf2(prodCli), cls:bateuP?'ind-ok':'ind-bad', l:'Produtos/cliente (meta 4,5)', tip:tipProd });
  }

  // Ticket médio — valor + tendência (subiu = lado certo / caiu = lado errado) vs período anterior de mesma duração
  var addDias = function(iso,n){ var p=iso.split("-"); var d=new Date(Date.UTC(+p[0],+p[1]-1,+p[2])); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
  var lenDias = Math.round((Date.UTC.apply(null,ate.split("-").map((x,i)=>i===1?+x-1:+x)) - Date.UTC.apply(null,de.split("-").map((x,i)=>i===1?+x-1:+x)))/86400000)+1;
  var prevAte = addDias(de,-1), prevDe = addDias(prevAte,-(lenDias-1));
  var fp = DIA.filter(function(x){ return x.d>=prevDe && x.d<=prevAte; });
  var fatP = fp.reduce(function(s,x){ return s+(x.fat||0); },0);
  var cupP = fp.reduce(function(s,x){ return s+(x.cup||0); },0);
  var ticketP = cupP ? fatP/cupP : 0;
  var temPrev = fp.length>0 && ticketP>0;
  var trendPct = temPrev ? (ticket-ticketP)/ticketP*100 : 0;
  var subiu = trendPct >= 0;
  var dm = function(iso){ var p=iso.split("-"); return p[2]+"/"+p[1]; };
  var compLabel = (lenDias===1) ? dm(prevDe) : (dm(prevDe)+"–"+dm(prevAte));
  var setaHtml = temPrev
    ? ' <span style="font-size:12px;font-weight:700;color:'+(subiu?'#1b9e4b':'#c0392b')+';">'+(subiu?'▲':'▼')+' '+Math.abs(trendPct).toFixed(1).replace('.',',')+'%</span>'+
      ' <span style="font-size:11px;font-weight:500;color:#8a97a8;">vs '+compLabel+'</span>'
    : ' <span style="font-size:11px;font-weight:500;color:#8a97a8;">(sem período anterior)</span>';
  var tipTk = "Valor médio que cada cliente gasta por compra (faturamento ÷ cupons). Varia de ~R$30 a ~R$200 (R$200 ≈ loja que fatura R$10 milhões). Quanto maior, melhor. A setinha compara com o período anterior de mesma duração"+(temPrev?(" — neste caso, "+compLabel):"")+": ▲ subiu (lado certo) / ▼ caiu (lado errado).";
  inds.push({ v: brl(ticket)+setaHtml, cls:'', l:'Ticket médio (R$30–200)', tip:tipTk });

  // Estimativa de faturamento do mês corrente (projeção pelo ritmo até agora)
  var mesAtual = DATA_MAX.slice(0,7);
  var diaMesArr = DIA.filter(function(x){ return x.d.slice(0,7)===mesAtual; });
  var fatMes = diaMesArr.reduce(function(s,x){ return s+(x.fat||0); },0);
  var diaNum = parseInt(DATA_MAX.slice(8,10),10);
  var diasNoMes = new Date(Date.UTC(+DATA_MAX.slice(0,4), +DATA_MAX.slice(5,7), 0)).getUTCDate();
  var estMes = diaNum>0 ? fatMes/diaNum*diasNoMes : fatMes;
  var nomeMes = MESES[(+DATA_MAX.slice(5,7))-1].toLowerCase();
  var tipEst = "Projeção de quanto a loja deve faturar no mês de "+nomeMes+", mantendo o ritmo atual. Conta: faturamento do mês até agora ("+brl(fatMes)+" em "+diaNum+" dia"+(diaNum!==1?"s":"")+") ÷ dias passados × "+diasNoMes+" dias do mês. É só uma estimativa — muda conforme as vendas dos próximos dias.";
  inds.push({ v: brl(estMes), cls:'ind-est', l:'Estimativa do mês ('+nomeMes+')', tip:tipEst });

  // Lucro (margem) estimado do mês
  var margMesTot = diaMesArr.reduce(function(s,x){ return s+(x.marg||0); },0);
  var estLucro = diaNum>0 ? margMesTot/diaNum*diasNoMes : margMesTot;
  var tipLucro = "Projeção do lucro (margem) do mês de "+nomeMes+" no ritmo atual. Mesmo cálculo da estimativa de faturamento, mas usando a margem. É uma estimativa.";
  inds.push({ v: brl(estLucro), cls:'ind-est', l:'Lucro estimado do mês', tip:tipLucro });

  // Comparativo com o MESMO período do mês passado (dia 1 até o dia de hoje)
  var mesP = (+DATA_MAX.slice(5,7))-1, anoP = +DATA_MAX.slice(0,4);
  if(mesP<1){ mesP=12; anoP--; }
  var mesPassadoKey = anoP+"-"+("0"+mesP).slice(-2);
  var diaMesPassado = DIA.filter(function(x){ return x.d.slice(0,7)===mesPassadoKey && parseInt(x.d.slice(8,10),10)<=diaNum; });
  var fatMesPassado = diaMesPassado.reduce(function(s,x){ return s+(x.fat||0); },0);
  var temComp = fatMesPassado>0;
  var compPct = temComp ? (fatMes-fatMesPassado)/fatMesPassado*100 : 0;
  var compSubiu = compPct>=0;
  var nomeMesP = MESES[mesP-1].toLowerCase();
  var compVal = temComp
    ? '<span style="color:'+(compSubiu?'#1b9e4b':'#c0392b')+'">'+(compSubiu?'▲':'▼')+' '+Math.abs(compPct).toFixed(1).replace('.',',')+'%</span>'
    : '—';
  var tipComp = temComp
    ? "Compara o faturamento do mês até agora ("+brl(fatMes)+", dias 1 a "+diaNum+") com os MESMOS dias de "+nomeMesP+" ("+brl(fatMesPassado)+"). Verde ▲ = crescendo; vermelho ▼ = caindo em relação ao mês passado."
    : "Ainda não há dados de "+nomeMesP+" (mês passado) para comparar.";
  inds.push({ v: compVal, cls:'', l:'Faturamento vs '+nomeMesP, tip:tipComp });

  // Vendas por m² (período selecionado)
  var vendasM2 = fat / AREA_VENDA_M2;
  var tipVM2 = "Quanto a loja faturou por metro quadrado de área de venda ("+AREA_VENDA_M2+" m²) no período que você selecionou em cima. Referência mensal saudável no varejo: ~R$1.000 a R$2.500/m².";
  inds.push({ v: brl(vendasM2), cls:'ind-est', l:'Vendas/m²', tip:tipVM2 });

  document.getElementById("anIndicadores").innerHTML = inds.map(function(x){
    return '<div class="kpi"><div class="v '+x.cls+'">'+x.v+'</div><div class="l">'+x.l+' <span class="kpi-help" data-tip="'+x.tip.replace(/"/g,'&quot;')+'">?</span></div></div>';
  }).join('');
}
document.getElementById("anAplicar").addEventListener("click", renderAnalise);
document.getElementById("anLimpar").addEventListener("click", function(){
  document.getElementById("anDe").value=DATA_MAX;
  document.getElementById("anAte").value=DATA_MAX;
  renderAnalise();
});

// Quando digita um código que resolve para UM produto só, preenche o nome.
function autoPreencherNome(finalizar){
  const tCod = (document.getElementById("cod").value || "").trim().toLowerCase();
  if(tCod==="") return;
  const achados = PRODUTOS.filter(([cod]) => { const c=cod.toLowerCase(); return c===tCod || c.endsWith(tCod); });
  if(achados.length===1){
    document.getElementById("nome").value = achados[0][1];
    // Ao confirmar (Enter), completa "1" -> "001" no próprio campo de código.
    if(finalizar){ document.getElementById("cod").value = achados[0][0]; }
  }
}
// Quando escolhe/digita um nome exato, preenche o código.
function autoPreencherCodigo(){
  const tNome = (document.getElementById("nome").value || "").trim().toLowerCase();
  if(tNome==="") return;
  const achados = PRODUTOS.filter(([,nome]) => nome.toLowerCase()===tNome);
  if(achados.length===1){ document.getElementById("cod").value = achados[0][0]; }
}

document.getElementById("cod").addEventListener("keydown", (e)=>{ if(e.key==="Enter"){ autoPreencherNome(true); render(); e.target.blur(); } });
document.getElementById("nome").addEventListener("keydown", (e)=>{ if(e.key==="Enter"){ autoPreencherCodigo(); render(); e.target.blur(); } });

// Tabela de estoque na página dedicada — com filtros (código, nome, status).
// Não tem filtro de data: estoque é a foto atual, não tem histórico por dia.
function renderEstoque(){
  const tCod=(document.getElementById("codE").value||"").trim().toLowerCase();
  const tNome=(document.getElementById("nomeE").value||"").trim().toLowerCase();
  const tStatus=document.getElementById("statusE").value;
  const f=ESTOQUE.filter(e=>{
    const cod=(e.id_produto||"").toLowerCase();
    if(tCod!=="" && !(cod===tCod || cod.endsWith(tCod))) return false;
    if(tNome!=="" && !e.produto.toLowerCase().includes(tNome)) return false;
    if(tStatus!=="" && e.ruptura!==tStatus) return false;
    return true;
  });
  document.getElementById("estoquePage").innerHTML = f.length ?
    '<table><thead><tr><th>Código</th><th>Produto</th><th>Setor</th><th>Estoque</th><th>Status</th></tr></thead><tbody>'+
    f.map(e=>'<tr><td>'+e.id_produto+'</td><td>'+e.produto+'</td><td>'+e.setor+'</td><td>'+num(e.estoque)+'</td><td><span class="badge" style="background:'+corRuptura[e.ruptura]+'">'+e.ruptura+'</span></td></tr>').join('')+
    '</tbody></table>' : '<p class="vazio">Nenhum produto com esse filtro.</p>';
  const partes=[];
  if(tCod!=="") partes.push('Código: "'+document.getElementById("codE").value+'"');
  if(tNome!=="") partes.push('Nome: "'+document.getElementById("nomeE").value+'"');
  if(tStatus!=="") partes.push('Status: '+tStatus);
  document.getElementById("estoqueInfo").textContent = (partes.length?partes.join(" · ")+" · ":"")+f.length+" produto(s)";
}
// Enter completa o código (igual em vendas) e aplica.
function autoCodEstoque(finalizar){
  const t=(document.getElementById("codE").value||"").trim().toLowerCase();
  if(t==="") return;
  const achados=PRODUTOS.filter(([cod])=>{const c=cod.toLowerCase();return c===t||c.endsWith(t);});
  if(achados.length===1){ document.getElementById("nomeE").value=achados[0][1]; if(finalizar) document.getElementById("codE").value=achados[0][0]; }
}
function autoNomeEstoque(){
  const t=(document.getElementById("nomeE").value||"").trim().toLowerCase();
  if(t==="") return;
  const achados=PRODUTOS.filter(([,nome])=>nome.toLowerCase()===t);
  if(achados.length===1){ document.getElementById("codE").value=achados[0][0]; }
}
document.getElementById("aplicarE").addEventListener("click", renderEstoque);
document.getElementById("statusE").addEventListener("change", renderEstoque);
document.getElementById("codE").addEventListener("keydown",(e)=>{ if(e.key==="Enter"){ autoCodEstoque(true); renderEstoque(); e.target.blur(); } });
document.getElementById("nomeE").addEventListener("keydown",(e)=>{ if(e.key==="Enter"){ autoNomeEstoque(); renderEstoque(); e.target.blur(); } });
document.getElementById("limparE").addEventListener("click", ()=>{
  document.getElementById("codE").value="";
  document.getElementById("nomeE").value="";
  document.getElementById("statusE").value="";
  renderEstoque();
});
renderEstoque();

// ---- Calendário ----
const MESES=["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
const HOJE=new Date(${JSON.stringify(new Date().getUTCFullYear())},${JSON.stringify(new Date().getUTCMonth())},${JSON.stringify(new Date().getUTCDate())});
let calAno=HOJE.getFullYear(), calMes=HOJE.getMonth(), calView="ano";
let calModo="campanhas"; // "campanhas" ou "operacao"
// O que aparece em cada dia: campanhas OU as tarefas de operação (do Calendário Comercial).
function itensDoDia(a,m,d,dow){
  if(calModo==="operacao"){
    var k=fmtKey(a,m,d);
    return (OPERACAO[k]||[]).map(function(t){ return { nome:t[0], camp:t[1], setor:t[1], alvo:t[2]||"" }; });
  }
  return campanhasDoDia(a,m,d,dow);
}
const ehHojeDmy=(a,m,d)=> d===HOJE.getDate() && m===HOJE.getMonth() && a===HOJE.getFullYear();

// Domingo de Páscoa (algoritmo de Meeus/Butcher) -> Sexta-feira Santa = Páscoa - 2 dias.
function pascoa(ano){
  const a=ano%19, b=Math.floor(ano/100), c=ano%100, d=Math.floor(b/4), e=b%4,
    f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3), h=(19*a+b-d-g+15)%30,
    i=Math.floor(c/4), k=c%4, l=(32+2*e+2*i-h-k)%7, m=Math.floor((a+11*h+22*l)/451),
    mes=Math.floor((h+l-7*m+114)/31), dia=((h+l-7*m+114)%31)+1;
  return new Date(ano,mes-1,dia);
}
const fmtKey=(a,m,d)=> a+"-"+String(m+1).padStart(2,"0")+"-"+String(d).padStart(2,"0");
// Dias em que a LOJA FECHA. Datas fixas + Sexta-feira Santa (móvel).
function feriadosFechado(ano){
  const sexSanta=pascoa(ano); sexSanta.setDate(sexSanta.getDate()-2);
  const m=new Map();
  m.set(fmtKey(ano,0,1),"Ano Novo");
  m.set(fmtKey(sexSanta.getFullYear(),sexSanta.getMonth(),sexSanta.getDate()),"Sexta-feira Santa");
  m.set(fmtKey(ano,4,1),"Dia do Trabalho");
  m.set(fmtKey(ano,11,25),"Natal");
  return m;
}

// Monta a lista de células (dias) de um mês, com os dias vizinhos pra completar as semanas.
function celulasDoMes(ano,mes){
  const inicioSemana=new Date(ano,mes,1).getDay();
  const diasNoMes=new Date(ano,mes+1,0).getDate();
  const mesAntDias=new Date(ano,mes,0).getDate();
  const cels=[];
  for(let i=inicioSemana-1;i>=0;i--) cels.push({dia:mesAntDias-i, fora:true, dow:(inicioSemana-1-i)});
  for(let d=1;d<=diasNoMes;d++) cels.push({dia:d, fora:false, dow:new Date(ano,mes,d).getDay()});
  while(cels.length%7!==0){ const dow=cels.length%7; cels.push({dia:cels.length-diasNoMes-inicioSemana+1, fora:true, dow}); }
  return cels;
}

// Cor de cada setor (usada nas etiquetas de campanha).
const SETOR_COR={ "Geral":"#7048b6", "Açougue":"#c0392b", "Hortifruti":"#1b9e4b", "Mercearia":"#e8a800", "Perfumaria":"#d6336c", "Bebidas":"#2a9d8f", "Bomboniere":"#e8590c" };
const corSetor=(s)=> SETOR_COR[s] || "#566379";

// Campanhas RECORRENTES (valem todo ano). "quando" recebe (ano,mes,dia,dow).
const CAMPANHAS=[
  { nome:"Terçou das Frutas e Verduras", setor:"Hortifruti", quando:(a,m,d,dow)=> dow===2 },
  { nome:"Sexta da Carne", setor:"Açougue", quando:(a,m,d,dow)=> dow===5 },
  { nome:"Sábado Bombástico", setor:"Geral", quando:(a,m,d,dow)=> dow===6 && d>=8 && d<=14 },
  { nome:"Sábado Bombástico (Prorrogado)", setor:"Geral", quando:(a,m,d,dow)=> dow===0 && d>=9 && d<=15 },
  { nome:"Hora da Economia", setor:"Geral", quando:(a,m,d,dow)=> dow===4 && d+7 > new Date(a,m+1,0).getDate() },
];
// Campanhas de DATA ESPECIAL (dia exato de 2026; feriados móveis precisam ajuste em outro ano).
const DATAS_ESPECIAIS=[
  { key:"2026-01-15", nome:"Volta às Aulas", setor:"Mercearia" },
  { key:"2026-02-16", nome:"Carnaval", setor:"Geral" },
  { key:"2026-02-17", nome:"Carnaval", setor:"Geral" },
  { key:"2026-03-08", nome:"Dia da Mulher", setor:"Perfumaria" },
  { key:"2026-03-15", nome:"Dia do Consumidor", setor:"Geral" },
  { key:"2026-04-05", nome:"Páscoa", setor:"Mercearia" },
  { key:"2026-04-21", nome:"Tiradentes", setor:"Geral" },
  { key:"2026-05-10", nome:"Dia das Mães", setor:"Perfumaria" },
  { key:"2026-06-12", nome:"Dia dos Namorados", setor:"Perfumaria" },
  { key:"2026-06-24", nome:"São João", setor:"Mercearia" },
  { key:"2026-06-29", nome:"São Pedro", setor:"Mercearia" },
  { key:"2026-08-09", nome:"Dia dos Pais", setor:"Geral" },
  { key:"2026-10-12", nome:"Dia das Crianças", setor:"Bomboniere" },
  { key:"2026-10-31", nome:"Halloween", setor:"Bomboniere" },
  { key:"2026-11-27", nome:"Black Friday", setor:"Geral" },
  { key:"2026-12-24", nome:"Véspera de Natal", setor:"Mercearia" },
  { key:"2026-12-31", nome:"Réveillon", setor:"Geral" },
];
// Datas ANUAIS (mesmo dia/mês todo ano, independente do ano). mes é 0-11.
const DATAS_ANUAIS=[
  { mes:8, dia:16, nome:"Aniversário Santa Rita", setor:"Geral" }, // 16/09, desde 1988
];
function campanhasDoDia(a,m,d,dow){
  const k=fmtKey(a,m,d);
  const anu=DATAS_ANUAIS.filter(c=>c.mes===m && c.dia===d);         // anuais primeiro
  const esp=DATAS_ESPECIAIS.filter(c=>c.key===k);                   // datas especiais
  const rec=CAMPANHAS.filter(c=>c.quando(a,m,d,dow));
  const usr=campanhasUsuario.filter(function(c){
    if(c.tipo==="semana") return c.dow===dow;
    if(c.tipo==="data"){ if(c.anual){ var p=c.data.split("-"); return (+p[1]-1)===m && (+p[2])===d; } return c.data===k; }
    return false;
  }).map(function(c){ return {nome:c.nome, setor:"Personalizada"}; });
  return [...anu, ...esp, ...rec, ...usr];
}

// Cor única por campanha. Para evitar tons parecidos, usamos DOIS anéis de
// claridade (um mais escuro, um mais claro) e espalhamos os matizes em passos
// de 36°. Assim, mesmo duas campanhas de família próxima (ex.: dois verdes)
// caem em claridades diferentes e ficam fáceis de distinguir.
// O "Prorrogado" herda a mesma cor do "Sábado Bombástico" (é a mesma campanha).
const CAMP_COR=(function(){
  const base=[], visto={};
  CAMPANHAS.concat(DATAS_ESPECIAIS).forEach(function(c){
    if(c.nome==="Sábado Bombástico (Prorrogado)") return;
    if(!visto[c.nome]){ visto[c.nome]=1; base.push(c.nome); }
  });
  const map={};
  base.forEach(function(nome,i){
    const ring=i%2;                 // 0 = escuro, 1 = claro (alterna)
    const k=Math.floor(i/2);        // posição no anel
    const hue=(k*36 + ring*18) % 360;
    const lum=ring===0?44:63;
    const sat=ring===0?72:62;
    map[nome]="hsl("+hue+","+sat+"%,"+lum+"%)";
  });
  // Cores fixas escolhidas manualmente (sobrepõem o automático).
  const FIXAS={
    "Terçou das Frutas e Verduras":"#1b9e4b",   // verde
    "Sexta da Carne":"#e60000",                 // vermelho vivo
    "Sábado Bombástico":"#f1c40f",              // amarelo
    "Hora da Economia":"#0a6cff",               // azul vivo
    // --- datas comemorativas (segunda seção) — versão mais viva ---
    "Volta às Aulas":"#A4D400",
    "Carnaval":"#D4A017",
    "Dia da Mulher":"#D1006C",
    "Dia do Consumidor":"#00C2A8",
    "Páscoa":"#74411F",
    "Tiradentes":"#495057",
    "Dia das Mães":"#FF5C8A",
    "Dia dos Namorados":"#5F0F99",
    "São João":"#C8642F",
    "São Pedro":"#3F37C9",
    "Dia dos Pais":"#C026D3",
    "Dia das Crianças":"#00B4D8",
    "Halloween":"#FF7518",
    "Black Friday":"#111111",
    "Véspera de Natal":"#006400",
    "Réveillon":"#ADB5BD",
    "Aniversário Santa Rita":"#A78BFA",
  };
  Object.keys(FIXAS).forEach(function(k){ map[k]=FIXAS[k]; });
  map["Sábado Bombástico (Prorrogado)"]=map["Sábado Bombástico"];
  return map;
})();
// Campanhas criadas pelo usuário (salvas no navegador, via "Adicionar campanha").
var campanhasUsuario = (function(){ try{ return JSON.parse(localStorage.getItem("calendario_campanhas")||"[]"); }catch(e){ return []; } })();
function salvarCampUser(){ try{ localStorage.setItem("calendario_campanhas", JSON.stringify(campanhasUsuario)); }catch(e){} }
var USER_COR={};
function rebuildUserCor(){ USER_COR={}; campanhasUsuario.forEach(function(c){ USER_COR[c.nome]=c.cor; }); }
rebuildUserCor();
// Etapas do Calendário de Operação (cor de cada uma).
const OP_STEPS=["Análise de produto","Reunião de compras","Negociação","Aprovação","Pedido","Recebimento","Encarte","Divulgação da campanha","Montagem","Divulgação do encarte"];
const OP_STEP_COR={ "Análise de produto":"#343a40","Reunião de compras":"#1c7ed6","Negociação":"#6741d9","Aprovação":"#2f9e44","Pedido":"#e8590c","Recebimento":"#8a5a2b","Encarte":"#0c8599","Divulgação da campanha":"#e64980","Montagem":"#f0b400","Divulgação do encarte":"#c2255c" };
const corCampanha=(nome)=> USER_COR[nome] || CAMP_COR[nome] || OP_STEP_COR[nome] || "#566379";

// Campanha destacada ao clicar na legenda (null = nenhuma).
// Pode ser o nome de uma campanha ou os tokens especiais "__hoje__" / "__fechado__".
let destaque=null;
function ehMatch(ehHoje,motivo,camps){
  if(!destaque) return false;
  if(destaque==="__hoje__") return !!ehHoje;
  if(destaque==="__fechado__") return !!motivo;
  return camps.some(cp=>cp.nome===destaque);
}

function montarLegendas(){
  function montar(lista){
    const nomes=[], vistos={};
    lista.forEach(function(c){
      if(!vistos[c.nome]){ vistos[c.nome]=1; nomes.push(c); }
    });
    return nomes.map(function(c){
      return '<span class="leg-item" data-camp="'+c.nome+'"><span class="qd" style="background:'+corCampanha(c.nome)+'"></span> '+c.nome+'</span>';
    }).join("");
  }
  const box=document.getElementById("calLegSetores");
  const box2=document.getElementById("calLegDatas");
  const box3=document.getElementById("calLegUser");
  if(calModo==="operacao"){
    // Modo Operação: legenda com as etapas (Negociação, Pedido, ...).
    if(box){ box.style.display=""; box.innerHTML=montar(OP_STEPS.map(function(s){ return {nome:s}; })); }
    if(box2) box2.style.display="none";
    if(box3) box3.style.display="none";
    return;
  }
  // Modo Campanhas
  // Grupo 1: promoções recorrentes do mercado.
  if(box){ box.style.display=""; box.innerHTML=montar(CAMPANHAS); }
  // Grupo 2: datas comemorativas (separado por linha; some quando vazio).
  if(box2){
    const lista2=DATAS_ANUAIS.concat(DATAS_ESPECIAIS);
    if(lista2.length){ box2.style.display=""; box2.innerHTML=montar(lista2); }
    else { box2.style.display="none"; }
  }
  // Grupo 3: campanhas que VOCÊ adicionou (some quando vazio).
  if(box3){
    if(campanhasUsuario.length){ box3.style.display=""; box3.innerHTML=montar(campanhasUsuario); }
    else { box3.style.display="none"; box3.innerHTML=""; }
  }
}
montarLegendas();

function renderMes(){
  document.getElementById("calTitulo").textContent=MESES[calMes]+" "+calAno;
  const fech=feriadosFechado(calAno);
  document.getElementById("calDias").innerHTML=celulasDoMes(calAno,calMes).map(c=>{
    const ehHoje=!c.fora && ehHojeDmy(calAno,calMes,c.dia);
    const fds=(c.dow===0||c.dow===6);
    const motivo=!c.fora ? fech.get(fmtKey(calAno,calMes,c.dia)) : null;
    const camps=!c.fora ? itensDoDia(calAno,calMes,c.dia,c.dow) : [];
    const match=ehMatch(ehHoje,motivo,camps);
    const dim=destaque && !match && !c.fora;
    const cls="cal-cell"+(c.fora?" fora":"")+(fds?" fds":"")+(ehHoje?" hoje":"")+(motivo?" fechado":"")+(match?" destacado":"")+(dim?" atenuado":"");
    const tag=motivo ? '<span class="fechado-tag">Fechado · '+motivo+'</span>' : '';
    const chips=camps.map(cp=>{ var alvoTxt=cp.alvo ? (' → '+cp.alvo.slice(8,10)+'/'+cp.alvo.slice(5,7)) : ''; var txt=cp.camp ? (cp.nome+': '+cp.camp+alvoTxt) : cp.nome; var ttl=cp.camp ? (cp.nome+' · '+cp.camp+(cp.alvo?(' · campanha em '+cp.alvo.split("-").reverse().join("/")):'')) : (cp.nome+' · '+cp.setor); return '<span class="camp" style="background:'+corCampanha(cp.nome)+'" title="'+ttl+'">'+txt+'</span>'; }).join('');
    return '<div class="'+cls+'"><span class="dia">'+c.dia+'</span>'+tag+chips+'</div>';
  }).join('');
}

function renderAno(){
  document.getElementById("calTitulo").textContent=String(calAno);
  const cabec=["D","S","T","Q","Q","S","S"].map(x=>'<div class="mh">'+x+'</div>').join('');
  const fech=feriadosFechado(calAno);
  let html="";
  for(let m=0;m<12;m++){
    const dias=celulasDoMes(calAno,m).map(c=>{
      const ehHoje=!c.fora && ehHojeDmy(calAno,m,c.dia);
      const fds=(c.dow===0||c.dow===6);
      const motivo=!c.fora ? fech.get(fmtKey(calAno,m,c.dia)) : null;
      const camps=!c.fora ? itensDoDia(calAno,m,c.dia,c.dow) : [];
      // O fundo colorido (estilo B) só vale quando NÃO é hoje nem dia fechado (esses já têm cor própria).
      const pinta=camps.length && !ehHoje && !motivo;
      const match=ehMatch(ehHoje,motivo,camps);
      const dim=destaque && !match && !c.fora;
      const cls="mini-cell"+(c.fora?" fora":"")+(fds?" fds":"")+(ehHoje?" hoje":"")+(motivo?" fechado":"")+(pinta?" tem-camp":"")+(match?" destacado":"")+(dim?" atenuado":"");
      const ttl=motivo ? 'Fechado · '+motivo : (camps.length ? camps.map(x=>x.camp?(x.nome+": "+x.camp+(x.alvo?(" ("+x.alvo.slice(8,10)+"/"+x.alvo.slice(5,7)+")"):"")):x.nome).join(", ") : "");
      const sty=pinta ? ' style="background:'+corCampanha(camps[0].nome)+'"' : '';
      return '<div class="'+cls+'"'+sty+(ttl?' title="'+ttl+'"':'')+'>'+c.dia+'</div>';
    }).join('');
    html+='<div class="mini" data-mes="'+m+'"><h3>'+MESES[m]+'</h3><div class="mini-grid">'+cabec+dias+'</div></div>';
  }
  const cont=document.getElementById("calAnoView");
  cont.className="cal-ano";
  cont.innerHTML=html;
  // clicar num mês abre ele no modo Mês
  cont.querySelectorAll(".mini").forEach(el=>el.addEventListener("click",()=>{ calMes=+el.dataset.mes; setView("mes"); }));
}

function renderCal(){ if(calView==="mes") renderMes(); else renderAno(); }

function setView(v){
  calView=v;
  document.getElementById("viewMes").classList.toggle("ativo", v==="mes");
  document.getElementById("viewAno").classList.toggle("ativo", v==="ano");
  document.getElementById("calMesView").style.display = v==="mes" ? "" : "none";
  document.getElementById("calAnoView").style.display = v==="ano" ? "" : "none";
  renderCal();
}

document.getElementById("viewMes").addEventListener("click",()=>setView("mes"));
document.getElementById("viewAno").addEventListener("click",()=>setView("ano"));
function setModo(m){
  calModo=m;
  document.getElementById("modoCamp").classList.toggle("ativo", m==="campanhas");
  document.getElementById("modoOper").classList.toggle("ativo", m==="operacao");
  destaque=null;
  montarLegendas(); marcarLegenda(); renderCal();
}
document.getElementById("modoCamp").addEventListener("click",()=>setModo("campanhas"));
document.getElementById("modoOper").addEventListener("click",()=>setModo("operacao"));
document.getElementById("calPrev").addEventListener("click",()=>{
  if(calView==="ano"){ calAno--; } else { calMes--; if(calMes<0){calMes=11;calAno--;} }
  renderCal();
});
document.getElementById("calNext").addEventListener("click",()=>{
  if(calView==="ano"){ calAno++; } else { calMes++; if(calMes>11){calMes=0;calAno++;} }
  renderCal();
});
document.getElementById("calHoje").addEventListener("click",()=>{ calAno=HOJE.getFullYear(); calMes=HOJE.getMonth(); setView("mes"); });

// Clicar numa campanha da legenda destaca os dias dela no calendário.
function campanhaNoMes(nome,ano,mes){
  if(nome==="__hoje__") return ano===HOJE.getFullYear() && mes===HOJE.getMonth();
  if(nome==="__fechado__"){
    const f=feriadosFechado(ano), pref=ano+"-"+String(mes+1).padStart(2,"0");
    for(const k of f.keys()){ if(k.indexOf(pref)===0) return true; }
    return false;
  }
  const ult=new Date(ano,mes+1,0).getDate();
  for(let d=1;d<=ult;d++){ const dow=new Date(ano,mes,d).getDay(); if(itensDoDia(ano,mes,d,dow).some(c=>c.nome===nome)) return true; }
  return false;
}
function primeiroMesComCampanha(nome,ano){
  for(let m=0;m<12;m++){ if(campanhaNoMes(nome,ano,m)) return m; }
  return -1;
}
function marcarLegenda(){
  document.querySelectorAll(".leg-item").forEach(el=>{
    el.classList.toggle("sel", destaque!==null && el.dataset.camp===destaque);
  });
}
// Delegação: funciona também pras campanhas adicionadas depois (legenda recriada).
document.addEventListener("click",function(e){
  const el=e.target.closest(".leg-item");
  if(!el) return;
  const nome=el.dataset.camp;
  destaque=(destaque===nome)?null:nome;
  // Na visão Mês, se a campanha não acontece no mês atual, pula pro primeiro que tem.
  if(destaque && calView==="mes" && !campanhaNoMes(destaque,calAno,calMes)){
    const m=primeiroMesComCampanha(destaque,calAno);
    if(m>=0) calMes=m;
  }
  marcarLegenda();
  renderCal();
  // Rola a tela até o primeiro dia destacado pra ele aparecer.
  if(destaque){
    const alvo=document.querySelector((calView==="mes"?"#calDias":"#calAnoView")+" .destacado");
    if(alvo) alvo.scrollIntoView({behavior:"smooth", block:"center"});
  }
});
setView(calView);

// ---- Adicionar campanha (calendário) ----
function ccRenderLista(){
  var box=document.getElementById("ccLista"); if(!box) return;
  if(!campanhasUsuario.length){ box.innerHTML='<p style="color:#8a97a8;font-size:13px;margin:4px 0;">Você ainda não adicionou nenhuma campanha.</p>'; return; }
  var diasSem=["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
  box.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:13px;">'+
    campanhasUsuario.map(function(c){
      var quando = c.tipo==="semana" ? ("Toda "+diasSem[c.dow]) : (c.data.split("-").reverse().join("/")+(c.anual?" (todo ano)":""));
      return '<tr style="border-bottom:1px solid #eef2f6;"><td style="padding:6px 4px;"><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:'+c.cor+';vertical-align:middle;margin-right:7px;"></span>'+pxEsc(c.nome)+'</td><td style="padding:6px 4px;color:#6b7787;">'+quando+'</td><td style="padding:6px 4px;text-align:right;"><span data-ccdel="'+c.id+'" style="color:#c0392b;cursor:pointer;font-weight:700;">excluir</span></td></tr>';
    }).join('')+'</table>';
}
function ccUid(){ return "c"+HOJE.getTime()+Math.floor(performance.now()*1000)+campanhasUsuario.length; }
(function(){
  var tipo=document.getElementById("ccTipo"); if(!tipo) return;
  tipo.addEventListener("change",function(){
    var dataBox=document.getElementById("ccDataBox"), semBox=document.getElementById("ccSemanaBox");
    if(tipo.value==="semana"){ dataBox.style.display="none"; semBox.style.display=""; }
    else { dataBox.style.display=""; semBox.style.display="none"; }
  });
  document.getElementById("ccAdd").addEventListener("click",function(){
    var nome=document.getElementById("ccNome").value.trim();
    var cor=document.getElementById("ccCor").value;
    var t=document.getElementById("ccTipo").value;
    var msg=document.getElementById("ccMsg");
    function erro(x){ msg.textContent=x; msg.style.display="block"; }
    if(!nome){ return erro("Digite o nome da campanha."); }
    var nova={ id:ccUid(), nome:nome, cor:cor, tipo:t };
    if(t==="semana"){ nova.dow=parseInt(document.getElementById("ccDow").value,10); }
    else {
      var data=document.getElementById("ccData").value;
      if(!/^\\d{4}-\\d{2}-\\d{2}\$/.test(data)){ return erro("Escolha a data da campanha."); }
      nova.data=data; nova.anual=document.getElementById("ccAnual").checked;
    }
    campanhasUsuario.push(nova);
    salvarCampUser(); rebuildUserCor(); montarLegendas(); renderCal(); ccRenderLista();
    document.getElementById("ccNome").value=""; msg.style.display="none";
  });
  document.getElementById("ccLista").addEventListener("click",function(e){
    var d=e.target.closest("[data-ccdel]"); if(!d) return;
    var alvo=campanhasUsuario.find(function(c){ return c.id===d.dataset.ccdel; });
    uiConfirm({titulo:"Excluir campanha",msg:"Remover a campanha '"+((alvo&&alvo.nome)||"")+"'?",ok:"Remover",cancel:"Cancelar"}).then(function(sim){
      if(!sim) return;
      campanhasUsuario=campanhasUsuario.filter(function(c){ return c.id!==d.dataset.ccdel; });
      salvarCampUser(); rebuildUserCor(); montarLegendas(); renderCal(); ccRenderLista();
    });
  });
  ccRenderLista();
})();

// ---- Escala de trabalho (editável, salva no navegador) ----
const ESCALA_ROSTER = ${JSON.stringify(escalaRoster)};
const OPERACAO = ${JSON.stringify(operacaoSeed)};
const LOGO_URI = ${JSON.stringify(logoDataUri)};
const DOW_PT = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
let escAno = HOJE.getFullYear(), escMes = HOJE.getMonth();

function ensureIds(arr){ arr.forEach((r,i)=>{ if(r.id==null) r.id="r"+i; }); return arr; }

// ---- Rodízio de domingos (deduzido da escala real de referência) ----
// Mulheres: 2 times (A/B) revezando 1 domingo sim / 1 não.
// Homens: 3 times (0/1/2) trabalhando 2 domingos seguidos e folgando o 3º.
// O sistema não guarda os domingos de cada mês: ele CALCULA a partir de um
// domingo de referência, contando quantos domingos se passaram.
const DOM_ROT_SEED = {r0:"A",r1:"A",r2:"A",r3:"A",r4:"A",r5:"A",r6:"A",r7:"B",r8:"B",r9:"B",r10:"B",r11:"B",r12:"B",r13:"B",r14:2,r15:2,r16:0,r17:0,r18:1,r19:1,r20:2,r21:2,r22:2,r23:2,r24:0,r25:0,r26:0,r27:0,r28:1,r29:1,r30:1,r31:1};
const DOM_ANCHOR = new Date(2026,4,3,0,0,0,0); // 1º domingo de referência: 03/05/2026 (Time A folga, Time B trabalha)
function ehMulher(r){ return /Femin/i.test((r&&r.grupo)||""); }
function attachDomRot(arr){
  arr.forEach(function(r){
    if(r.domRot!=null && r.domRot!=="") return;
    if(DOM_ROT_SEED[r.id]!=null){ r.domRot=DOM_ROT_SEED[r.id]; return; }
    // pessoa nova: distribui pra equilibrar os times
    if(ehMulher(r)){
      let a=0,b=0; arr.forEach(function(x){ if(ehMulher(x)){ if(x.domRot==="A")a++; else if(x.domRot==="B")b++; } });
      r.domRot = a<=b?"A":"B";
    } else {
      const c=[0,0,0]; arr.forEach(function(x){ if(!ehMulher(x)&&typeof x.domRot==="number") c[x.domRot]++; });
      let m=0; if(c[1]<c[m])m=1; if(c[2]<c[m])m=2; r.domRot=m;
    }
  });
  return arr;
}
function modp(a,n){ return ((a%n)+n)%n; }
function domIndex(dt){ return Math.round((new Date(dt.getFullYear(),dt.getMonth(),dt.getDate())-DOM_ANCHOR)/(7*86400000)); }
function domTrabalha(r,dt){
  if(!r) return true;
  const k=domIndex(dt);
  if(r.domRot==="A"||r.domRot==="B"){ const folgaPar = (r.domRot==="A")?0:1; return modp(k,2)!==folgaPar; }
  if(typeof r.domRot==="string" && r.domRot.charAt(0)==="U"){ return modp(k,3)===(+r.domRot.slice(1)); } // trabalha 1 de 3 domingos
  const f=(typeof r.domRot==="number")?r.domRot:0; return modp(k,3)!==f;
}

const ROSTER_VER = 8;
function loadRoster(){
  try {
    const s=localStorage.getItem("escala_roster");
    if(s){
      const o=JSON.parse(s);
      if(o && o.ver===ROSTER_VER && Array.isArray(o.lista)) return attachDomRot(ensureIds(o.lista));
      // versão antiga (ou formato antigo em array): restaura a estrutura padrão da
      // planilha (14 femininos + 6 caixas + 12 embaladores). Ignora a lista antiga.
      return attachDomRot(ensureIds(ESCALA_ROSTER.map(x=>Object.assign({},x))));
    }
  } catch(e){}
  return attachDomRot(ensureIds(ESCALA_ROSTER.map(x=>Object.assign({},x))));
}
let roster = loadRoster();
function saveRoster(){ try{ localStorage.setItem("escala_roster", JSON.stringify({ver:ROSTER_VER,lista:roster})); }catch(e){} }
saveRoster();
function escKey(){ return "escala_"+escAno+"_"+escMes; }
let escDados = {};
function loadMes(){ try{ const s=localStorage.getItem(escKey()); escDados = s?JSON.parse(s):{}; }catch(e){ escDados={}; } }
function saveMes(){ try{ localStorage.setItem(escKey(), JSON.stringify(escDados)); }catch(e){} }
function diasDoMes(a,m){ return new Date(a,m+1,0).getDate(); }

// Valor de uma célula: usa o que foi editado; senão, padrão = Folga no dia de
// folga fixa, T.1 nos outros dias.
function valorCelula(id,dia){
  const ov = escDados[id] && escDados[id][dia];
  const dt = new Date(escAno,escMes,dia), dow = dt.getDay();
  const r = roster.find(x=>x.id===id);
  if(dow===0){
    // domingo só pode ser T.2 (trabalha) ou Folga; ignora valores antigos inválidos (ex.: T.1)
    if(ov==="T.2"||ov==="Folga") return ov;
    return domTrabalha(r,dt) ? "T.2" : "Folga"; // rodízio automático
  }
  if(ov) return ov;
  return DOW_PT[dow]===(r&&r.folga) ? "Folga" : "T.1";
}
function setCelula(id,dia,val){ if(!escDados[id]) escDados[id]={}; escDados[id][dia]=val; saveMes(); }

// ---- Setores da escala (cada setor agrupa os grupos de funcionários dele) ----
const ESC_SETORES = [
  { nome:"Frente de Loja", grupos:["Caixas Femininos","Caixas Masculino","Embaladores Masculinos"], icone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>' },
  { nome:"Abastecedor", grupos:["Abastecedores"], icone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="13" width="7" height="7" rx="1"/><rect x="14" y="13" width="7" height="7" rx="1"/><rect x="8.5" y="3.5" width="7" height="7" rx="1"/></svg>' },
  { nome:"Açougue", grupos:["Açougue"], icone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h11a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3z"/><path d="M15 8h4a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-4"/><path d="M3 19h13"/></svg>' }
];
let escSetorAtual = null;

function renderEscalaHub(){
  let html='<div class="esc-hub-tit">Escala de Trabalho — escolha o setor</div><div class="esc-hub">';
  ESC_SETORES.forEach(function(s){
    var nv = roster.filter(function(r){ return s.grupos.indexOf(r.grupo)>=0; }).length;
    var pessoas = roster.filter(function(r){ return s.grupos.indexOf(r.grupo)>=0 && r.nome!=="(vaga)"; }).length;
    var vagas = nv - pessoas;
    var sub = nv ? (pessoas+" funcionário"+(pessoas!==1?"s":"")+(vagas>0?(" · "+vagas+" vaga"+(vagas!==1?"s":"")):"")) : "Nenhum cadastrado ainda";
    html+='<div class="esc-setor" data-setor="'+s.nome+'"><div class="ic">'+s.icone+'</div><div><div class="nm">'+s.nome+'</div><div class="qt">'+sub+'</div></div></div>';
  });
  html+='</div>';
  document.getElementById("escHub").innerHTML=html;
}
function abrirSetor(nome){
  escSetorAtual=nome;
  document.getElementById("escHub").style.display="none";
  document.getElementById("escDetalhe").style.display="";
  escAno=HOJE.getFullYear(); escMes=HOJE.getMonth();
  renderEscala();
  window.scrollTo(0,0);
}
function voltarSetores(){
  escSetorAtual=null;
  document.getElementById("escDetalhe").style.display="none";
  document.getElementById("escHub").style.display="";
  renderEscalaHub();
}

function renderEscala(){
  var setor = ESC_SETORES.filter(function(s){ return s.nome===escSetorAtual; })[0];
  if(!setor) return;
  document.getElementById("escTitulo").textContent = MESES[escMes]+" "+escAno;
  document.getElementById("escPrintTitulo").textContent = "Escala — "+setor.nome+" — "+MESES[escMes]+" "+escAno;
  const _hj=new Date();
  document.getElementById("escPrintData").textContent = "Supermercado Santa Rita · impresso em "+("0"+_hj.getDate()).slice(-2)+"/"+("0"+(_hj.getMonth()+1)).slice(-2)+"/"+_hj.getFullYear();
  loadMes();
  const nd = diasDoMes(escAno,escMes);
  const grupos = setor.grupos.filter(function(g){ return roster.some(function(r){ return r.grupo===g; }); });
  let html="";
  if(grupos.length===0){
    document.getElementById("escGrade").innerHTML='<div style="padding:48px 24px;text-align:center;color:#8a97a8;font-size:15px;line-height:1.7;">Nenhum funcionário cadastrado no setor <b>'+setor.nome+'</b> ainda.<br><span style="font-size:13px;">É só me mandar os nomes e folgas que eu monto a escala deste setor.</span></div>';
    return;
  }
  grupos.forEach(g=>{
    let head='<tr><th class="nome">Funcionário</th><th>Folga</th>';
    for(let d=1; d<=nd; d++){
      const dow=new Date(escAno,escMes,d).getDay();
      head+='<th class="'+(dow===0?"dom":"")+'">'+d+'<br><span style="font-weight:400;color:#8a97a8">'+DOW_PT[dow]+'</span></th>';
    }
    head+='</tr>';
    let body="";
    roster.forEach(r=>{
      if(r.grupo!==g) return;
      let cels="";
      for(let d=1; d<=nd; d++){
        const dow=new Date(escAno,escMes,d).getDay();
        const v=valorCelula(r.id,d);
        const cls="cel "+(v==="T.1"?"cel-t1":v==="T.2"?"cel-t2":"cel-folga")+(dow===0?" dom":"");
        cels+='<td class="'+cls+'" data-id="'+r.id+'" data-dia="'+d+'">'+v+'</td>';
      }
      const nm=r.nome+(r.enc?' <span class="esc-enc">('+r.enc+')</span>':"");
      body+='<tr><td class="nome"><span class="esc-nome" data-edit="'+r.id+'">'+nm+'</span></td><td>'+r.folga+'</td>'+cels+'</tr>';
    });
    html+='<div class="esc-grupo">'+g+'</div><div class="esc-scroll"><table class="esc"><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>';
  });
  document.getElementById("escGrade").innerHTML=html;
}

document.getElementById("escGrade").addEventListener("click", (e)=>{
  // As células da escala NÃO são editáveis: o sistema já gera tudo automaticamente.
  // Só o nome do funcionário pode ser alterado — edição direto na célula (inline).
  const ed=e.target.closest("[data-edit]");
  if(ed){
    if(ed.querySelector("input")) return; // já está editando esta vaga
    const id=ed.dataset.edit, r=roster.find(x=>x.id===id);
    const inp=document.createElement("input");
    inp.type="text"; inp.className="esc-nome-input";
    inp.value = (r.nome==="(vaga)") ? "" : r.nome;
    inp.placeholder = "Nome do funcionário (vazio = vaga aberta)";
    ed.innerHTML=""; ed.appendChild(inp);
    inp.focus(); inp.select();
    let feito=false;
    const commit=(salvar)=>{ if(feito) return; feito=true; if(salvar){ r.nome=inp.value.trim()||"(vaga)"; saveRoster(); } renderEscala(); };
    inp.addEventListener("keydown",(ev)=>{ if(ev.key==="Enter"){ ev.preventDefault(); commit(true); } else if(ev.key==="Escape"){ ev.preventDefault(); commit(false); } });
    inp.addEventListener("blur",()=>commit(true));
    return;
  }
});

document.getElementById("escPrev").addEventListener("click",()=>{ escMes--; if(escMes<0){escMes=11;escAno--;} renderEscala(); });
document.getElementById("escNext").addEventListener("click",()=>{ escMes++; if(escMes>11){escMes=0;escAno++;} renderEscala(); });
document.getElementById("escHoje").addEventListener("click",()=>{ escAno=HOJE.getFullYear(); escMes=HOJE.getMonth(); renderEscala(); });
document.getElementById("escImprimir").addEventListener("click",()=>window.print());
document.getElementById("escHub").addEventListener("click",(e)=>{ const c=e.target.closest("[data-setor]"); if(c) abrirSetor(c.dataset.setor); });
document.getElementById("escVoltar").addEventListener("click",voltarSetores);
renderEscalaHub();

// ---- Pontos extras de gôndola (alugados a fornecedores) ----
// Pré-carregado da planilha; tudo editável e salvo no navegador.
const PONTOS_SEED = ${JSON.stringify(pontosSeed)};
// Cada ponto tem um valor fixo de aluguel de acordo com o seu número (vem da planilha).
const VALOR_FIXO = (function(){ const m={}; PONTOS_SEED.forEach(function(p){ if(p.valor>0) m[String(p.numero)]=p.valor; }); return m; })();
function loadPontosG(){
  try{ const s=localStorage.getItem("pontos_gondola"); if(s) return JSON.parse(s); }catch(e){}
  return PONTOS_SEED.map((x,i)=>Object.assign({id:"pg"+i}, x));
}
let pontosG = loadPontosG();
function savePontosG(){ try{ localStorage.setItem("pontos_gondola", JSON.stringify(pontosG)); }catch(e){} }
let pxEditId = null;

// Layout do mapa (planta da loja) — usado já no primeiro render dos pontos.
const MAPA_GRUPOS = [
  { topo:[1,2,3,4,5],     base:[6,7,8,9,10] },
  { topo:[11,12,13,14,15], base:[16,17,18,19,20] }
];
const MAPA_SETAS = [2,4]; // colunas (1 a 5) onde ficam as setas de entrada
let mapaSel = null;
let mapaEdit = false; // modo de edição de preços (só admin)

function pxParseData(s){
  if(!s || !/^\\d{4}-\\d{2}-\\d{2}\$/.test(s)) return null;
  const d=new Date(s+"T00:00:00"); return isNaN(d.getTime()) ? null : d;
}
function pxFmtData(s){
  if(!s) return "";
  if(/^\\d{4}-\\d{2}-\\d{2}\$/.test(s)) return s.split("-").reverse().join("/");
  return s; // datas livres como "30/02/2026" ficam como estão
}
// Ano-mês atual no formato "YYYY-MM" (base do status mensal).
function pxAnoMesAtual(){ return HOJE.getFullYear()+"-"+("0"+(HOJE.getMonth()+1)).slice(-2); }
// PAGO se houver comprovante anexado para a cobrança DESTE mês; vira NÃO PAGO sozinho quando o mês muda.
// Uma parcela está QUITADA se: tem comprovante, OU pagamento manual AUTORIZADO, OU (futuro) confirmado pelo banco.
function pxQuitado(p,key){
  const comps=p.comprovantes||{};
  const man=p.manuais||{};
  return !!comps[key] || man[key]==="autorizado";
}
function pxPagoMes(p){
  const ym=pxAnoMesAtual();
  return pxAgenda(p).some(d=>{ const k=pxDateKey(d); return k.indexOf(ym)===0 && pxQuitado(p,k); })
    || Object.keys(p.comprovantes||{}).some(k=>k.indexOf(ym)===0);
}
// ATRASADO = existe parcela vencida (data já passou) e ainda não quitada.
function pxAtrasado(p){
  const hoje=new Date(HOJE.getFullYear(),HOJE.getMonth(),HOJE.getDate());
  return pxAgenda(p).some(d=> d<hoje && !pxQuitado(p, pxDateKey(d)));
}
// Detalhe da inadimplência: nº de parcelas vencidas/não pagas, valor devido e desde quando.
function pxInadimplencia(p){
  const hoje=new Date(HOJE.getFullYear(),HOJE.getMonth(),HOJE.getDate());
  let n=0, desde=null;
  pxAgenda(p).forEach(function(d){ if(d<hoje && !pxQuitado(p, pxDateKey(d))){ n++; if(!desde||d<desde) desde=d; } });
  if(!n) return null;
  return { n:n, valor:n*(+p.valor||0), desde:desde, dias:Math.floor((hoje-desde)/86400000) };
}
// Aviso no menu: nº de inadimplentes + pagamentos aguardando autorização.
function pxAtualizaBadge(){
  const el=document.getElementById("pxNavBadge"); if(!el) return;
  let inad=0, pend=0;
  pontosG.forEach(function(p){
    if(pxInadimplencia(p)) inad++;
    const man=p.manuais||{};
    Object.keys(man).forEach(function(k){ if(man[k]==="pendente") pend++; });
  });
  const tot=inad+pend;
  if(tot>0){ el.style.display=""; el.textContent=tot; el.title=inad+" inadimplente(s)"+(pend?" + "+pend+" aguardando autorização":""); }
  else { el.style.display="none"; }
}
function pxStatusMes(p){ return pxAtrasado(p) ? "ATRASADO" : (pxPagoMes(p)?"PAGO":"NÃO PAGO"); }
function pxBadge(p){
  const st = pxStatusMes(p);
  const cor = st==="PAGO" ? "#1b9e4b" : st==="ATRASADO" ? "#c0392b" : "#e8a800";
  const ic = st==="PAGO"
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'
    : st==="ATRASADO"
    ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>'
    : '';
  const tit = st==="ATRASADO" ? "Há parcela vencida e não paga" : st==="PAGO" ? "Mês atual quitado" : "Sem parcela vencida ainda";
  const txt = st==="NÃO PAGO" ? "EM ABERTO" : st;
  return '<span class="badge badge-status" style="background:'+cor+'" title="'+tit+'">'+ic+txt+'</span>';
}
function pxDetItem(label,val){ return '<div class="px-det-item"><b>'+label+'</b><span>'+val+'</span></div>'; }
function pxFmtTel(v){
  const d=(v||"").replace(/\\D/g,"").slice(0,11);
  if(!d) return "";
  if(d.length<=2) return "("+d;
  if(d.length<=6) return "("+d.slice(0,2)+") "+d.slice(2);
  if(d.length<=10) return "("+d.slice(0,2)+") "+d.slice(2,6)+"-"+d.slice(6);
  return "("+d.slice(0,2)+") "+d.slice(2,7)+"-"+d.slice(7);
}
function pxFmtDataD(d){ return ("0"+d.getDate()).slice(-2)+"/"+("0"+(d.getMonth()+1)).slice(-2)+"/"+d.getFullYear(); }
function pxDataChip(d){
  const meses=["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  const dias=["dom","seg","ter","qua","qui","sex","sáb"];
  return '<span class="px-data"><span class="px-data-dia">'+("0"+d.getDate()).slice(-2)+'</span>'+
    '<span class="px-data-my"><span class="px-data-mes">'+meses[d.getMonth()]+' '+d.getFullYear()+'</span>'+
    '<span class="px-data-sem">'+dias[d.getDay()]+'</span></span></span>';
}
// Gera as datas de cobrança: todo dia da assinatura, da assinatura até o vencimento do contrato.
function pxAgenda(p){
  const ini=pxParseData(p.abertura), fim=pxParseData(p.vencimento);
  if(!ini || !fim || fim<ini) return [];
  const dia=ini.getDate();
  const datas=[];
  let y=ini.getFullYear(), m=ini.getMonth();
  for(let i=0;i<360;i++){
    const ultimo=new Date(y,m+1,0).getDate();
    const d=new Date(y,m,Math.min(dia,ultimo));
    if(d>=fim) break;
    if(d>=ini) datas.push(d);
    m++; if(m>11){ m=0; y++; }
  }
  return datas;
}
function pxAgendaHtml(p){
  const ag=pxAgenda(p);
  if(!ag.length) return '<div class="px-agenda-vazia">Informe a abertura e o vencimento do contrato para ver o calendário de cobranças.</div>';
  const hoje=new Date(HOJE.getFullYear(),HOJE.getMonth(),HOJE.getDate());
  const comps=p.comprovantes||{};
  const linhas=ag.map((d,i)=>{
    const passou = d<hoje ? ' style="color:#9aa6b2;"' : '';
    const key=pxDateKey(d);
    const ref=p.id+"|"+key;
    const c=comps[key];
    const cell = c
      ? '<a href="#" class="px-comp-link" data-compview="'+ref+'" title="Ver comprovante"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg><span>comprovante</span></a>'+
        '<button type="button" class="px-comp-x" data-comprem="'+ref+'" title="Remover comprovante">✕</button>'
      : '<button type="button" class="px-comp-add" data-compfile-btn="'+ref+'">Anexar</button>'+
        '<input type="file" data-compfile="'+ref+'" accept="application/pdf,image/*" style="display:none;">';
    const man=(p.manuais||{})[key];
    const quit = pxQuitado(p,key);
    const pixCell = quit
      ? '<span class="px-quitado" title="Mensalidade quitada"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>'+(man==="autorizado"?"Pago (autorizado)":"Quitado")+'</span>'+(man==="autorizado"?' <button type="button" class="px-rec" data-desfazerpago="'+ref+'" title="Desfazer pagamento (precisa senha master)">✕</button>':'')
      : man==="pendente"
      ? '<span class="px-aguard" title="Aguardando autorização do administrador">⏳ Aguardando</span> <button type="button" class="px-aut" data-autorizar="'+ref+'">Autorizar</button> <button type="button" class="px-rec" data-recusar="'+ref+'" title="Recusar">✕</button>'
      : '<button type="button" class="px-pix-btn" data-pix="'+ref+'">Gerar Pix</button> <button type="button" class="px-mark" data-marcarpago="'+ref+'" title="Registrar pagamento feito por fora (precisa autorização do master)">Marcar pago</button>';
    return '<tr'+passou+'><td>'+(i+1)+'</td><td>'+pxDataChip(d)+'</td><td>'+brl(p.valor||0)+'</td><td class="px-pix-cell">'+pixCell+'</td><td class="px-comp-cell">'+cell+'</td></tr>';
  }).join("");
  return '<div class="px-agenda"><div class="px-agenda-tit">Calendário de cobranças — '+ag.length+' parcela(s), todo dia '+ag[0].getDate()+'</div>'+
    '<table class="px-agenda-tb"><thead><tr><th>#</th><th>Data da cobrança</th><th>Valor</th><th>Cobrança Pix</th><th>Comprovante</th></tr></thead><tbody>'+linhas+'</tbody></table></div>';
}
function pxDataUrlToBlob(durl){
  const parts=durl.split(",");
  const mime=((parts[0]||"").match(/data:([^;]+)/)||[])[1]||"application/octet-stream";
  const bin=atob(parts[1]||"");
  const arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr],{type:mime});
}
function pxAbrirArquivo(durl){
  if(!durl) return;
  try{
    const url=URL.createObjectURL(pxDataUrlToBlob(durl));
    window.open(url,"_blank","noopener");
    setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(err){ window.open(durl,"_blank","noopener"); }
}
function pxAbrirContrato(p){ if(p) pxAbrirArquivo(p.contratoArquivo); }
function pxDateKey(d){ return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2); }
// ---- Cobrança via Pix (BR Code / copia e cola gerado localmente) ----
function pixGetCfg(){ try{ return JSON.parse(localStorage.getItem("pix_config")||"{}"); }catch(e){ return {}; } }
function pixCfgStatusUpd(){ const el=document.getElementById("pixCfgStatus"); if(!el) return; const c=pixGetCfg(); if(c.chave){ el.textContent="\\u2713 configurada"; el.className="pix-cfg-st ok"; } else { el.textContent="não configurada"; el.className="pix-cfg-st no"; } }
function pixSetCfgUI(){ const c=pixGetCfg(); const k=document.getElementById("pixChave"); if(!k) return; k.value=c.chave||""; document.getElementById("pixNome").value=c.nome||""; pixCfgStatusUpd(); }
function pixSan(s){ return (s||"").normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/[^A-Za-z0-9 ]/g,"").trim(); }
function pixTLV(id,val){ return id+("00"+val.length).slice(-2)+val; }
function pixCrc16(str){ let crc=0xFFFF; for(let i=0;i<str.length;i++){ crc^=(str.charCodeAt(i)&0xFF)<<8; for(let j=0;j<8;j++){ crc=(crc&0x8000)?((crc<<1)^0x1021):(crc<<1); crc&=0xFFFF; } } return ("0000"+crc.toString(16).toUpperCase()).slice(-4); }
function pixPayload(cfg,valor,txid){
  const chave=(cfg.chave||"").trim();
  const nome=(pixSan(cfg.nome).slice(0,25))||"RECEBEDOR";
  const cidade=(pixSan(cfg.cidade).slice(0,15))||"CAICO";
  const mai=pixTLV("00","br.gov.bcb.pix")+pixTLV("01",chave);
  let p="";
  p+=pixTLV("00","01");
  p+=pixTLV("01","11");
  p+=pixTLV("26",mai);
  p+=pixTLV("52","0000");
  p+=pixTLV("53","986");
  if(valor>0) p+=pixTLV("54",(Math.round(valor*100)/100).toFixed(2));
  p+=pixTLV("58","BR");
  p+=pixTLV("59",nome);
  p+=pixTLV("60",cidade);
  const ref=(pixSan(txid).toUpperCase().replace(/ /g,"").slice(0,25))||"***";
  p+=pixTLV("62",pixTLV("05",ref));
  p+="6304";
  return p+pixCrc16(p);
}
function pxGerarPix(p,key){
  const cfg=pixGetCfg();
  if(!cfg.chave){ const box=document.getElementById("pixCfgBox"); if(box) box.open=true; uiConfirm({ titulo:"Configure a chave Pix", msg:"Antes de gerar a cobrança, salve a chave Pix do supermercado no topo da página (botão \\u201cCobrança via Pix\\u201d).", ok:"Entendi", cancel:"" }); return; }
  const valor=+p.valor||0;
  const dt=key.split("-");
  const ref="P"+(p.numero||"")+dt[0].slice(2)+dt[1];
  const cod=pixPayload(cfg,valor,ref);
  pixAbrirModal({ valor:valor, codigo:cod, ponto:p.numero, forn:p.fornecedor, data:dt[2]+"/"+dt[1]+"/"+dt[0] });
}
function pixAbrirModal(o){
  let m=document.getElementById("pixModal");
  if(!m){
    m=document.createElement("div");
    m.id="pixModal"; m.className="modal-bg";
    m.innerHTML='<div class="modal-cx pix-cx">'+
      '<div class="modal-top"><div class="modal-ic pix-ic">💠</div><div class="modal-tit">Cobrança via Pix</div></div>'+
      '<div class="pix-body"><div class="pix-sub" id="pixSub"></div>'+
      '<div class="pix-qr"><img id="pixQrImg" alt="QR Code Pix"></div>'+
      '<div class="pix-cc-lbl">Pix copia e cola</div>'+
      '<textarea id="pixCC" class="pix-cc" readonly rows="3"></textarea>'+
      '<button type="button" class="pix-copiar" id="pixCopiar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copiar código</span></button></div>'+
      '<div class="modal-acts"><button type="button" class="btn-s" id="pixBaixar">Gerar cobrança</button><button type="button" class="btn-s" id="pixFechar">Fechar</button></div>'+
      '</div>';
    document.body.appendChild(m);
    m.addEventListener("click",function(e){ if(e.target===m) m.classList.remove("show"); });
    document.getElementById("pixFechar").addEventListener("click",function(){ m.classList.remove("show"); });
    document.getElementById("pixCopiar").addEventListener("click",function(){ const t=document.getElementById("pixCC"); const val=t.value; let ok=false; if(navigator.clipboard&&navigator.clipboard.writeText){ try{ navigator.clipboard.writeText(val); ok=true; }catch(e){} } if(!ok){ t.select(); try{ document.execCommand("copy"); }catch(e){} } try{ t.setSelectionRange(0,0); t.blur(); }catch(e){} if(window.getSelection){ try{ window.getSelection().removeAllRanges(); }catch(e){} } const b=this; const orig=b.innerHTML; b.classList.add("ok"); b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Código copiado!</span>'; setTimeout(function(){ b.classList.remove("ok"); b.innerHTML=orig; },1600); });
    document.getElementById("pixBaixar").addEventListener("click",function(){ if(pixFichaAtual) pixBaixarFicha(pixFichaAtual.o, pixFichaAtual.qr); });
  }
  const qr=qrcode(0,"M"); qr.addData(o.codigo,"Byte"); qr.make();
  const durl=qr.createDataURL(6,4);
  pixFichaAtual={ o:o, qr:durl };
  document.getElementById("pixQrImg").src=durl;
  document.getElementById("pixCC").value=o.codigo;
  document.getElementById("pixSub").innerHTML="Ponto nº "+(o.ponto||"")+(o.forn?" · "+o.forn:"")+"<br>Vencimento "+o.data+" · <b>"+brl(o.valor)+"</b>";
  m.classList.add("show");
}
let pixFichaAtual=null;
function pixRR(x,a,b,w,h,r){ x.beginPath(); x.moveTo(a+r,b); x.arcTo(a+w,b,a+w,b+h,r); x.arcTo(a+w,b+h,a,b+h,r); x.arcTo(a,b+h,a,b,r); x.arcTo(a,b,a+w,b,r); x.closePath(); }
function pixBaixarFicha(o,qrDataUrl){
  const S=2, W=760;
  const cfg=pixGetCfg();
  const benef=(cfg&&cfg.nome)||"Supermercado Santa Rita";
  // monta as linhas do código copia e cola (fonte monoespaçada)
  const cod=o.codigo||"", col=66, linhas=[];
  for(let i=0;i<cod.length;i+=col) linhas.push(cod.slice(i,i+col));
  const lineH=17;
  const codBoxH=20+linhas.length*lineH+16;
  const H=1210+codBoxH;
  const cv=document.createElement("canvas"); cv.width=W*S; cv.height=H*S;
  const x=cv.getContext("2d"); x.scale(S,S);
  const F="-apple-system,'SF Pro Display','Inter','Segoe UI',Roboto,Arial,sans-serif";
  const FM="'SF Mono','Roboto Mono','Menlo',ui-monospace,'Courier New',monospace";
  const desenhar=function(logoImg,qrImg){
    const L=52, R=W-52, cw=R-L;
    const hoje=new Date().toLocaleDateString("pt-BR");
    const dParts=(o.data||"").split("/");
    const num="COB-"+String(o.ponto||0).padStart(2,"0")+"-"+((dParts[2]||"").slice(2))+(dParts[1]||"");
    // cor do vencimento (sutil — sem selo de status alarmante)
    const vencColor="#1a2233";
    // helper: check verde minimalista
    const check=function(px,py){ x.save(); x.strokeStyle="#157a35"; x.lineWidth=1.6; x.lineCap="round"; x.lineJoin="round"; x.beginPath(); x.moveTo(px,py); x.lineTo(px+3,py+3.4); x.lineTo(px+8.5,py-3.4); x.stroke(); x.restore(); };
    // página branca + faixa de marca + borda sutil
    x.fillStyle="#ffffff"; x.fillRect(0,0,W,H);
    x.fillStyle="#157a35"; x.fillRect(0,0,W,5);
    x.strokeStyle="#edf1f6"; x.lineWidth=1; x.strokeRect(0.5,0.5,W-1,H-1);
    x.textBaseline="alphabetic"; x.textAlign="left";
    let cy=66;
    // ===== HEADER =====
    let tx=L;
    if(logoImg){ try{ const bw=94,bh=94,bx=L,by=cy-38; const iw=logoImg.naturalWidth||bw,ih=logoImg.naturalHeight||bh; const sc=Math.min(bw/iw,bh/ih),dw=iw*sc,dh=ih*sc; x.drawImage(logoImg,bx+(bw-dw)/2,by+(bh-dh)/2,dw,dh); tx=L+bw+22; }catch(e){} }
    x.fillStyle="#0f1d33"; x.font="700 22px "+F; x.fillText("Supermercado Santa Rita",tx,cy+1);
    x.fillStyle="#94a1ad"; x.font="500 11.5px "+F; x.fillText("Cobrança financeira · Pix",tx,cy+24);
    cy+=84; x.strokeStyle="#edf1f6"; x.beginPath(); x.moveTo(L,cy); x.lineTo(R,cy); x.stroke(); cy+=36;
    // ===== META (3 colunas) =====
    const colW=cw/3;
    const meta=function(lb,vl,mx,vc){ x.textAlign="center"; x.fillStyle="#9aa6b2"; x.font="600 10px "+F; x.fillText(lb,mx,cy); x.fillStyle=vc||"#1a2233"; x.font="700 15px "+F; x.fillText(vl,mx,cy+24); x.textAlign="left"; };
    meta("Nº DA COBRANÇA",num,L+colW*0.5); meta("EMISSÃO",hoje,L+colW*1.5); meta("VENCIMENTO",o.data||"—",L+colW*2.5,vencColor);
    cy+=58; x.strokeStyle="#edf1f6"; x.beginPath(); x.moveTo(L,cy); x.lineTo(R,cy); x.stroke(); cy+=32;
    // ===== HERO: VALOR (cartão financeiro premium) =====
    const heroH=142;
    x.save(); x.shadowColor="rgba(20,30,45,0.06)"; x.shadowBlur=24; x.shadowOffsetY=9; x.fillStyle="#f7f9fc"; pixRR(x,L,cy,cw,heroH,20); x.fill(); x.restore();
    x.strokeStyle="#edf1f6"; x.lineWidth=1; pixRR(x,L,cy,cw,heroH,20); x.stroke();
    // barra de acento sutil à esquerda
    x.save(); pixRR(x,L,cy,5,heroH,20); x.clip(); x.fillStyle="#157a35"; x.fillRect(L,cy,5,heroH); x.restore();
    x.textAlign="left"; x.fillStyle="#8995a3"; x.font="600 11px "+F; x.fillText("VALOR A PAGAR",L+32,cy+42);
    x.fillStyle="#0f1d33"; x.font="700 53px "+F; x.fillText(brl(o.valor),L+30,cy+97);
    x.fillStyle="#9aa6b2"; x.font="500 11px "+F; x.fillText("Pagamento via Pix · processado instantaneamente",L+32,cy+122);
    x.textAlign="right";
    x.fillStyle="#8995a3"; x.font="600 10px "+F; x.fillText("FORMA DE PAGAMENTO",R-30,cy+42);
    x.fillStyle="#1a2233"; x.font="700 14px "+F; x.fillText("Pix",R-30,cy+61);
    x.fillStyle="#8995a3"; x.font="600 10px "+F; x.fillText("BENEFICIÁRIO",R-30,cy+92);
    x.fillStyle="#1a2233"; x.font="700 13px "+F; x.fillText(benef,R-30,cy+111);
    x.textAlign="left"; cy+=heroH+30;
    // ===== RESUMO FINANCEIRO =====
    x.fillStyle="#9aa6b2"; x.font="600 11px "+F; x.fillText("RESUMO FINANCEIRO",L,cy); cy+=24;
    const kv=function(k,v,kc,vc){ x.textAlign="left"; x.fillStyle=kc; x.font="400 13px "+F; x.fillText(k,L,cy); x.textAlign="right"; x.fillStyle=vc; x.font="600 13px "+F; x.fillText(v,R,cy); x.textAlign="left"; };
    kv("Valor original",brl(o.valor),"#5a6675","#1a2233"); cy+=28;
    kv("Multa por atraso","Isento","#5a6675","#9aa6b2"); cy+=28;
    kv("Juros de mora","Isento","#5a6675","#9aa6b2"); cy+=20;
    x.strokeStyle="#edf1f6"; x.beginPath(); x.moveTo(L,cy); x.lineTo(R,cy); x.stroke(); cy+=30;
    x.textAlign="left"; x.fillStyle="#0f1d33"; x.font="700 15px "+F; x.fillText("Total a pagar",L,cy);
    x.textAlign="right"; x.fillStyle="#157a35"; x.font="700 21px "+F; x.fillText(brl(o.valor),R,cy+2); x.textAlign="left"; cy+=42;
    // ===== PAGUE COM PIX =====
    x.strokeStyle="#edf1f6"; x.beginPath(); x.moveTo(L,cy); x.lineTo(R,cy); x.stroke(); cy+=30;
    x.fillStyle="#9aa6b2"; x.font="600 11px "+F; x.fillText("PAGUE COM PIX",L,cy); cy+=16;
    const qs=200, qpad=15, qbox=qs+qpad*2, qx=L, qy=cy;
    // moldura do QR — fundo levemente cinza + sombra extremamente leve (estilo banco digital)
    x.save(); x.shadowColor="rgba(20,30,45,0.06)"; x.shadowBlur=22; x.shadowOffsetY=8; x.fillStyle="#f7f9fb"; pixRR(x,qx,qy,qbox,qbox,18); x.fill(); x.restore();
    x.strokeStyle="#e7edf3"; x.lineWidth=1; pixRR(x,qx,qy,qbox,qbox,18); x.stroke();
    // QR sobre quadrado branco interno (respiro)
    x.fillStyle="#ffffff"; pixRR(x,qx+qpad-4,qy+qpad-4,qs+8,qs+8,8); x.fill();
    if(qrImg){ try{ x.imageSmoothingEnabled=false; x.drawImage(qrImg,qx+qpad,qy+qpad,qs,qs); x.imageSmoothingEnabled=true; }catch(e){} }
    // legenda + ícone Pix discreto (losango) + validade
    var capTxt="Escaneie para pagar"; x.font="600 11px "+F; var capW=x.measureText(capTxt).width; var capX=qx+(qbox-(capW+18))/2, capY=qy+qbox+24;
    x.save(); x.translate(capX+5,capY-4); x.rotate(Math.PI/4); x.fillStyle="#157a35"; pixRR(x,-5,-5,10,10,2.6); x.fill(); x.restore();
    x.textAlign="left"; x.fillStyle="#8995a3"; x.fillText(capTxt,capX+18,capY);
    x.textAlign="center"; x.fillStyle="#aeb8c4"; x.font="500 10.5px "+F; x.fillText("Válido até "+(o.data||"—"),qx+qbox/2,capY+18); x.textAlign="left";
    const ix=qx+qbox+58; let iy=qy+24;
    x.fillStyle="#1a2233"; x.font="700 15px "+F; x.fillText("Como pagar",ix,iy); iy+=32;
    x.font="400 13px "+F; x.fillStyle="#5a6675";
    const passos=["1.   Abra o app do seu banco","2.   Escolha pagar com Pix / QR Code","3.   Aponte a câmera para o código"];
    for(let pi=0;pi<passos.length;pi++){ x.fillText(passos[pi],ix,iy); iy+=27; }
    iy+=8; x.fillStyle="#9aa6b2"; x.font="italic 12px "+F; x.fillText("ou use o Pix copia e cola abaixo.",ix,iy);
    cy=qy+qbox+68;
    // ===== COPIA E COLA (estilo código / terminal premium) =====
    x.fillStyle="#94a1ad"; x.font="600 11px "+F; x.textAlign="left"; x.fillText("PIX COPIA E COLA",L,cy);
    cy+=16;
    x.fillStyle="#f6f8fb"; x.strokeStyle="#e7edf3"; x.lineWidth=1; pixRR(x,L,cy,cw,codBoxH,12); x.fill(); x.stroke();
    // acento técnico à esquerda
    x.save(); pixRR(x,L,cy,4,codBoxH,12); x.clip(); x.fillStyle="#cdd6e0"; x.fillRect(L,cy,4,codBoxH); x.restore();
    x.fillStyle="#3a4a5c"; x.font="11.5px "+FM; let ly=cy+27;
    for(let li=0;li<linhas.length;li++){ x.fillText(linhas[li],L+20,ly); ly+=lineH; }
    cy+=codBoxH+30;
    // ===== AVISO (creme minimalista) =====
    const aH=56;
    x.fillStyle="#fdfbf6"; x.strokeStyle="#f0ead9"; x.lineWidth=1; pixRR(x,L,cy,cw,aH,14); x.fill(); x.stroke();
    // ícone de relógio sutil
    x.save(); x.strokeStyle="#cda859"; x.lineWidth=1.6; x.beginPath(); x.arc(L+27,cy+aH/2,8,0,6.2832); x.stroke(); x.beginPath(); x.moveTo(L+27,cy+aH/2); x.lineTo(L+27,cy+aH/2-4.5); x.moveTo(L+27,cy+aH/2); x.lineTo(L+31,cy+aH/2); x.stroke(); x.restore();
    x.fillStyle="#8c6e36"; x.font="700 11.5px "+F; x.textAlign="left"; x.fillText("Pague até o vencimento",L+48,cy+24);
    x.fillStyle="#917d58"; x.font="400 12px "+F; x.fillText("Efetue o pagamento até a data indicada para evitar o cancelamento do espaço.",L+48,cy+41);
    cy+=aH+28;
    // ===== AUTORIDADE / SELOS (microdetalhes bancários) =====
    const selos=["Transação protegida","Beneficiário verificado","Cobrança registrada"];
    x.font="600 11px "+F; let sx=L;
    for(let si=0;si<selos.length;si++){ check(sx,cy-1); x.fillStyle="#5a6675"; x.fillText(selos[si],sx+15,cy+3); sx+=15+x.measureText(selos[si]).width+26; }
    cy+=24;
    // ===== RODAPÉ =====
    x.strokeStyle="#edf1f6"; x.beginPath(); x.moveTo(L,cy); x.lineTo(R,cy); x.stroke(); cy+=24;
    x.fillStyle="#9aa6b2"; x.font="11px "+F; x.textAlign="left"; x.fillText("Documento gerado eletronicamente em "+hoje+".",L,cy);
    x.textAlign="right"; x.fillText("Pagamento via Pix · Banco Central do Brasil",R,cy); x.textAlign="left"; cy+=18;
    x.fillStyle="#bcc5cf"; x.font="10px "+F; x.fillText("Ref.: "+num+"  ·  Ponto nº "+(o.ponto||"")+(o.forn?"  ·  "+o.forn:""),L,cy);
    // abre como PDF na aba (visualizador com imprimir/baixar)
    pixFichaCanvas=cv;
    pixImprimirFicha(cv,o);
  };
  const logo=document.querySelector("header img");
  const qimg=new Image();
  qimg.onload=function(){ desenhar((logo&&logo.complete&&logo.naturalWidth)?logo:null, qimg); };
  qimg.onerror=function(){ desenhar((logo&&logo.complete&&logo.naturalWidth)?logo:null, null); };
  qimg.src=qrDataUrl;
}
let pixFichaCanvas=null;
// Monta um PDF (1 página) embutindo a imagem JPEG da ficha — tudo offline, sem biblioteca.
function pixCanvasToPdfBlob(cv){
  const iw=cv.width, ih=cv.height;
  const bin=atob(cv.toDataURL("image/jpeg",0.92).split(",")[1]);
  const jpg=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) jpg[i]=bin.charCodeAt(i);
  const pageW=595.28, pageH=pageW*ih/iw;
  const enc=function(s){ const a=new Uint8Array(s.length); for(let j=0;j<s.length;j++) a[j]=s.charCodeAt(j)&0xff; return a; };
  const parts=[]; let offset=0; const offsets=[];
  const push=function(u){ parts.push(u); offset+=u.length; };
  const obj=function(n,str){ offsets[n]=offset; push(enc(str)); };
  push(enc("%PDF-1.3\\n%\\xFF\\xFF\\xFF\\xFF\\n"));
  obj(1,"1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n");
  obj(2,"2 0 obj\\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\\nendobj\\n");
  obj(3,"3 0 obj\\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "+pageW.toFixed(2)+" "+pageH.toFixed(2)+"] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\\nendobj\\n");
  offsets[4]=offset;
  push(enc("4 0 obj\\n<< /Type /XObject /Subtype /Image /Width "+iw+" /Height "+ih+" /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length "+jpg.length+" >>\\nstream\\n"));
  push(jpg);
  push(enc("\\nendstream\\nendobj\\n"));
  const content="q\\n"+pageW.toFixed(2)+" 0 0 "+pageH.toFixed(2)+" 0 0 cm\\n/Im0 Do\\nQ\\n";
  obj(5,"5 0 obj\\n<< /Length "+content.length+" >>\\nstream\\n"+content+"endstream\\nendobj\\n");
  const xrefStart=offset;
  let xref="xref\\n0 6\\n0000000000 65535 f \\n";
  for(let k=1;k<=5;k++) xref+=("0000000000"+offsets[k]).slice(-10)+" 00000 n \\n";
  xref+="trailer\\n<< /Size 6 /Root 1 0 R >>\\nstartxref\\n"+xrefStart+"\\n%%EOF\\n";
  push(enc(xref));
  const out=new Uint8Array(offset); let p=0;
  for(let m=0;m<parts.length;m++){ out.set(parts[m],p); p+=parts[m].length; }
  return new Blob([out],{type:"application/pdf"});
}
// Abre a ficha como PDF numa aba nova — o navegador mostra o visualizador com botões de imprimir e baixar.
function pixImprimirFicha(cv,o){
  if(!cv) return;
  let url;
  try{ url=URL.createObjectURL(pixCanvasToPdfBlob(cv)); }catch(e){ return; }
  const w=window.open(url,"_blank");
  if(!w){ alert("Para ver, imprimir ou salvar a cobrança, permita pop-ups deste site no navegador."); }
  setTimeout(function(){ try{ URL.revokeObjectURL(url); }catch(e){} },60000);
}
// Dados do supermercado (LOCADOR). Editáveis aqui — substituir pelos dados reais quando o cliente enviar o modelo.
var PX_LOCADOR={
  razao:"G JOAO DOS SANTOS INDÚSTRIA E COMÉRCIO LTDA",
  fantasia:"Supermercado Santa Rita",
  cnpj:"12.988.127/0001-40",
  cidade:"Caicó/RN"
};
function pxEsc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
// Número por extenso (reais) — pt-BR, até milhões.
function pxNumExtenso(n){
  n=Math.round(n); if(n===0) return "zero";
  var u=["","um","dois","três","quatro","cinco","seis","sete","oito","nove","dez","onze","doze","treze","quatorze","quinze","dezesseis","dezessete","dezoito","dezenove"];
  var dez=["","","vinte","trinta","quarenta","cinquenta","sessenta","setenta","oitenta","noventa"];
  var cem=["","cento","duzentos","trezentos","quatrocentos","quinhentos","seiscentos","setecentos","oitocentos","novecentos"];
  function ate999(x){ if(x===0) return ""; if(x===100) return "cem"; var p=[]; var c=Math.floor(x/100), r=x%100; if(c) p.push(cem[c]); if(r){ if(r<20) p.push(u[r]); else { var d=Math.floor(r/10), un=r%10; p.push(dez[d]+(un?(" e "+u[un]):"")); } } return p.join(" e "); }
  var partes=[], milhao=Math.floor(n/1000000), resto=n%1000000, mil=Math.floor(resto/1000), cent=resto%1000;
  if(milhao) partes.push(ate999(milhao)+(milhao===1?" milhão":" milhões"));
  if(mil) partes.push(mil===1?"mil":(ate999(mil)+" mil"));
  if(cent) partes.push(ate999(cent));
  return partes.join(" e ");
}
function pxReaisExtenso(v){ var i=Math.floor(v); return pxNumExtenso(i)+(i===1?" real":" reais"); }
function pxMesesEntre(ini,fim){ if(!ini||!fim) return 0; var a=ini.split("-"), b=fim.split("-"); var m=(+b[0]*12+ +b[1])-(+a[0]*12+ +a[1]); if(+b[2] < +a[2]) m-=1; return m>0?m:0; }
// Monta o "Acordo Comercial" (modelo da loja) a partir dos dados do ponto.
function pxContratoDocHtml(p){
  var MES=["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  var L=PX_LOCADOR;
  var forn=pxEsc(p.razaoSocial||p.fornecedor||"[FORNECEDOR]");
  var cnpjForn=pxEsc(p.cnpj?pxFmtCnpj(p.cnpj):"[CNPJ DO FORNECEDOR]");
  var ini=p.abertura, fim=p.vencimento;
  var iniFmt=pxEsc(ini?pxFmtData(ini):"____/____/______");
  var fimFmt=pxEsc(fim?pxFmtData(fim):"____/____/______");
  var meses=pxMesesEntre(ini,fim);
  var mensal=+p.valor||0;
  var total=meses>0 ? mensal*meses : mensal;
  var valTotalFmt=total?pxEsc(brl(total)):"[VALOR]";
  var valTotalExt=total?(" ("+pxReaisExtenso(total)+")"):"";
  var mensalFmt=mensal?pxEsc(brl(mensal)):"[VALOR]";
  var pagBase = /pix/i.test(p.pagamento||"") ? "Pix" : (/boleto/i.test(p.pagamento||"") ? "boleto bancário" : (pxEsc(p.pagamento)||"boleto bancário"));
  var dd=ini?new Date(+ini.split("-")[0],+ini.split("-")[1]-1,+ini.split("-")[2]):new Date(HOJE.getTime());
  var dataExt=dd.getDate()+" de "+MES[dd.getMonth()]+" de "+dd.getFullYear();
  var vigencia = meses>0 ? (", correspondendo a "+meses+(meses===1?" mês":" meses")+" de vigência") : "";
  var pagTxt="O valor será pago através de "+pagBase+", no valor total de "+valTotalFmt+", referente ao período contratado"+vigencia+", com valor mensal de "+mensalFmt+".";
  var razao=pxEsc(L.razao), cnpjL=pxEsc(L.cnpj), fant=pxEsc(L.fantasia||L.razao), cidade=pxEsc(L.cidade||"Caicó/RN");
  var css="*{box-sizing:border-box}html,body{background:#fff}body{font-family:'Times New Roman',Georgia,serif;color:#1a1a1a;max-width:760px;margin:0 auto;padding:48px 60px;line-height:1.75;font-size:15px}"+
    "h1{text-align:center;font-size:17px;text-transform:uppercase;letter-spacing:.8px;line-height:1.35;margin:0 0 30px}"+
    "p{margin:0 0 14px;text-align:justify}.lbl{font-weight:bold}.bloco-info{margin:18px 0}.clausula{margin-top:22px}.clausula .t{font-weight:bold}"+
    ".assin{margin-top:60px}.assin .row{display:flex;gap:60px;justify-content:space-between;margin-top:56px}"+
    ".assin .bloco{flex:1;text-align:center}.assin .linha{border-top:1px solid #1a1a1a;padding-top:6px}"+
    ".assin .papel{font-weight:bold;font-size:13px}.assin .dado{font-size:11.5px;color:#333;margin-top:2px}"+
    ".barra{position:fixed;top:0;left:0;right:0;background:#157a35;color:#fff;padding:10px 16px;text-align:center;font-family:Arial,sans-serif}"+
    ".barra button{font-size:14px;font-weight:700;padding:8px 18px;margin:0 4px;border:0;border-radius:6px;cursor:pointer;background:#fff;color:#157a35}"+
    ".barra .sec{background:transparent;color:#fff;border:1px solid #fff}"+
    "@page{margin:0}@media print{.barra{display:none}body{max-width:none;margin:0;padding:18mm 18mm 18mm}}";
  var h="<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'><title>Acordo Comercial — "+forn+"</title><style>"+css+"</style></head><body>";
  h+="<div class='barra'><button onclick='window.print()'>Imprimir / Salvar PDF</button><button class='sec' onclick='window.close()'>Fechar</button></div>";
  h+="<div style='height:34px'></div>";
  var logoSrc=""; try{ logoSrc=(typeof LOGO_URI!=="undefined"&&LOGO_URI)?LOGO_URI:((document.querySelector("header img")||{}).src||""); }catch(e){}
  if(logoSrc) h+="<div style='text-align:center;margin:0 0 16px'><img src='"+logoSrc+"' alt='Supermercado Santa Rita' style='max-height:74px;width:auto'></div>";
  h+="<h1>Acordo Comercial para Utilização de Espaço Promocional<br>(Ponto Extra)</h1>";
  h+="<p>Por este instrumento particular, de um lado <b>"+forn+"</b>, inscrita no CNPJ sob o nº <b>"+cnpjForn+"</b>, doravante denominada <b>CONTRATANTE</b>, e de outro lado <b>"+razao+"</b> ("+fant+"), inscrita no CNPJ sob o nº <b>"+cnpjL+"</b>, doravante denominada <b>CONTRATADA</b>, têm entre si justo e acordado o presente Acordo Comercial, que se regerá pelas cláusulas e condições a seguir.</p>";
  h+="<div class='bloco-info'>";
  h+="<p><span class='lbl'>PERÍODO DA NEGOCIAÇÃO E QUITAÇÃO:</span> "+iniFmt+" a "+fimFmt+"</p>";
  h+="<p><span class='lbl'>VALOR DA QUITAÇÃO:</span> "+valTotalFmt+valTotalExt+"</p>";
  h+="<p><span class='lbl'>FORMA DE PAGAMENTO:</span> "+pagTxt+"</p>";
  h+="</div>";
  h+="<div class='clausula'><p><span class='t'>CLÁUSULA DE QUITAÇÃO:</span> Após a confirmação do pagamento integral do valor acordado, as partes concedem entre si plena, geral e irrevogável quitação referente ao objeto deste acordo, nada mais tendo a reclamar uma da outra a qualquer título.</p></div>";
  h+="<p style='margin-top:26px'>"+cidade.toUpperCase()+", "+dataExt+".</p>";
  h+="<div class='assin'>";
  h+="<div class='row'><div class='bloco'><div class='linha'><div class='papel'>CONTRATANTE</div><div class='dado'>"+forn+(p.cnpj?(" — CNPJ "+cnpjForn):"")+"</div></div></div>";
  h+="<div class='bloco'><div class='linha'><div class='papel'>CONTRATADA</div><div class='dado'>"+razao+" — CNPJ "+cnpjL+"</div></div></div></div>";
  h+="</div>";
  h+="</body></html>";
  return h;
}
function pxGerarContrato(p){
  if(!p){ alert("Preencha os dados do ponto antes de gerar o contrato."); return; }
  var w=window.open("","_blank");
  if(!w){ alert("Para gerar o contrato, permita pop-ups deste site no navegador."); return; }
  w.document.open(); w.document.write(pxContratoDocHtml(p)); w.document.close();
}
function pxContratoHtml(p){
  const docIc='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
  const clipIc='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>';
  let corpo;
  if(p.contratoArquivo){
    const trocaIc='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>';
    const lixoIc='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
    corpo='<a class="px-arq-link" href="#" data-cview="'+p.id+'" title="Abrir contrato">'+docIc+'<span>'+(p.contratoNome||"Ver contrato")+'</span></a>'+
      '<button type="button" class="px-arq-icon" data-cfile-btn="'+p.id+'" title="Trocar contrato">'+trocaIc+'</button>'+
      '<button type="button" class="px-arq-icon rem" data-crem="'+p.id+'" title="Remover contrato">'+lixoIc+'</button>';
  } else {
    corpo='<button type="button" class="px-arq-anexar" data-cfile-btn="'+p.id+'">'+clipIc+'Anexar contrato</button>';
  }
  var gerarIc='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>';
  return '<div class="px-det-item px-det-contrato"><b>Contrato</b><div class="px-arq">'+corpo+
    '<input type="file" data-cfile="'+p.id+'" accept="application/pdf,image/*" style="display:none;"></div>'+
    '<button type="button" class="px-gerar-ct" data-cgerar="'+p.id+'" title="Gerar contrato padrão com os dados deste ponto">'+gerarIc+'Gerar contrato</button></div>';
}
function pxFmtCnpj(c){
  const d=(c||"").replace(/\\D/g,"");
  if(d.length!==14) return c||"—";
  return d.slice(0,2)+"."+d.slice(2,5)+"."+d.slice(5,8)+"/"+d.slice(8,12)+"-"+d.slice(12);
}
function renderPontosG(){
  const hoje=new Date(HOJE.getFullYear(),HOJE.getMonth(),HOJE.getDate());
  // KPIs (sobre TODOS os pontos)
  const total=pontosG.length;
  const valorTotal=pontosG.reduce((a,p)=>a+(+p.valor||0),0);
  const recebido=pontosG.filter(p=>pxPagoMes(p)).reduce((a,p)=>a+(+p.valor||0),0);
  const aReceber=valorTotal-recebido;
  let vencidos=0;
  pontosG.forEach(p=>{ const d=pxParseData(p.vencimento); if(d){ const dias=(d-hoje)/86400000; if(dias<=0) vencidos++; } });
  document.getElementById("pxKpis").innerHTML=
    [["Pontos",total,"n"],["Valor negociado",valorTotal,"r"],["Recebido",recebido,"r"],["A receber",aReceber,"r"],["Vencidos",vencidos,"n"]]
    .map(a=>'<div class="kpi"><div class="v">'+(a[2]==="r"?brl(a[1]):num(a[1]))+'</div><div class="l">'+a[0]+'</div></div>').join("");
  // Lista de inadimplentes (quem deve, quanto e há quantos dias)
  const inad=[];
  pontosG.forEach(function(p){ const x=pxInadimplencia(p); if(x){ x.p=p; inad.push(x); } });
  inad.sort(function(a,b){ return b.dias-a.dias; });
  const totDevido=inad.reduce(function(a,x){ return a+x.valor; },0);
  document.getElementById("pxInadimplentes").innerHTML = inad.length ? (
    '<div class="px-inad"><div class="px-inad-top"><span class="px-inad-tit">⚠️ Inadimplentes ('+inad.length+')</span><span class="px-inad-tot">Total em atraso: '+brl(totDevido)+'</span></div>'+
    '<table class="px-inad-tb"><thead><tr><th>Fornecedor</th><th>Parcelas atrasadas</th><th>Valor devido</th><th>Atraso</th></tr></thead><tbody>'+
    inad.map(function(x){ return '<tr><td>'+(x.p.fornecedor||"—")+'</td><td>'+x.n+'</td><td>'+brl(x.valor)+'</td><td>'+x.dias+' dia'+(x.dias===1?'':'s')+' <span class="px-inad-desde">(desde '+x.desde.toLocaleDateString("pt-BR")+')</span></td></tr>'; }).join('')+
    '</tbody></table></div>'
  ) : '';
  pxAtualizaBadge();
  // Tabela (com filtros)
  const busca=(document.getElementById("pxBusca").value||"").trim().toLowerCase();
  const fstatus=document.getElementById("pxFiltroStatus").value;
  const fpag=document.getElementById("pxFiltroPagamento").value;
  let lista=pontosG.slice().sort((a,b)=>(+a.numero||0)-(+b.numero||0));
  if(busca) lista=lista.filter(p=>(p.fornecedor||"").toLowerCase().includes(busca)||(p.vendedor||"").toLowerCase().includes(busca));
  if(fstatus) lista=lista.filter(p=>pxStatusMes(p)===fstatus);
  if(fpag) lista=lista.filter(p=>(p.pagamento||"")===fpag);
  const fvenc=document.getElementById("pxFiltroVenc").value;
  if(fvenc) lista=lista.filter(p=>{ const d=pxParseData(p.vencimento); if(!d) return false; const dias=(d-hoje)/86400000; return fvenc==="vencidos" ? dias<=0 : dias>0; });
  document.getElementById("pxInfo").textContent=lista.length+" ponto(s)";
  const linhas=lista.map(p=>{
    const d=pxParseData(p.vencimento); let vcls="";
    if(d){ const dias=(d-hoje)/86400000; if(dias<0) vcls="px-venc-vencido"; else if(dias<=15) vcls="px-venc-prox"; }
    const seta='<button class="px-exp" data-exp="'+p.id+'" title="Ver dados da empresa"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></button>';
    return '<tr>'+
      '<td class="px-exp-cell">'+seta+'</td>'+
      '<td>'+(p.numero||"")+'</td>'+
      '<td>'+(p.fornecedor||"")+'</td>'+
      '<td>'+(p.vendedor||"")+'</td>'+
      '<td>'+(p.valor? brl(+p.valor) : "—")+'</td>'+
      '<td>'+(p.pagamento||"")+'</td>'+
      '<td>'+pxFmtData(p.abertura)+'</td>'+
      '<td class="'+vcls+'">'+pxFmtData(p.vencimento)+'</td>'+
      '<td>'+pxBadge(p)+'</td>'+
      '<td>'+(p.obs||"")+'</td>'+
      '<td style="white-space:nowrap"><span class="esc-nome" data-edit="'+p.id+'">editar</span> &nbsp;<span class="esc-del" data-del="'+p.id+'" title="Remover">✕</span></td>'+
      '</tr>'+
      '<tr class="px-det" id="det-'+p.id+'" style="display:none;"><td colspan="11"><div class="px-det-wrap"><div class="px-det-box">'+
        pxDetItem("CNPJ", p.cnpj ? pxFmtCnpj(p.cnpj) : "—")+
        pxDetItem("Razão Social", p.razaoSocial||"—")+
        pxDetItem("Vendedor", p.vendedor||"—")+
        pxDetItem("Contato", p.contato?pxFmtTel(p.contato):"—")+
        pxDetItem("E-mail", p.email ? ('<a href="mailto:'+pxEsc(p.email)+'">'+pxEsc(p.email)+'</a>') : "—")+
        pxDetItem("Endereço", p.endereco?pxEsc(p.endereco):"—")+
        pxContratoHtml(p)+
      '</div>'+pxAgendaHtml(p)+'</div></td></tr>';
  }).join("");
  document.getElementById("pxTabela").innerHTML=
    '<table><thead><tr><th style="width:34px;"></th><th>Nº</th><th>Fornecedor</th><th>Vendedor</th><th>Valor</th><th>Pagamento</th><th>Abertura</th><th>Vencimento</th><th>Status</th><th>Observação</th><th></th></tr></thead><tbody>'+
    (linhas || '<tr><td colspan="11" class="vazio">Nenhum ponto.</td></tr>')+'</tbody></table>';
  renderMapa();
}

function pxLerForm(){
  return {
    numero: document.getElementById("pxNum").value.trim(),
    cnpj: document.getElementById("pxCnpj").value.trim(),
    fornecedor: document.getElementById("pxForn").value.trim(),
    razaoSocial: document.getElementById("pxRazao").value.trim(),
    vendedor: document.getElementById("pxVend").value.trim(),
    contato: document.getElementById("pxTel").value.trim(),
    email: document.getElementById("pxEmail").value.trim(),
    endereco: document.getElementById("pxEndereco").value.trim(),
    valor: parseFloat(document.getElementById("pxValor").value)||0,
    pagamento: document.getElementById("pxPag").value.trim(),
    abertura: document.getElementById("pxAbertura").value,
    vencimento: document.getElementById("pxVenc").value,
    obs: document.getElementById("pxObs").value.trim()
  };
}
function pxPreencherForm(p){
  document.getElementById("pxNum").value=p.numero||"";
  document.getElementById("pxCnpj").value=p.cnpj||"";
  document.getElementById("pxForn").value=p.fornecedor||"";
  document.getElementById("pxRazao").value=p.razaoSocial||"";
  document.getElementById("pxVend").value=p.vendedor||"";
  document.getElementById("pxTel").value=pxFmtTel(p.contato||"");
  document.getElementById("pxEmail").value=p.email||"";
  document.getElementById("pxEndereco").value=p.endereco||"";
  document.getElementById("pxValor").value=p.valor||"";
  document.getElementById("pxPag").value=p.pagamento||"";
  document.getElementById("pxAbertura").value=/^\\d{4}-\\d{2}-\\d{2}\$/.test(p.abertura||"")?p.abertura:"";
  document.getElementById("pxVenc").value=/^\\d{4}-\\d{2}-\\d{2}\$/.test(p.vencimento||"")?p.vencimento:"";
  document.getElementById("pxObs").value=p.obs||"";
}
function pxLimparForm(){
  ["pxNum","pxCnpj","pxForn","pxRazao","pxVend","pxTel","pxEmail","pxEndereco","pxValor","pxPag","pxAbertura","pxVenc","pxObs"].forEach(id=>document.getElementById(id).value="");
  document.getElementById("pxCnpjMsg").textContent="";
  pxEditId=null;
  document.getElementById("pxFormTitulo").textContent="Adicionar ponto extra";
  document.getElementById("pxSalvar").textContent="Adicionar";
  document.getElementById("pxCancelar").style.display="none";
}
function pxBuscarCnpj(){
  const el=document.getElementById("pxCnpj");
  const msg=document.getElementById("pxCnpjMsg");
  const btn=document.getElementById("pxCnpjBuscar");
  const cnpj=(el.value||"").replace(/\\D/g,"");
  if(cnpj.length!==14){ msg.style.color="#c0392b"; msg.textContent="Digite os 14 números do CNPJ."; return; }
  btn.disabled=true; const txt=btn.textContent; btn.textContent="Buscando...";
  msg.style.color="#6b7787"; msg.textContent="Consultando a Receita Federal...";
  fetch("https://brasilapi.com.br/api/cnpj/v1/"+cnpj)
    .then(function(r){ if(!r.ok) throw new Error("nf"); return r.json(); })
    .then(function(d){
      const fantasia=d.nome_fantasia||"";
      const razao=d.razao_social||"";
      const nome=fantasia||razao;
      if(nome){
        document.getElementById("pxForn").value=nome;
        document.getElementById("pxRazao").value=razao;
        // email: preenche se a Receita tiver e o campo estiver vazio
        var emEl=document.getElementById("pxEmail");
        if(d.email && !emEl.value.trim()) emEl.value=String(d.email).toLowerCase();
        // telefone: preenche se vier e o campo estiver vazio
        var telEl=document.getElementById("pxTel");
        if(d.ddd_telefone_1 && !telEl.value.trim()) telEl.value=pxFmtTel(String(d.ddd_telefone_1).replace(/\\D/g,""));
        // endereço: monta a partir dos campos da Receita
        var endEl=document.getElementById("pxEndereco");
        var partes=[];
        if(d.logradouro) partes.push(d.logradouro+(d.numero?(", "+d.numero):""));
        if(d.bairro) partes.push(d.bairro);
        if(d.municipio) partes.push(d.municipio+(d.uf?("/"+d.uf):""));
        if(d.cep) partes.push("CEP "+String(d.cep).replace(/(\\d{5})(\\d{3})/,"$1-$2"));
        var endereco=partes.join(" - ");
        if(endereco) endEl.value=endereco;
        msg.style.color="#1b9e4b";
        msg.textContent="\\u2713 "+(fantasia?("Fantasia: "+fantasia):"")+((fantasia&&razao)?"  \\u00b7  ":"")+(razao?("Razão: "+razao):"")+(d.email?("  \\u00b7  \\u2709 "+String(d.email).toLowerCase()):"");
      } else { msg.style.color="#c0392b"; msg.textContent="CNPJ encontrado, mas sem nome cadastrado."; }
    })
    .catch(function(){ msg.style.color="#c0392b"; msg.textContent="Não encontrei esse CNPJ. Confira o número e a internet."; })
    .finally(function(){ btn.disabled=false; btn.textContent=txt; });
}
// Janela de confirmação estilizada (substitui o confirm() do navegador). Retorna Promise<boolean>.
function uiConfirm(opts){
  opts=opts||{};
  return new Promise(function(resolve){
    var bg=document.getElementById("uiModal");
    if(!bg){
      bg=document.createElement("div");
      bg.id="uiModal"; bg.className="modal-bg";
      bg.innerHTML='<div class="modal-cx"><div class="modal-top"><div class="modal-ic"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg></div><div class="modal-tit" id="uiModalTit"></div></div><div class="modal-msg" id="uiModalMsg"></div><div class="modal-acts"><button class="btn-s" id="uiModalCancel">Cancelar</button><button class="btn-p" id="uiModalOk">Confirmar</button></div></div>';
      document.body.appendChild(bg);
    }
    document.getElementById("uiModalTit").textContent=opts.titulo||"Confirmar";
    document.getElementById("uiModalMsg").textContent=opts.msg||"";
    var ok=document.getElementById("uiModalOk"), cancel=document.getElementById("uiModalCancel");
    ok.textContent=opts.ok||"Confirmar";
    var temCancel = opts.cancel!=="";
    cancel.textContent=opts.cancel||"Cancelar";
    cancel.style.display = temCancel ? "" : "none";
    bg.classList.add("show");
    function fechar(v){ bg.classList.remove("show"); ok.onclick=null; cancel.onclick=null; bg.onclick=null; document.onkeydown=null; resolve(v); }
    ok.onclick=function(){ fechar(true); };
    cancel.onclick=function(){ fechar(false); };
    bg.onclick=function(e){ if(e.target===bg) fechar(false); };
    document.onkeydown=function(e){ if(e.key==="Escape") fechar(false); else if(e.key==="Enter") fechar(true); };
    setTimeout(function(){ ok.focus(); }, 30);
  });
}
function uiPrompt(opts){
  opts=opts||{};
  return new Promise(function(resolve){
    var bg=document.getElementById("uiPromptModal");
    if(!bg){
      bg=document.createElement("div"); bg.id="uiPromptModal"; bg.className="modal-bg";
      bg.innerHTML='<div class="modal-cx"><div class="modal-top"><div class="modal-ic ui-ic-lock">🔒</div><div class="modal-tit" id="upTit"></div></div><div class="modal-msg" id="upMsg"></div><div style="padding:6px 24px 0;"><input type="password" id="upInp" class="up-inp"></div><div class="modal-acts"><button class="btn-s" id="upCancel">Cancelar</button><button class="btn-p" id="upOk">Confirmar</button></div></div>';
      document.body.appendChild(bg);
    }
    document.getElementById("upTit").textContent=opts.titulo||"";
    document.getElementById("upMsg").textContent=opts.msg||"";
    var ic=bg.querySelector(".modal-ic"); if(ic) ic.textContent=opts.icone||"🔒";
    var inp=document.getElementById("upInp");
    inp.type=opts.inputType||"password";
    inp.value=(opts.valor!=null?opts.valor:""); inp.placeholder=opts.placeholder||"";
    var ok=document.getElementById("upOk"), cancel=document.getElementById("upCancel");
    ok.textContent=opts.ok||"Confirmar"; cancel.textContent=opts.cancel||"Cancelar";
    bg.classList.add("show");
    function fechar(v){ bg.classList.remove("show"); ok.onclick=null; cancel.onclick=null; bg.onclick=null; inp.onkeydown=null; resolve(v); }
    ok.onclick=function(){ fechar(inp.value); };
    cancel.onclick=function(){ fechar(null); };
    bg.onclick=function(e){ if(e.target===bg) fechar(null); };
    inp.onkeydown=function(e){ if(e.key==="Enter"){ e.preventDefault(); fechar(inp.value); } else if(e.key==="Escape"){ fechar(null); } };
    setTimeout(function(){ inp.focus(); if(inp.value) inp.select(); }, 30);
  });
}
let pixDesbloqueado=false;
function pixHash(str){ let h1=0xdeadbeef,h2=0x41c6ce57; for(let i=0;i<str.length;i++){ const ch=str.charCodeAt(i); h1=Math.imul(h1^ch,2654435761); h2=Math.imul(h2^ch,1597334677); } h1=Math.imul(h1^(h1>>>16),2246822507); h1^=Math.imul(h2^(h2>>>13),3266489909); h2=Math.imul(h2^(h2>>>16),2246822507); h2^=Math.imul(h1^(h1>>>13),3266489909); return (4294967296*(2097151&h2)+(h1>>>0)).toString(16); }
function pixTemMaster(){ return !!localStorage.getItem("pix_master"); }
// Exige a senha master (cria na 1a vez). Retorna true se autorizado.
async function pxExigeMaster(msg){
  if(!pixTemMaster()){
    const s1=await uiPrompt({ titulo:"Criar senha de administrador", msg:"Defina a senha master. Só quem tiver ela poderá autorizar pagamentos.", placeholder:"nova senha", ok:"Criar" });
    if(s1===null) return false;
    if(!s1.trim()){ uiConfirm({ titulo:"Senha vazia", msg:"Digite uma senha para continuar.", ok:"Entendi", cancel:"" }); return false; }
    const s2=await uiPrompt({ titulo:"Confirmar senha", msg:"Digite a senha novamente.", placeholder:"repita a senha", ok:"Confirmar" });
    if(s2===null) return false;
    if(s1!==s2){ uiConfirm({ titulo:"Senhas diferentes", msg:"As senhas não bateram. Tente de novo.", ok:"Entendi", cancel:"" }); return false; }
    localStorage.setItem("pix_master", pixHash(s1));
    return true;
  }
  const s=await uiPrompt({ titulo:"Autorização do administrador", msg: msg||"Digite a senha master para autorizar.", placeholder:"senha master", ok:"Autorizar" });
  if(s===null) return false;
  if(pixHash(s)===localStorage.getItem("pix_master")) return true;
  uiConfirm({ titulo:"Senha incorreta", msg:"A senha master não confere.", ok:"Entendi", cancel:"" });
  return false;
}
function pixAtualizarTrava(){
  const ch=document.getElementById("pixChave"); if(!ch) return;
  ["pixChave","pixNome"].forEach(function(id){ document.getElementById(id).disabled=!pixDesbloqueado; });
  document.getElementById("pixSalvarCfg").style.display = pixDesbloqueado ? "" : "none";
  document.getElementById("pixTravaBtn").textContent = pixDesbloqueado ? "Bloquear" : "Desbloquear (admin)";
  document.getElementById("pixTravaNota").textContent = pixDesbloqueado ? "Desbloqueado — lembre de bloquear ao terminar." : "Somente o administrador pode alterar a chave Pix.";
}
async function pixTravaClick(){
  if(pixDesbloqueado){ pixDesbloqueado=false; pixSetCfgUI(); pixAtualizarTrava(); return; }
  if(!pixTemMaster()){
    const s1=await uiPrompt({ titulo:"Criar senha de administrador", msg:"Defina a senha master. Só quem tiver ela poderá alterar a chave Pix.", placeholder:"nova senha", ok:"Criar" });
    if(s1===null) return;
    if(!s1.trim()){ uiConfirm({ titulo:"Senha vazia", msg:"Digite uma senha para continuar.", ok:"Entendi", cancel:"" }); return; }
    const s2=await uiPrompt({ titulo:"Confirmar senha", msg:"Digite a senha novamente.", placeholder:"repita a senha", ok:"Confirmar" });
    if(s2===null) return;
    if(s1!==s2){ uiConfirm({ titulo:"Senhas diferentes", msg:"As senhas não conferem. Tente de novo.", ok:"Entendi", cancel:"" }); return; }
    localStorage.setItem("pix_master", pixHash(s1));
    pixDesbloqueado=true; pixAtualizarTrava();
    return;
  }
  const s=await uiPrompt({ titulo:"Senha de administrador", msg:"Digite a senha master para alterar a chave Pix.", placeholder:"senha", ok:"Desbloquear" });
  if(s===null) return;
  if(pixHash(s)===localStorage.getItem("pix_master")){ pixDesbloqueado=true; pixAtualizarTrava(); }
  else uiConfirm({ titulo:"Senha incorreta", msg:"A senha não confere. A chave Pix continua bloqueada.", ok:"Entendi", cancel:"" });
}
(function initPontosG(){
  document.getElementById("pxCnpjBuscar").addEventListener("click", pxBuscarCnpj);
  pixSetCfgUI();
  pixAtualizarTrava();
  document.getElementById("pixTravaBtn").addEventListener("click", pixTravaClick);
  document.getElementById("pixSalvarCfg").addEventListener("click", function(){
    const cfg={ chave:document.getElementById("pixChave").value.trim(), nome:document.getElementById("pixNome").value.trim(), cidade:"Caicó" };
    if(!cfg.chave){ uiConfirm({ titulo:"Informe a chave Pix", msg:"Digite a chave Pix do supermercado para salvar.", ok:"Entendi", cancel:"" }); return; }
    localStorage.setItem("pix_config", JSON.stringify(cfg));
    pixCfgStatusUpd();
    const box=document.getElementById("pixCfgBox"); if(box) box.open=false;
    pixDesbloqueado=false; pixAtualizarTrava();
    uiConfirm({ titulo:"Chave Pix salva", msg:"Pronto! Agora é só clicar em \\u201cGerar Pix\\u201d em cada parcela.", ok:"Ok", cancel:"" });
  });
  document.getElementById("pxCnpj").addEventListener("keydown", function(ev){ if(ev.key==="Enter"){ ev.preventDefault(); pxBuscarCnpj(); } });
  // Ao escolher o número do ponto, preenche automaticamente o valor fixo daquele ponto.
  document.getElementById("pxNum").addEventListener("input", function(){
    const n=(this.value||"").trim();
    if(VALOR_FIXO[n]!=null){ document.getElementById("pxValor").value=VALOR_FIXO[n]; }
  });
  // Máscara de telefone do contato: (84) 99127-7474
  document.getElementById("pxTel").addEventListener("input", function(){ this.value=pxFmtTel(this.value); });
  document.getElementById("pxSalvar").addEventListener("click",()=>{
    const dados=pxLerForm();
    // Campos obrigatórios: todos, menos a Observação.
    ["pxNum","pxCnpj","pxForn","pxVend","pxTel","pxValor","pxPag","pxAbertura","pxVenc"].forEach(id=>document.getElementById(id).classList.remove("campo-erro"));
    const faltando=[];
    if(dados.numero==="") faltando.push(["pxNum","Nº do ponto"]);
    if(!dados.fornecedor) faltando.push(["pxCnpj","Fornecedor (busque pelo CNPJ)"]);
    if(!dados.vendedor) faltando.push(["pxVend","Vendedor"]);
    if(!dados.contato) faltando.push(["pxTel","Contato"]);
    if(!(dados.valor>0)) faltando.push(["pxValor","Valor"]);
    if(!dados.pagamento) faltando.push(["pxPag","Modo de pagamento"]);
    if(!dados.abertura) faltando.push(["pxAbertura","Abertura do contrato"]);
    if(!dados.vencimento) faltando.push(["pxVenc","Vencimento do contrato"]);
    if(faltando.length){
      faltando.forEach(f=>document.getElementById(f[0]).classList.add("campo-erro"));
      document.getElementById(faltando[0][0]).focus();
      uiConfirm({ titulo:"Campos obrigatórios", msg:"Preencha antes de salvar: "+faltando.map(f=>f[1]).join(", ")+".", ok:"Entendi", cancel:"" });
      return;
    }
    // O vencimento do contrato precisa ser depois da assinatura.
    if(dados.abertura && dados.vencimento && dados.vencimento<=dados.abertura){
      document.getElementById("pxAbertura").classList.add("campo-erro");
      document.getElementById("pxVenc").classList.add("campo-erro");
      uiConfirm({ titulo:"Datas do contrato", msg:"O vencimento do contrato precisa ser depois da data de abertura.", ok:"Entendi", cancel:"" });
      return;
    }
    // Limite de pontos: só de 1 a 21 (são 21 espaços físicos na loja)
    if(dados.numero!==""){
      const n=parseInt(dados.numero,10);
      if(isNaN(n) || n<1 || n>21){ alert("O número do ponto deve ser entre 1 e 21 (a loja tem 21 pontos)."); return; }
    }
    // Ponto já ocupado? Pergunta se quer substituir o fornecedor que está nele.
    const ocupado = dados.numero!=="" ? pontosG.find(x=>String(x.numero)===String(dados.numero) && x.id!==pxEditId) : null;
    if(ocupado){
      uiConfirm({
        titulo:"Ponto já ocupado",
        msg:"O ponto "+dados.numero+" já está ocupado por "+(ocupado.fornecedor||"(sem fornecedor)")+". Deseja substituir pelo novo fornecedor?",
        ok:"Substituir", cancel:"Cancelar"
      }).then(function(sim){
        if(!sim) return;
        Object.assign(ocupado, dados);
        if(pxEditId && pxEditId!==ocupado.id){ pontosG = pontosG.filter(x=>x.id!==pxEditId); } // remove o registro antigo duplicado
        savePontosG(); pxLimparForm(); renderPontosG();
      });
      return;
    }
    if(pxEditId){ const p=pontosG.find(x=>x.id===pxEditId); if(p) Object.assign(p, dados); }
    else { pontosG.push(Object.assign({id:"pg"+Date.now(), contrato:"", vencContrato:"", status:"NÃO PAGO"}, dados)); }
    savePontosG(); pxLimparForm(); renderPontosG();
  });
  document.getElementById("pxCancelar").addEventListener("click", pxLimparForm);
  document.getElementById("pxBusca").addEventListener("input", renderPontosG);
  document.getElementById("pxFiltroStatus").addEventListener("change", renderPontosG);
  document.getElementById("pxFiltroPagamento").addEventListener("change", renderPontosG);
  document.getElementById("pxFiltroVenc").addEventListener("change", renderPontosG);
  document.getElementById("pxTabela").addEventListener("click",(e)=>{
    const exp=e.target.closest("[data-exp]");
    if(exp){ const det=document.getElementById("det-"+exp.dataset.exp); if(det){ const ab=det.style.display==="none"; det.style.display=ab?"table-row":"none"; exp.classList.toggle("aberto",ab); } return; }
    const cview=e.target.closest("[data-cview]");
    if(cview){ e.preventDefault(); pxAbrirContrato(pontosG.find(x=>x.id===cview.dataset.cview)); return; }
    const cbtn=e.target.closest("[data-cfile-btn]");
    if(cbtn){ const inp=document.querySelector('[data-cfile="'+cbtn.dataset.cfileBtn+'"]'); if(inp) inp.click(); return; }
    const pixb=e.target.closest("[data-pix]");
    if(pixb){ const pr=pixb.dataset.pix.split("|"); const p=pontosG.find(x=>x.id===pr[0]); if(p) pxGerarPix(p,pr[1]); return; }
    const mark=e.target.closest("[data-marcarpago]");
    if(mark){ const pr=mark.dataset.marcarpago.split("|"); const p=pontosG.find(x=>x.id===pr[0]); if(p){ p.manuais=p.manuais||{}; p.manuais[pr[1]]="pendente"; savePontosG(); renderPontosG(); pxReabrir(p.id); uiConfirm({titulo:"Enviado para autorização",msg:"Pagamento marcado. Está AGUARDANDO a autorização do administrador (senha master) para ficar pago.",ok:"Ok",cancel:""}); } return; }
    const aut=e.target.closest("[data-autorizar]");
    if(aut){ const pr=aut.dataset.autorizar.split("|"); const p=pontosG.find(x=>x.id===pr[0]); if(p){ pxExigeMaster("Digite a senha master para AUTORIZAR este pagamento.").then(function(ok){ if(!ok) return; p.manuais=p.manuais||{}; p.manuais[pr[1]]="autorizado"; savePontosG(); renderPontosG(); pxReabrir(p.id); }); } return; }
    const rec=e.target.closest("[data-recusar]");
    if(rec){ const pr=rec.dataset.recusar.split("|"); const p=pontosG.find(x=>x.id===pr[0]); if(p&&p.manuais){ uiConfirm({titulo:"Recusar pagamento",msg:"Remover esta marcação de pagamento pendente?",ok:"Recusar",cancel:"Cancelar"}).then(function(sim){ if(!sim) return; delete p.manuais[pr[1]]; savePontosG(); renderPontosG(); pxReabrir(p.id); }); } return; }
    const desf=e.target.closest("[data-desfazerpago]");
    if(desf){ const pr=desf.dataset.desfazerpago.split("|"); const p=pontosG.find(x=>x.id===pr[0]); if(p&&p.manuais){ pxExigeMaster("Digite a senha master para DESFAZER este pagamento.").then(function(ok){ if(!ok) return; delete p.manuais[pr[1]]; savePontosG(); renderPontosG(); pxReabrir(p.id); }); } return; }
    const cpbtn=e.target.closest("[data-compfile-btn]");
    if(cpbtn){ const inp=document.querySelector('[data-compfile="'+cpbtn.dataset.compfileBtn+'"]'); if(inp) inp.click(); return; }
    const cpview=e.target.closest("[data-compview]");
    if(cpview){ e.preventDefault(); const pr=cpview.dataset.compview.split("|"); const p=pontosG.find(x=>x.id===pr[0]); const c=p&&p.comprovantes?p.comprovantes[pr[1]]:null; if(c) pxAbrirArquivo(c.arquivo); return; }
    const cprem=e.target.closest("[data-comprem]");
    if(cprem){ const pr=cprem.dataset.comprem.split("|"); const p=pontosG.find(x=>x.id===pr[0]); if(p&&p.comprovantes&&p.comprovantes[pr[1]]){ uiConfirm({ titulo:"Remover comprovante", msg:"Remover o comprovante desta parcela?", ok:"Remover", cancel:"Cancelar" }).then(function(sim){ if(!sim) return; delete p.comprovantes[pr[1]]; savePontosG(); renderPontosG(); pxReabrir(p.id); }); } return; }
    const crem=e.target.closest("[data-crem]");
    if(crem){ const p=pontosG.find(x=>x.id===crem.dataset.crem); if(p){ uiConfirm({ titulo:"Remover contrato", msg:"Remover o arquivo do contrato deste ponto?", ok:"Remover", cancel:"Cancelar" }).then(function(sim){ if(!sim) return; delete p.contratoArquivo; delete p.contratoNome; savePontosG(); renderPontosG(); pxReabrir(p.id); }); } return; }
    const cger=e.target.closest("[data-cgerar]");
    if(cger){ pxGerarContrato(pontosG.find(x=>x.id===cger.dataset.cgerar)); return; }
    const ed=e.target.closest("[data-edit]");
    if(ed){ const p=pontosG.find(x=>x.id===ed.dataset.edit); if(p){ pxEditId=p.id; pxPreencherForm(p);
      document.getElementById("pxFormTitulo").textContent="Editar ponto nº "+(p.numero||"");
      document.getElementById("pxSalvar").textContent="Salvar alterações";
      document.getElementById("pxCancelar").style.display="";
      window.scrollTo({top:0,behavior:"smooth"}); } return; }
    const del=e.target.closest("[data-del]");
    if(del){ const p=pontosG.find(x=>x.id===del.dataset.del); if(p){ uiConfirm({ titulo:"Remover ponto", msg:"Remover o ponto nº "+(p.numero||"")+" ("+(p.fornecedor||"sem fornecedor")+")?", ok:"Remover", cancel:"Cancelar" }).then(function(sim){ if(!sim) return; pontosG=pontosG.filter(x=>x.id!==del.dataset.del); savePontosG(); if(pxEditId===del.dataset.del) pxLimparForm(); renderPontosG(); }); } return; }
  });
  document.getElementById("pxTabela").addEventListener("change",(e)=>{
    const inp=e.target.closest("[data-cfile]");
    if(inp && inp.files && inp.files[0]){
      const f=inp.files[0];
      const id=inp.dataset.cfile;
      if(f.size > 3*1024*1024){ inp.value=""; uiConfirm({ titulo:"Arquivo muito grande", msg:"O contrato precisa ter no máximo 3 MB. Tente um PDF ou foto menor.", ok:"Entendi", cancel:"" }); return; }
      const reader=new FileReader();
      reader.onload=function(){
        const p=pontosG.find(x=>x.id===id);
        if(p){ p.contratoArquivo=reader.result; p.contratoNome=f.name; savePontosG(); renderPontosG(); pxReabrir(id); }
      };
      reader.readAsDataURL(f);
      return;
    }
    const cinp=e.target.closest("[data-compfile]");
    if(cinp && cinp.files && cinp.files[0]){
      const f=cinp.files[0];
      const pr=cinp.dataset.compfile.split("|");
      if(f.size > 3*1024*1024){ cinp.value=""; uiConfirm({ titulo:"Arquivo muito grande", msg:"O comprovante precisa ter no máximo 3 MB. Tente um PDF ou foto menor.", ok:"Entendi", cancel:"" }); return; }
      const reader=new FileReader();
      reader.onload=function(){
        const p=pontosG.find(x=>x.id===pr[0]);
        if(p){ if(!p.comprovantes) p.comprovantes={}; p.comprovantes[pr[1]]={arquivo:reader.result,nome:f.name}; savePontosG(); renderPontosG(); pxReabrir(p.id); }
      };
      reader.readAsDataURL(f);
      return;
    }
  });
  renderPontosG();
})();
function pxReabrir(id){
  const det=document.getElementById("det-"+id);
  const exp=document.querySelector('#pxTabela [data-exp="'+id+'"]');
  if(det){ det.style.display="table-row"; if(exp) exp.classList.add("aberto"); }
}

// ---- Mapa dos pontos de gôndola (planta da loja) ----
function mapaPonto(num){ return pontosG.find(p=>(+p.numero)===num); }
function mapaVencendo(p){
  if(!p) return false;
  const hoje=new Date(HOJE.getFullYear(),HOJE.getMonth(),HOJE.getDate());
  const d=pxParseData(p.vencimento); if(!d) return false;
  return (d-hoje)/86400000 <= 15;
}
function mapaClasse(num){
  const p=mapaPonto(num);
  let c="mapa-cap ";
  if(!p || !(p.fornecedor||"").trim()) c+="livre";
  else c+=(pxPagoMes(p)?"pago":"naopago");
  if(mapaVencendo(p)) c+=" venc";
  if(mapaSel===num) c+=" sel";
  return c;
}
function mapaShelves(n){ let s=""; for(let i=0;i<n;i++) s+="<i></i>"; return s; }
function mapaCap(num){ return '<button class="'+mapaClasse(num)+'" data-num="'+num+'">'+num+'</button>'; }
function mapaGondola(top,bot){
  return '<div class="mapa-gond">'+mapaCap(top)+
    '<div class="mapa-body">'+mapaShelves(8)+'</div>'+mapaCap(bot)+'</div>';
}
function renderMapa(){
  const wrap=document.getElementById("mapaLoja");
  if(!wrap) return;
  let html='<div class="mapa-entrada">Frente da loja · entrada e caixas</div>';
  html+='<div class="mapa-espaco"></div>';
  MAPA_GRUPOS.forEach(g=>{
    html+='<div class="mapa-grupo">';
    for(let i=0;i<g.topo.length;i++) html+=mapaGondola(g.topo[i], g.base[i]);
    html+='</div>';
  });
  // ponto 21 isolado, no canto direito
  html+='<div class="mapa-grupo"><div></div><div></div><div></div><div></div>'+
    '<div class="mapa-gond">'+mapaCap(21)+'<div class="mapa-body" style="grid-template-columns:1fr;">'+mapaShelves(1)+'</div></div></div>';
  wrap.innerHTML=html;
  const ocup=pontosG.filter(p=>(p.fornecedor||"").trim()).length;
  document.getElementById("mapaInfo").textContent=ocup+" de 21 pontos ocupados";
}
function mapaDetalhe(num){
  const el=document.getElementById("mapaDetalhe");
  const p=mapaPonto(num);
  if(!p || !(p.fornecedor||"").trim()){
    el.innerHTML='<div class="mapa-det-head free"><div class="pnum">Ponto '+num+'</div><div class="pforn">Ponto livre</div></div>'+
      '<div class="det-vazio">Nenhum fornecedor cadastrado neste ponto.</div>';
    return;
  }
  const stMes=pxStatusMes(p);
  const pago=stMes==="PAGO";
  const venc=mapaVencendo(p);
  const badge=venc?'<span class="mapa-det-badge">⚠ Vencendo</span>':'';
  const valLin=mapaEdit
    ? '<div class="lin editando"><b>Valor</b><span class="mapa-val-edit"><input type="text" id="mapaValInput" value="'+(p.valor?(+p.valor).toFixed(2).replace(".",","):"")+'" placeholder="0,00"><button type="button" data-valsave="'+num+'">Salvar</button></span></div>'
    : '<div class="lin"><b>Valor</b><span>'+(p.valor?brl(+p.valor):"—")+'</span></div>';
  el.innerHTML='<div class="mapa-det-head'+(pago?'':' off')+'">'+
      '<div class="pnum">Ponto '+num+'</div>'+
      '<div class="pforn">'+(p.fornecedor||"—")+'</div>'+
      '<span class="mapa-det-badge">'+(pago?'✓ Pago':'● Não pago')+'</span>'+badge+
    '</div>'+
    '<div class="mapa-det-body">'+
    '<div class="lin"><b>CNPJ</b><span>'+(p.cnpj?pxFmtCnpj(p.cnpj):"—")+'</span></div>'+
    '<div class="lin"><b>Razão social</b><span>'+(p.razaoSocial||"—")+'</span></div>'+
    '<div class="lin"><b>Vendedor</b><span>'+(p.vendedor||"—")+'</span></div>'+
    '<div class="lin"><b>Contato</b><span>'+(p.contato?pxFmtTel(p.contato):"—")+'</span></div>'+
    '<div class="lin"><b>E-mail</b><span>'+(p.email?('<a href="mailto:'+pxEsc(p.email)+'">'+pxEsc(p.email)+'</a>'):"—")+'</span></div>'+
    '<div class="lin"><b>Endereço</b><span>'+(p.endereco?pxEsc(p.endereco):"—")+'</span></div>'+
    valLin+
    '<div class="lin"><b>Pagamento</b><span>'+(p.pagamento||"—")+'</span></div>'+
    '<div class="lin"><b>Abertura</b><span>'+(pxFmtData(p.abertura)||"—")+'</span></div>'+
    '<div class="lin"><b>Venc. contrato</b><span>'+(pxFmtData(p.vencimento)||"—")+'</span></div>'+
    '<div class="lin"><b>Obs.</b><span>'+(p.obs||"—")+'</span></div>'+
    '</div>';
}
function mapaParseValor(s){
  s=(s||"").toString().trim().replace(/[^0-9.,]/g,"");
  if(!s) return null;
  // remove separador de milhar e usa vírgula como decimal
  if(s.indexOf(",")>=0){ s=s.replace(/\\./g,"").replace(",","."); }
  const v=parseFloat(s);
  return isNaN(v) ? null : v;
}
function mapaAtualizarBtn(){
  const btn=document.getElementById("mapaCfgBtn");
  const lbl=document.getElementById("mapaCfgLbl");
  if(!btn) return;
  btn.classList.toggle("ativo", mapaEdit);
  if(lbl) lbl.textContent = mapaEdit ? "Concluir edição" : "Editar preços";
}
async function mapaPedirAdmin(){
  if(!pixTemMaster()){
    const s1=await uiPrompt({ titulo:"Criar senha de administrador", msg:"Defina a senha master. Só quem tiver ela poderá alterar os preços dos pontos.", placeholder:"nova senha", ok:"Criar" });
    if(s1===null) return false;
    if(!s1.trim()){ uiConfirm({ titulo:"Senha vazia", msg:"Digite uma senha para continuar.", ok:"Entendi", cancel:"" }); return false; }
    const s2=await uiPrompt({ titulo:"Confirmar senha", msg:"Digite a senha novamente.", placeholder:"repita a senha", ok:"Confirmar" });
    if(s2===null) return false;
    if(s1!==s2){ uiConfirm({ titulo:"Senhas diferentes", msg:"As senhas não conferem. Tente de novo.", ok:"Entendi", cancel:"" }); return false; }
    localStorage.setItem("pix_master", pixHash(s1));
    pixDesbloqueado=true; return true;
  }
  if(pixDesbloqueado) return true;
  const s=await uiPrompt({ titulo:"Senha de administrador", msg:"Digite a senha master para editar os preços dos pontos.", placeholder:"senha", ok:"Desbloquear" });
  if(s===null) return false;
  if(pixHash(s)===localStorage.getItem("pix_master")){ pixDesbloqueado=true; return true; }
  uiConfirm({ titulo:"Senha incorreta", msg:"A senha não confere. Os preços continuam protegidos.", ok:"Entendi", cancel:"" });
  return false;
}
async function mapaToggleEdit(){
  if(mapaEdit){ mapaEdit=false; mapaAtualizarBtn(); if(mapaSel!=null) mapaDetalhe(mapaSel); return; }
  const ok=await mapaPedirAdmin();
  if(!ok) return;
  mapaEdit=true; mapaAtualizarBtn();
  if(mapaSel!=null) mapaDetalhe(mapaSel);
}
function mapaSalvarValor(num){
  const inp=document.getElementById("mapaValInput");
  if(!inp) return;
  const v=mapaParseValor(inp.value);
  if(v===null || v<0){ uiConfirm({ titulo:"Valor inválido", msg:"Digite um valor válido, por exemplo 350,00.", ok:"Entendi", cancel:"" }); return; }
  let p=mapaPonto(num);
  if(!p){ return; }
  // garante que o ponto exista no pontosG (não só no seed) antes de salvar
  if(!pontosG.some(function(x){ return +x.numero===+num; })){ p=Object.assign({}, p); pontosG.push(p); }
  p=pontosG.find(function(x){ return +x.numero===+num; });
  p.valor=v;
  savePontosG();
  if(typeof renderPontosG==="function") renderPontosG();
  renderMapa();
  mapaDetalhe(num);
}
(function initMapa(){
  const wrap=document.getElementById("mapaLoja");
  if(wrap) wrap.addEventListener("click",(e)=>{
    const cap=e.target.closest("[data-num]");
    if(!cap) return;
    mapaSel=+cap.dataset.num; renderMapa(); mapaDetalhe(mapaSel);
  });
  const cfg=document.getElementById("mapaCfgBtn");
  if(cfg) cfg.addEventListener("click", mapaToggleEdit);
  const det=document.getElementById("mapaDetalhe");
  if(det) det.addEventListener("click",(e)=>{
    const b=e.target.closest("[data-valsave]");
    if(!b) return;
    mapaSalvarValor(+b.dataset.valsave);
  });
  mapaAtualizarBtn();
  renderMapa();
})();

// ---- Organograma / Fluxograma (editor visual) ----
const ORG_CORES = ["#157a35","#1b9e4b","#e8820e","#8e44ad","#c0392b","#0e7c8b","#5a6678"];
function orgLoadDocs(){
  try{ const s=localStorage.getItem("organogramas"); if(s){ const o=JSON.parse(s); if(o&&o.lista&&o.lista.length){
    if(!o.lista.some(function(d){return d.geral;})){ const g=o.lista.find(function(d){return d.nome==="Geral";})||o.lista[0]; g.geral=true; g.nodes=[]; g.edges=[]; }
    // aproxima as caixas existentes do cabeçalho do setor (mesma distância da visão Geral)
    o.lista.forEach(function(d){
      if(d.geral||!d.nodes||!d.nodes.length) return;
      let minY=Infinity; d.nodes.forEach(function(n){ if(n.y<minY) minY=n.y; });
      if(minY>360){ const sh=minY-360; d.nodes.forEach(function(n){ n.y-=sh; }); }
    });
    return o;
  } } }catch(e){}
  const id="g"+Date.now().toString(36);
  return { ativo:id, lista:[{id:id, nome:"Geral", geral:true, nodes:[], edges:[]}] };
}
let orgDocs = orgLoadDocs();
function orgActiveDoc(){ return orgDocs.lista.find(d=>d.id===orgDocs.ativo)||orgDocs.lista[0]; }
function orgIsGeral(){ const d=orgActiveDoc(); return !!(d&&d.geral); }
function orgComposeGeral(){
  const nodes=[], edges=[]; let seq=0;
  const uid=function(p){ seq++; return "gv"+p+seq; };
  const NODEW=150, centerX=700, topY=40, dirY=152, setY=276, pasGap=116, COLPAD=45;
  const gdoc=orgActiveDoc();
  const topo={id:uid("t"),x:centerX-NODEW/2,y:topY,texto:"Supermercado Santa Rita",cor:"#157a35",forma:"ret"};
  const dir={id:"gvdir",x:centerX-NODEW/2,y:dirY,texto:(gdoc&&gdoc.dirTexto)||"Diretoria",nome:(gdoc&&gdoc.dirNome)||"",cor:"#0e5aa7",forma:"ret",gdir:true};
  nodes.push(topo,dir);
  edges.push({id:uid("e"),de:topo.id,para:dir.id,dport:"b",pport:"t"});
  const setores=orgDocs.lista.filter(function(d){return !d.geral;});
  const SCOL=["#2563a8","#c0392b","#8e44ad","#1f8f6a","#5a6678","#e8820e","#0e7c8b"];
  // mede o cluster de cada setor preservando o layout interno salvo
  const cols=setores.map(function(s){
    const sn=(s.nodes||[]);
    if(!sn.length) return {s:s, width:NODEW, minX:0, maxX:0, minY:0};
    let minX=Infinity,maxX=-Infinity,minY=Infinity;
    sn.forEach(function(n){ if(n.x<minX)minX=n.x; if(n.x>maxX)maxX=n.x; if(n.y<minY)minY=n.y; });
    return {s:s, width:Math.max(NODEW,(maxX-minX)+NODEW), minX:minX, maxX:maxX, minY:minY};
  });
  const totalW=cols.reduce(function(a,c){return a+c.width;},0)+COLPAD*Math.max(0,cols.length-1);
  let cursor=centerX - totalW/2;
  cols.forEach(function(c,i){
    const colCenter=cols.length===1?centerX:(cursor + c.width/2);
    const sx=Math.round(colCenter-NODEW/2);
    const sn={id:uid("s"),x:sx,y:setY,texto:c.s.nome,cor:SCOL[i%SCOL.length],forma:"ret"};
    nodes.push(sn);
    edges.push({id:uid("e"),de:dir.id,para:sn.id,dport:"b",pport:"t"});
    const list=(c.s.nodes||[]);
    if(list.length){
      // translada o cluster: centro alinhado ao setor, topo logo abaixo da caixa do setor
      const clusterCenterX=(c.minX+c.maxX+NODEW)/2;
      const dx=colCenter-clusterCenterX;
      const dy=(setY+pasGap)-c.minY;
      const idmap={};
      list.forEach(function(p){
        const np={id:uid("p"),x:Math.round(p.x+dx),y:Math.round(p.y+dy),texto:p.texto,nome:p.nome,cor:p.cor||"#e8820e",forma:p.forma||"ret"};
        idmap[p.id]=np.id;
        nodes.push(np);
      });
      const hasIn={};
      (c.s.edges||[]).forEach(function(e){ if(idmap[e.de]&&idmap[e.para]) hasIn[e.para]=true; });
      (c.s.edges||[]).forEach(function(e){
        if(idmap[e.de]&&idmap[e.para])
          edges.push({id:uid("e"),de:idmap[e.de],para:idmap[e.para],dport:e.dport||"b",pport:e.pport||"t",bend:e.bend});
      });
      // conecta a caixa do setor às raízes (nós sem aresta de entrada)
      list.forEach(function(p){ if(!hasIn[p.id]) edges.push({id:uid("e"),de:sn.id,para:idmap[p.id],dport:"b",pport:"t"}); });
    }
    cursor+=c.width+COLPAD;
  });
  return {nodes:nodes,edges:edges};
}
function orgComposeCtx(){
  const d=orgActiveDoc(); if(!d||d.geral) return {nodes:[],edges:[]};
  const gdoc=orgDocs.lista.find(function(g){return g.geral;});
  const ctxX=520, topo={id:"ctxtopo",x:ctxX,y:20,texto:"Supermercado Santa Rita",cor:"#157a35",forma:"ret",ctx:true};
  const dir={id:"ctxdir",x:ctxX,y:132,texto:(gdoc&&gdoc.dirTexto)||"Diretoria",nome:(gdoc&&gdoc.dirNome)||"",cor:"#0e5aa7",forma:"ret",ctx:true};
  const sec={id:"ctxsec",x:ctxX,y:244,texto:d.nome,cor:"#2563a8",forma:"ret",ctx:true};
  const nodes=[topo,dir,sec];
  const edges=[
    {id:"ctxe1",de:topo.id,para:dir.id,dport:"b",pport:"t",ctx:true},
    {id:"ctxe2",de:dir.id,para:sec.id,dport:"b",pport:"t",ctx:true}
  ];
  const hasIn={};
  orgData.edges.forEach(function(e){ hasIn[e.para]=true; });
  orgData.nodes.forEach(function(n){
    if(!hasIn[n.id]) edges.push({id:"ctxr_"+n.id,de:sec.id,para:n.id,dport:"b",pport:"t",ctx:true});
  });
  return {nodes:nodes,edges:edges};
}
function orgNodeHtmlRO(n){
  let cls="org-node";
  if(n.ctx) cls+=" org-ctx";
  if(n.gdir) cls+=" org-gedit";
  if(n.forma==="dec") cls+=" dec"; else if(n.forma==="fim") cls+=" fim";
  const sub=n.gdir?'<span class="org-sub">'+orgEsc(n.nome||"")+'</span>'
    :(n.nome?'<span class="org-sub">'+orgEsc(n.nome)+'</span>':'');
  return '<div class="'+cls+'" data-id="'+n.id+'" style="left:'+n.x+'px;top:'+n.y+'px;">'+
    '<div class="org-shape" style="background:'+(n.cor||"#157a35")+';"></div>'+
    '<div class="org-stack"><span class="org-txt">'+orgEsc(n.texto)+'</span>'+
    sub+'</div></div>';
}
function orgUpdateToolbar(ro){
  ["orgAdd","orgExemplo","orgLimpar","orgConectar","orgForma","orgCores"].forEach(function(id){
    const el=document.getElementById(id); if(!el) return;
    el.style.opacity=ro?"0.45":""; el.style.pointerEvents=ro?"none":"";
  });
}
let orgData = (function(){ const d=orgActiveDoc(); return {nodes:d.nodes||[], edges:d.edges||[]}; })();
let orgShape = "ret", orgCor = ORG_CORES[0];
let orgSel = null, orgSrc = null, orgConnect = false, orgDrag = null, orgPan = null, orgSeq = 0, orgZoom = 1, orgTX = 0, orgTY = 0;
let orgMulti = [], orgMarquee = null, orgHandleDrag = null, orgSelEdge = null, orgEdgeDrag = null, orgClip = null;
let orgCtx = {nodes:[],edges:[]};
function orgUid(p){ orgSeq++; return p+Date.now().toString(36)+orgSeq; }
function orgSelIds(){ return orgMulti.length?orgMulti.slice():(orgSel?[orgSel]:[]); }
function orgShowTemp(x1,y1,x2,y2){
  const svg=document.getElementById("orgSvg"); if(!svg) return;
  let ln=document.getElementById("orgTempLine");
  if(!ln){ const NS="http://www.w3.org/2000/svg"; ln=document.createElementNS(NS,"line"); ln.setAttribute("id","orgTempLine"); ln.setAttribute("stroke","#157a35"); ln.setAttribute("stroke-width","2.5"); ln.setAttribute("stroke-dasharray","6 4"); ln.setAttribute("marker-end","url(#orgArrow)"); ln.style.pointerEvents="none"; svg.appendChild(ln); }
  ln.setAttribute("x1",x1); ln.setAttribute("y1",y1); ln.setAttribute("x2",x2); ln.setAttribute("y2",y2);
}
function orgHideTemp(){ const ln=document.getElementById("orgTempLine"); if(ln) ln.remove(); }
function orgShowPorts(c,active){
  const svg=document.getElementById("orgSvg"); if(!svg) return;
  const NS="http://www.w3.org/2000/svg";
  let g=document.getElementById("orgPortG");
  if(!g){ g=document.createElementNS(NS,"g"); g.setAttribute("id","orgPortG"); g.style.pointerEvents="none"; svg.appendChild(g); }
  while(g.firstChild) g.removeChild(g.firstChild);
  ["t","r","b","l"].forEach(function(p){
    const a=orgPortAnchor(c,p); const on=(p===active);
    const d=document.createElementNS(NS,"circle");
    d.setAttribute("cx",a.x); d.setAttribute("cy",a.y);
    d.setAttribute("r",on?"7":"5");
    d.setAttribute("fill",on?"#157a35":"#fff");
    d.setAttribute("stroke",on?"#fff":"#157a35");
    d.setAttribute("stroke-width",on?"2.5":"2");
    g.appendChild(d);
  });
}
function orgHidePorts(){ const g=document.getElementById("orgPortG"); if(g) g.remove(); }
function orgApplyTransform(){
  const inner=document.getElementById("orgInner"); if(!inner) return;
  inner.style.transformOrigin="0 0";
  inner.style.transform="translate("+orgTX+"px,"+orgTY+"px) scale("+orgZoom+")";
}
// centraliza a estrutura na área visível (usado ao abrir/trocar de setor; preserva o pan durante a edição)
function orgCenterView(){
  const cv=document.querySelector(".org-canvas"); const inner=document.getElementById("orgInner");
  if(!cv||!inner){ orgTX=0; orgTY=0; orgApplyTransform(); return; }
  if(orgIsGeral()){ orgTX=0; orgTY=0; orgApplyTransform(); return; }
  const all=orgData.nodes.concat((orgCtx&&orgCtx.nodes)||[]);
  if(!all.length){ orgTX=0; orgTY=0; orgApplyTransform(); return; }
  let minX=Infinity,minY=Infinity,maxX=0,maxY=0;
  all.forEach(function(n){ if(n.x<minX)minX=n.x; if(n.y<minY)minY=n.y; if(n.x>maxX)maxX=n.x; if(n.y>maxY)maxY=n.y; });
  const cx=(minX+maxX+150)/2, cy=(minY+maxY+46)/2;
  const contentH=(maxY-minY+46)*orgZoom;
  orgTX=Math.round(cv.clientWidth/2 - cx*orgZoom);
  orgTY=contentH<=cv.clientHeight-20 ? Math.round(cv.clientHeight/2 - cy*orgZoom) : Math.round(20 - minY*orgZoom);
  orgApplyTransform();
}
// ajusta o zoom para que TODO o organograma caiba na área visível, e centraliza
function orgFitView(){
  const cv=document.querySelector(".org-canvas"); const inner=document.getElementById("orgInner");
  if(!cv||!inner) return;
  const all=orgData.nodes.concat((orgCtx&&orgCtx.nodes)||[]);
  if(!all.length){ orgCenterView(); return; }
  let minX=Infinity,minY=Infinity,maxX=0,maxY=0;
  all.forEach(function(n){ if(n.x<minX)minX=n.x; if(n.y<minY)minY=n.y; if(n.x>maxX)maxX=n.x; if(n.y>maxY)maxY=n.y; });
  const contentW=(maxX-minX)+150, contentH=(maxY-minY)+46;
  const pad=40;
  let z=Math.min((cv.clientWidth-pad)/contentW, (cv.clientHeight-pad)/contentH);
  z=Math.min(1.8,Math.max(0.2,z));
  orgZoom=Math.round(z*100)/100;
  const lbl=document.getElementById("orgZoomLbl"); if(lbl) lbl.textContent=Math.round(orgZoom*100)+"%";
  const cx=(minX+maxX+150)/2, cy=(minY+maxY+46)/2;
  orgTX=Math.round(cv.clientWidth/2 - cx*orgZoom);
  orgTY=Math.round(cv.clientHeight/2 - cy*orgZoom);
  orgApplyTransform();
}
function orgSetZoom(z, ax, ay){
  const cv=document.querySelector(".org-canvas");
  const old=orgZoom;
  orgZoom=Math.min(1.8,Math.max(0.4,Math.round(z*100)/100));
  const lbl=document.getElementById("orgZoomLbl"); if(lbl) lbl.textContent=Math.round(orgZoom*100)+"%";
  // mantém o ponto sob o cursor (ou centro da janela) fixo após o zoom (vale também para o Geral)
  if(cv && typeof ax==="number"){
    const rect=cv.getBoundingClientRect();
    const sx=ax-rect.left, sy=ay-rect.top;
    const cpx=(sx-orgTX)/old, cpy=(sy-orgTY)/old;
    orgTX=Math.round(sx-cpx*orgZoom);
    orgTY=Math.round(sy-cpy*orgZoom);
  }
  orgApplyTransform();
}
let orgHist = [], orgPrev = JSON.stringify(orgData);
function orgPersist(){ try{ const d=orgActiveDoc(); if(d&&!d.geral){ d.nodes=orgData.nodes; d.edges=orgData.edges; } localStorage.setItem("organogramas", JSON.stringify(orgDocs)); }catch(e){} }
function orgSave(){ if(orgIsGeral()) return; orgHist.push(orgPrev); if(orgHist.length>60) orgHist.shift(); orgPrev=JSON.stringify(orgData); orgPersist(); }
function orgUndo(){ if(!orgHist.length) return; const prev=orgHist.pop(); orgData=JSON.parse(prev); orgPrev=prev; orgSel=null; orgMulti=[]; orgSelEdge=null; orgSrc=null; orgPersist(); renderOrg(); }
function orgRenderTabs(){
  const el=document.getElementById("orgTabs"); if(!el) return;
  let h="";
  orgDocs.lista.forEach(function(d){
    const on=d.id===orgDocs.ativo;
    const canDel=orgDocs.lista.length>1&&!d.geral;
    h+='<span class="org-tab'+(on?" on":"")+'" data-tab="'+d.id+'">'+orgEsc(d.nome)+(canDel?'<span class="org-tab-x" data-del="'+d.id+'" title="Remover">✕</span>':'')+'</span>';
  });
  h+='<button class="org-tab-add" id="orgTabAdd">＋ Novo setor</button>';
  el.innerHTML=h;
}
function orgSwitchDoc(id){
  if(id===orgDocs.ativo) return;
  const cur=orgActiveDoc(); if(cur&&!cur.geral){ cur.nodes=orgData.nodes; cur.edges=orgData.edges; }
  orgDocs.ativo=id;
  const d=orgActiveDoc();
  orgData={nodes:(d.nodes||[]).slice(), edges:(d.edges||[]).slice()};
  orgSel=null; orgMulti=[]; orgSelEdge=null; orgSrc=null;
  orgHist=[]; orgPrev=JSON.stringify(orgData);
  try{ localStorage.setItem("organogramas", JSON.stringify(orgDocs)); }catch(e){}
  orgRenderTabs(); renderOrg(); orgCenterView();
}
function orgNewDoc(){
  const cur=orgActiveDoc(); if(cur&&!cur.geral){ cur.nodes=orgData.nodes; cur.edges=orgData.edges; }
  const id="s"+Date.now().toString(36);
  orgDocs.lista.push({id:id, nome:"Novo setor", nodes:[], edges:[]});
  orgDocs.ativo=id;
  orgData={nodes:[], edges:[]};
  orgSel=null; orgMulti=[]; orgSelEdge=null; orgSrc=null;
  orgHist=[]; orgPrev=JSON.stringify(orgData);
  try{ localStorage.setItem("organogramas", JSON.stringify(orgDocs)); }catch(e){}
  orgRenderTabs(); renderOrg();
  orgEditTab(id, true);
}
function orgEditTab(id, isNew){
  const d=orgDocs.lista.find(x=>x.id===id); if(!d) return;
  const tab=document.querySelector('.org-tab[data-tab="'+id+'"]'); if(!tab) return;
  if(tab.getAttribute("data-editing")==="1") return;
  tab.setAttribute("data-editing","1");
  const x=tab.querySelector(".org-tab-x"); if(x) x.style.display="none";
  const inp=document.createElement("input");
  inp.type="text"; inp.value=d.nome; inp.className="org-tab-input";
  tab.textContent=""; tab.appendChild(inp);
  inp.focus(); inp.select();
  let done=false;
  function finish(save){ if(done) return; done=true;
    inp.removeEventListener("blur",onBlur); inp.removeEventListener("keydown",onKey);
    if(save){ const v=(inp.value||"").trim(); d.nome=v||(isNew?"Novo setor":d.nome);
      try{ localStorage.setItem("organogramas", JSON.stringify(orgDocs)); }catch(e){} }
    orgRenderTabs();
    if(save&&isNew&&orgDocs.ativo===id&&!orgData.nodes.length){
      orgAdd(); const nid=orgSel; if(nid) orgRename(nid,"texto",true);
    } else if(save&&orgDocs.ativo===id){
      renderOrg();
    }
  }
  function onBlur(){ finish(true); }
  function onKey(ev){ ev.stopPropagation();
    if(ev.key==="Enter"){ ev.preventDefault(); finish(true); }
    else if(ev.key==="Escape"){ ev.preventDefault(); finish(false); }
  }
  inp.addEventListener("blur",onBlur);
  inp.addEventListener("keydown",onKey);
}
function orgDelDoc(id){
  if(orgDocs.lista.length<=1) return;
  const d=orgDocs.lista.find(x=>x.id===id); if(!d||d.geral) return;
  if(!confirm('Remover o organograma "'+d.nome+'"? Isso apaga as caixas dele.')) return;
  orgDocs.lista=orgDocs.lista.filter(x=>x.id!==id);
  if(orgDocs.ativo===id) orgDocs.ativo=orgDocs.lista[0].id;
  const ad=orgActiveDoc();
  orgData={nodes:(ad.nodes||[]).slice(), edges:(ad.edges||[]).slice()};
  orgSel=null; orgMulti=[]; orgSelEdge=null; orgSrc=null;
  orgHist=[]; orgPrev=JSON.stringify(orgData);
  try{ localStorage.setItem("organogramas", JSON.stringify(orgDocs)); }catch(e){}
  orgRenderTabs(); renderOrg();
}
function orgEsc(s){ return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

function orgNodeHtml(n){
  let cls="org-node";
  if(n.forma==="dec") cls+=" dec"; else if(n.forma==="fim") cls+=" fim";
  if(orgSel===n.id||orgMulti.indexOf(n.id)>=0) cls+=" sel";
  if(orgSrc===n.id) cls+=" src";
  return '<div class="'+cls+'" data-id="'+n.id+'" style="left:'+n.x+'px;top:'+n.y+'px;">'+
    '<div class="org-shape" style="background:'+(n.cor||"#157a35")+';"></div>'+
    '<div class="org-stack"><span class="org-txt">'+orgEsc(n.texto)+'</span>'+
    '<span class="org-sub">'+orgEsc(n.nome||"")+'</span></div>'+
    '<button class="org-del" data-del="'+n.id+'" title="Excluir">×</button>'+
    '<button class="org-handle t" data-h="t" data-id="'+n.id+'" title="Nova caixa acima">＋</button>'+
    '<button class="org-handle r" data-h="r" data-id="'+n.id+'" title="Nova caixa à direita">＋</button>'+
    '<button class="org-handle b" data-h="b" data-id="'+n.id+'" title="Nova caixa abaixo">＋</button>'+
    '<button class="org-handle l" data-h="l" data-id="'+n.id+'" title="Nova caixa à esquerda">＋</button></div>';
}
function orgBranch(id, dir){
  if(orgIsGeral()) return;
  const src=orgData.nodes.find(x=>x.id===id); if(!src) return;
  const W=160, H=70, GAP=55;
  let x=src.x, y=src.y;
  if(dir==="b") y=src.y+H+GAP; else if(dir==="t") y=src.y-H-GAP;
  else if(dir==="r") x=src.x+W+GAP; else if(dir==="l") x=src.x-W-GAP;
  const nn={ id:orgUid("n"), x:Math.max(0,x), y:Math.max(0,y), texto:"Nova caixa", cor:orgCor, forma:orgShape };
  orgData.nodes.push(nn);
  let ed;
  if(dir==="t") ed={id:orgUid("e"),de:nn.id,para:id,dport:"b",pport:"t"};
  else if(dir==="l") ed={id:orgUid("e"),de:nn.id,para:id};
  else if(dir==="b") ed={id:orgUid("e"),de:id,para:nn.id,dport:"b",pport:"t"};
  else ed={id:orgUid("e"),de:id,para:nn.id};
  orgData.edges.push(ed);
  if(dir==="b") orgLayoutTree();
  orgSel=nn.id; orgSave(); renderOrg();
}
function orgBranchSibling(id){
  if(orgIsGeral()) return;
  // cria caixa "ao lado" como irmã: novo filho do mesmo pai (entra na organização lado a lado)
  const pe=orgData.edges.find(function(e){ return e.para===id && e.dport==="b" && e.pport==="t"; });
  if(pe) orgBranch(pe.de,"b");
  else orgBranch(id,"r");
}
function orgLayoutTree(){
  const W=150, H=70, ROWGAP=70, COLGAP=45;
  const childrenOf={}, parentOf={};
  orgData.edges.forEach(function(e){
    if(e.dport==="b"&&e.pport==="t"){
      (childrenOf[e.de]=childrenOf[e.de]||[]).push(e.para);
      parentOf[e.para]=e.de;
    }
  });
  const byId={}; orgData.nodes.forEach(function(n){ byId[n.id]=n; });
  const roots=orgData.nodes.filter(function(n){ return !parentOf[n.id]&&childrenOf[n.id]; }).map(function(n){ return n.id; });
  if(!roots.length) return;
  const xunit={}, depth={};
  let cursor=0;
  function assign(id,d){
    depth[id]=d;
    const kids=(childrenOf[id]||[]).filter(function(c){ return byId[c]; });
    if(!kids.length){ xunit[id]=cursor; cursor++; return; }
    kids.forEach(function(c){ assign(c,d+1); });
    xunit[id]=(xunit[kids[0]]+xunit[kids[kids.length-1]])/2;
  }
  roots.forEach(function(r){ assign(r,0); cursor++; });
  const anchor=byId[roots[0]];
  const ox=anchor.x - xunit[roots[0]]*(W+COLGAP);
  const oy=anchor.y;
  const placed=[];
  Object.keys(depth).forEach(function(id){
    const n=byId[id];
    n.x=Math.round(ox + xunit[id]*(W+COLGAP));
    n.y=Math.round(oy + depth[id]*(H+ROWGAP));
    placed.push(n);
  });
  let minX=Infinity; placed.forEach(function(n){ if(n.x<minX) minX=n.x; });
  if(minX<20){ const sh=20-minX; placed.forEach(function(n){ n.x+=sh; }); }
  orgData.edges.forEach(function(e){ if(e.dport==="b"&&e.pport==="t") e.bend=null; });
}
function orgCenter(el){ return {x:el.offsetLeft+el.offsetWidth/2, y:el.offsetTop+el.offsetHeight/2, hx:el.offsetWidth/2, hy:el.offsetHeight/2}; }
function orgNodeAt(clientX, clientY, exceptId){
  // 1) tenta direto pelo elemento sob o cursor (caixa ou bolinha)
  const el=document.elementFromPoint(clientX, clientY);
  const direct=el&&el.closest&&el.closest('.org-node');
  if(direct&&direct.dataset.id!==exceptId) return direct;
  // 2) fallback por geometria: acha a caixa cuja área (com margem p/ as bolinhas) contém o ponto
  const inner=document.querySelector('.org-inner'); if(!inner) return null;
  const r=inner.getBoundingClientRect();
  const px=(clientX-r.left)/orgZoom, py=(clientY-r.top)/orgZoom;
  const PAD=12;
  let best=null;
  inner.querySelectorAll('.org-node').forEach(nd=>{
    if(nd.dataset.id===exceptId) return;
    const x1=nd.offsetLeft-PAD, y1=nd.offsetTop-PAD, x2=nd.offsetLeft+nd.offsetWidth+PAD, y2=nd.offsetTop+nd.offsetHeight+PAD;
    if(px>=x1&&px<=x2&&py>=y1&&py<=y2) best=nd;
  });
  return best;
}
function orgBorder(c, tx, ty){
  const dx=tx-c.x, dy=ty-c.y; if(dx===0&&dy===0) return {x:c.x,y:c.y};
  const s=Math.min(c.hx/Math.abs(dx||0.0001), c.hy/Math.abs(dy||0.0001));
  return {x:c.x+dx*s, y:c.y+dy*s};
}
function orgPortAnchor(c,p){
  if(p==="t") return {x:c.x, y:c.y-c.hy, nx:0, ny:-1};
  if(p==="b") return {x:c.x, y:c.y+c.hy, nx:0, ny:1};
  if(p==="l") return {x:c.x-c.hx, y:c.y, nx:-1, ny:0};
  return {x:c.x+c.hx, y:c.y, nx:1, ny:0};
}
function orgAutoPort(cFrom,cTo){
  const dx=cTo.x-cFrom.x, dy=cTo.y-cFrom.y;
  if(Math.abs(dy)>=Math.abs(dx)) return dy>=0?"b":"t";
  return dx>=0?"r":"l";
}
function orgTreePorts(cf,ct){
  if(ct.y-ct.hy >= cf.y+cf.hy-2) return {d:"b",p:"t"};
  if(ct.y+ct.hy <= cf.y-cf.hy+2) return {d:"t",p:"b"};
  return ct.x>=cf.x ? {d:"r",p:"l"} : {d:"l",p:"r"};
}
function orgElbowPts(ca,cb,bend,dport,pport){
  if(dport&&pport){
    const stub=22;
    const A=orgPortAnchor(ca,dport), B=orgPortAnchor(cb,pport);
    const s1={x:A.x+A.nx*stub, y:A.y+A.ny*stub};
    const t1={x:B.x+B.nx*stub, y:B.y+B.ny*stub};
    const sV=(dport==="t"||dport==="b"), tV=(pport==="t"||pport==="b");
    const pts=[{x:A.x,y:A.y},{x:s1.x,y:s1.y}];
    const mg=24;
    if(sV&&tV){
      if(dport!==pport){ const m=(bend!=null?bend:(s1.y+t1.y)/2); pts.push({x:s1.x,y:m},{x:t1.x,y:m}); }
      else { const lt=Math.min(ca.x-ca.hx,cb.x-cb.hx)-mg, rt=Math.max(ca.x+ca.hx,cb.x+cb.hx)+mg, lx=(Math.abs(s1.x-lt)<=Math.abs(s1.x-rt))?lt:rt; pts.push({x:lx,y:s1.y},{x:lx,y:t1.y}); }
    }
    else if(!sV&&!tV){
      if(dport!==pport){ const m=(bend!=null?bend:(s1.x+t1.x)/2); pts.push({x:m,y:s1.y},{x:m,y:t1.y}); }
      else { const tp=Math.min(ca.y-ca.hy,cb.y-cb.hy)-mg, bt=Math.max(ca.y+ca.hy,cb.y+cb.hy)+mg, ly=(Math.abs(s1.y-tp)<=Math.abs(s1.y-bt))?tp:bt; pts.push({x:s1.x,y:ly},{x:t1.x,y:ly}); }
    }
    else if(sV&&!tV){ pts.push({x:t1.x,y:s1.y}); }
    else { pts.push({x:s1.x,y:t1.y}); }
    pts.push({x:t1.x,y:t1.y},{x:B.x,y:B.y});
    return pts;
  }
  const dx=cb.x-ca.x, dy=cb.y-ca.y;
  if(Math.abs(dy)>=Math.abs(dx)){
    const sB=ca.y+(dy>=0?ca.hy:-ca.hy), tB=cb.y+(dy>=0?-cb.hy:cb.hy), m=(bend!=null?bend:(sB+tB)/2);
    return [{x:ca.x,y:sB},{x:ca.x,y:m},{x:cb.x,y:m},{x:cb.x,y:tB}];
  } else {
    const sB=ca.x+(dx>=0?ca.hx:-ca.hx), tB=cb.x+(dx>=0?-cb.hx:cb.hx), m=(bend!=null?bend:(sB+tB)/2);
    return [{x:sB,y:ca.y},{x:m,y:ca.y},{x:m,y:cb.y},{x:tB,y:cb.y}];
  }
}
function orgDropSide(node, clientX, clientY){
  const r=node.getBoundingClientRect();
  const ndx=(clientX-(r.left+r.right)/2)/((r.width/2)||1);
  const ndy=(clientY-(r.top+r.bottom)/2)/((r.height/2)||1);
  if(Math.abs(ndx)>Math.abs(ndy)) return ndx>0?"r":"l";
  return ndy>0?"b":"t";
}
function orgRoundPath(pts,r){
  if(!pts.length) return "";
  let d="M"+pts[0].x+","+pts[0].y;
  for(let i=1;i<pts.length-1;i++){
    const p0=pts[i-1],p1=pts[i],p2=pts[i+1];
    const v1x=p0.x-p1.x,v1y=p0.y-p1.y,v2x=p2.x-p1.x,v2y=p2.y-p1.y;
    const l1=Math.hypot(v1x,v1y)||1,l2=Math.hypot(v2x,v2y)||1,rr=Math.min(r,l1/2,l2/2);
    d+=" L"+(p1.x+v1x/l1*rr)+","+(p1.y+v1y/l1*rr)+" Q"+p1.x+","+p1.y+" "+(p1.x+v2x/l2*rr)+","+(p1.y+v2y/l2*rr);
  }
  const L=pts[pts.length-1]; d+=" L"+L.x+","+L.y; return d;
}
function orgDrawEdges(){
  const svg=document.getElementById("orgSvg"); if(!svg) return;
  Array.prototype.slice.call(svg.querySelectorAll(".org-edge")).forEach(e=>e.remove());
  const NS="http://www.w3.org/2000/svg";
  const allEdges=orgData.edges.concat(orgCtx&&orgCtx.edges?orgCtx.edges:[]);
  allEdges.forEach(ed=>{
    const a=document.querySelector('.org-node[data-id="'+ed.de+'"]');
    const b=document.querySelector('.org-node[data-id="'+ed.para+'"]');
    if(!a||!b) return;
    const ca=orgCenter(a), cb=orgCenter(b);
    const pts=orgElbowPts(ca,cb,ed.bend,ed.dport,ed.pport), d=orgRoundPath(pts,12), sel=(!ed.ctx&&ed.id===orgSelEdge);
    const g=document.createElementNS(NS,"g"); g.setAttribute("class","org-edge");
    const ln=document.createElementNS(NS,"path");
    ln.setAttribute("d",d); ln.setAttribute("fill","none");
    ln.setAttribute("stroke",sel?"#157a35":"#5a6a7d"); ln.setAttribute("stroke-width",sel?"3.5":"2.8"); ln.setAttribute("stroke-linejoin","round"); ln.setAttribute("stroke-linecap","round"); ln.setAttribute("marker-end","url(#orgArrow)");
    g.appendChild(ln);
    if(!ed.ctx){ const hit=document.createElementNS(NS,"path"); hit.setAttribute("class","hit"); hit.setAttribute("data-edge",ed.id); hit.setAttribute("d",d); hit.setAttribute("fill","none"); g.appendChild(hit); }
    if(sel){
      for(let i=0;i<pts.length-1;i++){
        const mx=(pts[i].x+pts[i+1].x)/2, my=(pts[i].y+pts[i+1].y)/2;
        if(Math.abs(pts[i].x-pts[i+1].x)<1&&Math.abs(pts[i].y-pts[i+1].y)<1) continue;
        const dot=document.createElementNS(NS,"circle"); dot.setAttribute("class","org-ehmid"); dot.setAttribute("data-edge",ed.id); dot.setAttribute("cx",mx); dot.setAttribute("cy",my); dot.setAttribute("r",5); g.appendChild(dot);
      }
      const ends=[["de",pts[0]],["para",pts[pts.length-1]]];
      ends.forEach(en=>{ const c=document.createElementNS(NS,"circle"); c.setAttribute("class","org-eh"); c.setAttribute("data-edge",ed.id); c.setAttribute("data-end",en[0]); c.setAttribute("cx",en[1].x); c.setAttribute("cy",en[1].y); c.setAttribute("r",6); g.appendChild(c); });
    }
    svg.appendChild(g);
  });
}
function renderOrg(){
  const inner=document.getElementById("orgInner"); if(!inner) return;
  const ro=orgIsGeral();
  if(ro) orgData=orgComposeGeral();
  orgCtx=ro?{nodes:[],edges:[]}:orgComposeCtx();
  // dimensiona o quadro e, no Geral, centraliza a estrutura na largura visível
  (function(){
    const all=orgData.nodes.concat(orgCtx.nodes||[]);
    let minX=Infinity,maxX=0,maxY=0;
    all.forEach(function(n){ if(n.x<minX)minX=n.x; if(n.x>maxX)maxX=n.x; if(n.y>maxY)maxY=n.y; });
    const NODEW=150;
    if(minX===Infinity){ inner.style.width="1800px"; inner.style.height="1100px"; return; }
    const contentW=(maxX-minX)+NODEW;
    let innerW;
    if(ro){
      const cv=document.querySelector(".org-canvas");
      const vw=cv?Math.max(600,cv.clientWidth/orgZoom):1800;
      innerW=Math.max(vw, contentW+80);
      const shift=Math.round((innerW-contentW)/2 - minX);
      orgData.nodes.forEach(function(n){ n.x+=shift; });
    } else {
      innerW=Math.max(1800, maxX+NODEW+80);
    }
    inner.style.width=Math.round(innerW)+"px";
    inner.style.height=Math.max(1100, maxY+46+80)+"px";
  })();
  const ctxNodes=orgCtx.nodes.map(orgNodeHtmlRO).join("");
  const nodes=orgData.nodes.map(ro?orgNodeHtmlRO:orgNodeHtml).join("");
  inner.innerHTML='<svg class="org-svg" id="orgSvg"><defs><marker id="orgArrow" markerWidth="10" markerHeight="8" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#7a8696"></path></marker></defs></svg>'+ctxNodes+nodes;
  inner.classList.toggle("org-ro",ro);
  const msg=document.getElementById("orgGeralMsg"); if(msg) msg.style.display=ro?"block":"none";
  orgUpdateToolbar(ro);
  const hintEl=document.getElementById("orgHint");
  if(hintEl){
    const hasCtx=orgCtx.nodes.length>0;
    hintEl.style.display=(!ro&&!hasCtx&&!orgData.nodes.length)?"block":"none";
  }
  orgDrawEdges();
  if(ro){ orgTX=0; orgTY=0; }
  orgApplyTransform();
}
function orgAdd(){
  if(orgIsGeral()) return;
  const k=orgData.nodes.length;
  let cx, cy;
  if(orgCtx.nodes.length){
    // setor: nova caixa sempre na coluna do setor, abaixo da última caixa (nunca em cima do cabeçalho travado)
    cx=520;
    let maxY=360;
    orgData.nodes.forEach(function(n){ if(n.y+110>maxY) maxY=n.y+110; });
    cy=k?maxY:360;
  } else {
    const canvas=document.querySelector(".org-canvas");
    cx=760; cy=70;
    if(canvas){ cx=(canvas.clientWidth/2 - orgTX)/orgZoom - 75; cy=(80 - orgTY)/orgZoom; }
    cx+=(k%5)*24; cy+=(k%5)*24;
  }
  orgData.nodes.push({ id:orgUid("n"), x:Math.max(0,cx), y:Math.max(0,cy), texto:"Nova caixa", cor:orgCor, forma:orgShape });
  orgSel=orgData.nodes[orgData.nodes.length-1].id; orgSave(); renderOrg();
}
function orgConnectClick(id){
  if(orgIsGeral()) return;
  if(!orgSrc){ orgSrc=id; renderOrg(); return; }
  if(id!==orgSrc) orgData.edges.push({ id:orgUid("e"), de:orgSrc, para:id });
  orgSrc=null; orgSave(); renderOrg();
}
function orgRename(id, field, fresh){
  const isG=orgIsGeral();
  if(isG && id!=="gvdir") return;
  const n=orgData.nodes.find(x=>x.id===id); if(!n) return;
  const node=document.querySelector('.org-node[data-id="'+id+'"]'); if(!node) return;
  field=field==="nome"?"nome":"texto";
  const txt=node.querySelector(field==="nome"?".org-sub":".org-txt"); if(!txt) return;
  if(txt.getAttribute("contenteditable")==="true") return;
  orgSel=id; orgMulti=[]; orgSelEdge=null;
  txt.setAttribute("contenteditable","true");
  txt.style.cursor="text"; txt.style.outline="none";
  txt.focus();
  const sel=window.getSelection(), range=document.createRange(); range.selectNodeContents(txt); sel.removeAllRanges(); sel.addRange(range);
  let done=false;
  function finish(save, next){ if(done) return; done=true;
    txt.removeEventListener("blur",onBlur); txt.removeEventListener("keydown",onKey);
    txt.removeAttribute("contenteditable");
    if(save){ const v=(txt.textContent||"").trim();
      if(isG){
        const gdoc=orgActiveDoc();
        if(gdoc){ if(field==="nome") gdoc.dirNome=v; else gdoc.dirTexto=v||"Diretoria"; }
        try{ localStorage.setItem("organogramas", JSON.stringify(orgDocs)); }catch(e){}
      } else {
        if(field==="nome") n.nome=v; else n.texto=v||"(vazio)";
        // cada renomeação é um passo de desfazer próprio (nome, depois cargo, depois a caixa)
        orgSave();
      }
    }
    if(txt.blur) txt.blur();
    if(next==="nome"){ renderOrg(); orgRename(id,"nome",fresh); return; }
    if(next==="branch"){ orgBranch(id,"b"); const nid=orgSel; renderOrg(); if(nid) orgRename(nid,"texto",true); return; }
    if(next==="sibling"){ orgBranchSibling(id); const nid=orgSel; renderOrg(); if(nid) orgRename(nid,"texto",true); return; }
    orgSel=null; orgMulti=[]; orgSelEdge=null;
    renderOrg();
  }
  function onBlur(){ finish(true); }
  function onKey(ev){ ev.stopPropagation();
    if(ev.key==="Enter"){ ev.preventDefault();
      if(field==="texto") finish(true,"nome"); else finish(true, isG?null:"branch");
    }
    else if(ev.key==="Tab"){ ev.preventDefault(); finish(true, isG?null:"sibling"); }
    else if(ev.key==="Escape"){ ev.preventDefault(); finish(false); }
  }
  txt.addEventListener("blur",onBlur);
  txt.addEventListener("keydown",onKey);
}
function orgDelete(id){
  if(orgIsGeral()) return;
  orgData.nodes=orgData.nodes.filter(x=>x.id!==id);
  orgData.edges=orgData.edges.filter(x=>x.de!==id&&x.para!==id);
  if(orgSel===id) orgSel=null; orgSave(); renderOrg();
}
function orgExemplo(){
  if(orgIsGeral()) return;
  const n=(forma,texto,x,y,cor)=>({id:orgUid("n"),x:x,y:y,texto:texto,cor:cor,forma:forma});
  const dono=n("ret","Dono / Diretor",640,40,"#157a35");
  const ger=n("ret","Gerente da loja",640,180,"#1b9e4b");
  const cx=n("ret","Frente de caixa",300,330,"#0e7c8b");
  const rep=n("ret","Reposição / Estoque",640,330,"#0e7c8b");
  const aco=n("ret","Açougue / Padaria",980,330,"#0e7c8b");
  orgData={nodes:[dono,ger,cx,rep,aco],edges:[
    {id:orgUid("e"),de:dono.id,para:ger.id,dport:"b",pport:"t"},
    {id:orgUid("e"),de:ger.id,para:cx.id,dport:"b",pport:"t"},
    {id:orgUid("e"),de:ger.id,para:rep.id,dport:"b",pport:"t"},
    {id:orgUid("e"),de:ger.id,para:aco.id,dport:"b",pport:"t"}
  ]};
  orgSel=null; orgMulti=[]; orgSrc=null; orgSelEdge=null; orgSave(); renderOrg();
}
(function initOrg(){
  const inner=document.getElementById("orgInner"); if(!inner) return;
  const coresEl=document.getElementById("orgCores");
  ORG_CORES.forEach(c=>{ const b=document.createElement("button"); b.className="org-swatch"+(c===orgCor?" sel":""); b.style.background=c; b.dataset.cor=c; coresEl.appendChild(b); });
  coresEl.addEventListener("click",(e)=>{ const sw=e.target.closest(".org-swatch"); if(!sw) return;
    orgCor=sw.dataset.cor; coresEl.querySelectorAll(".org-swatch").forEach(x=>x.classList.toggle("sel",x===sw));
    const ids=orgSelIds(); if(ids.length){ orgData.nodes.forEach(n=>{ if(ids.indexOf(n.id)>=0) n.cor=orgCor; }); orgSave(); renderOrg(); }
  });
  document.getElementById("orgAdd").addEventListener("click", orgAdd);
  document.getElementById("orgExemplo").addEventListener("click", orgExemplo);
  const tabsEl=document.getElementById("orgTabs");
  if(tabsEl){
    tabsEl.addEventListener("click",(e)=>{
      if(e.target.closest("#orgTabAdd")){ orgNewDoc(); return; }
      const x=e.target.closest(".org-tab-x"); if(x){ e.stopPropagation(); orgDelDoc(x.dataset.del); return; }
      const tab=e.target.closest(".org-tab"); if(tab){ orgSwitchDoc(tab.dataset.tab); }
    });
    tabsEl.addEventListener("dblclick",(e)=>{
      const tab=e.target.closest(".org-tab"); if(!tab) return;
      orgEditTab(tab.dataset.tab, false);
    });
  }
  orgRenderTabs();
  const elForma=document.getElementById("orgForma");
  if(elForma) elForma.addEventListener("change",(e)=>{ orgShape=e.target.value;
    const ids=orgSelIds(); if(ids.length){ orgData.nodes.forEach(n=>{ if(ids.indexOf(n.id)>=0) n.forma=orgShape; }); orgSave(); renderOrg(); }
  });
  const btnCon=document.getElementById("orgConectar");
  if(btnCon) btnCon.addEventListener("click",()=>{ orgConnect=!orgConnect; orgSrc=null; btnCon.classList.toggle("on",orgConnect); renderOrg(); });
  document.getElementById("orgLimpar").addEventListener("click",()=>{ if(confirm("Apagar todo o organograma?")){ orgData={nodes:[],edges:[]}; orgSel=null; orgMulti=[]; orgSrc=null; orgSelEdge=null; orgSave(); renderOrg(); } });
  document.getElementById("orgZoomIn").addEventListener("click",()=>{ const cv=document.querySelector(".org-canvas"); const r=cv&&cv.getBoundingClientRect(); orgSetZoom(orgZoom+0.2, r?r.left+r.width/2:undefined, r?r.top+r.height/2:undefined); });
  document.getElementById("orgZoomOut").addEventListener("click",()=>{ const cv=document.querySelector(".org-canvas"); const r=cv&&cv.getBoundingClientRect(); orgSetZoom(orgZoom-0.2, r?r.left+r.width/2:undefined, r?r.top+r.height/2:undefined); });
  (function(){ const bfit=document.getElementById("orgFit"); if(bfit) bfit.addEventListener("click", orgFitView); })();
  (function(){ const bf=document.getElementById("orgFull"); if(!bf) return;
    bf.addEventListener("click",()=>{ const c=document.getElementById("orgCard");
      if(!document.fullscreenElement){ (c.requestFullscreen?c.requestFullscreen():c.webkitRequestFullscreen&&c.webkitRequestFullscreen()); }
      else { (document.exitFullscreen?document.exitFullscreen():document.webkitExitFullscreen&&document.webkitExitFullscreen()); }
    });
    document.addEventListener("fullscreenchange",()=>{ bf.textContent=document.fullscreenElement?"⛶ Sair":"⛶ Tela cheia"; setTimeout(function(){ renderOrg(); orgFitView(); },80); });
  })();
  document.addEventListener("keydown",(e)=>{
    const tag=(document.activeElement&&document.activeElement.tagName)||"";
    if(tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA") return;
    if(document.activeElement&&document.activeElement.isContentEditable) return;
    const page=document.getElementById("page-organograma");
    if(!page||!page.classList.contains("ativo")) return;
    if(orgIsGeral()) return;
    const k=e.key.toLowerCase();
    if(e.key==="Enter"&&!e.ctrlKey&&!e.metaKey){
      const sid=orgSel||(orgMulti.length===1?orgMulti[0]:null);
      if(sid){ e.preventDefault(); orgBranch(sid,"b"); const nid=orgSel; if(nid) orgRename(nid,"texto",true); }
      return;
    }
    if(e.key==="Tab"){
      const sid=orgSel||(orgMulti.length===1?orgMulti[0]:null);
      if(sid){ e.preventDefault(); orgBranchSibling(sid); const nid=orgSel; if(nid) orgRename(nid,"texto",true); }
      return;
    }
    if((e.ctrlKey||e.metaKey)&&k==="z"){ e.preventDefault(); orgUndo(); return; }
    if((e.ctrlKey||e.metaKey)&&k==="c"){
      const ids=orgSelIds(); if(!ids.length) return;
      orgClip=orgData.nodes.filter(n=>ids.indexOf(n.id)>=0).map(n=>({texto:n.texto,cor:n.cor,forma:n.forma,x:n.x,y:n.y}));
      e.preventDefault(); return;
    }
    if((e.ctrlKey||e.metaKey)&&k==="v"){
      if(!orgClip||!orgClip.length) return;
      e.preventDefault();
      const novos=orgClip.map(c=>({id:orgUid("n"),texto:c.texto,cor:c.cor,forma:c.forma,x:c.x+30,y:c.y+30}));
      orgData.nodes=orgData.nodes.concat(novos);
      orgClip=orgClip.map(c=>({texto:c.texto,cor:c.cor,forma:c.forma,x:c.x+30,y:c.y+30}));
      orgSel = novos.length===1?novos[0].id:null;
      orgMulti = novos.length>1?novos.map(n=>n.id):[];
      orgSelEdge=null; orgSave(); renderOrg(); return;
    }
    if(e.key!=="Delete"&&e.key!=="Backspace") return;
    if(orgSelEdge){ e.preventDefault(); orgData.edges=orgData.edges.filter(x=>x.id!==orgSelEdge); orgSelEdge=null; orgSave(); renderOrg(); return; }
    const ids=orgSelIds();
    if(!ids.length) return;
    e.preventDefault();
    orgData.nodes=orgData.nodes.filter(x=>ids.indexOf(x.id)<0);
    orgData.edges=orgData.edges.filter(x=>ids.indexOf(x.de)<0&&ids.indexOf(x.para)<0);
    orgSel=null; orgMulti=[]; orgSave(); renderOrg();
  });

  inner.addEventListener("contextmenu",(e)=>{ e.preventDefault(); });
  (function(){ const cv=document.querySelector(".org-canvas"); if(cv){ cv.addEventListener("wheel",(e)=>{ e.preventDefault();
    if(e.ctrlKey){ window.__trackpad=true; orgSetZoom(orgZoom * Math.exp(-e.deltaY*0.01), e.clientX, e.clientY); return; }
    if(e.deltaX!==0){ window.__trackpad=true; orgTX-=e.deltaX; orgTY-=e.deltaY; orgApplyTransform(); return; }
    if(window.__trackpad){ orgTY-=e.deltaY; orgApplyTransform(); }
    else { orgSetZoom(orgZoom * (e.deltaY<0?1.15:0.87), e.clientX, e.clientY); }
  }, {passive:false}); } })();
  inner.addEventListener("pointerdown",(e)=>{
    if(e.target&&e.target.isContentEditable) return;
    if(orgIsGeral()){
      if(e.button===2){ e.preventDefault(); const cv=document.querySelector(".org-canvas"); if(cv){ orgPan={x:e.clientX,y:e.clientY,tx:orgTX,ty:orgTY}; cv.style.cursor="grabbing"; } }
      else if(e.button===0){
        const gn=e.target.closest&&e.target.closest('.org-node[data-id="gvdir"]');
        if(gn){ e.preventDefault(); orgRename("gvdir", e.target.closest(".org-sub")?"nome":"texto"); }
        else { e.preventDefault(); const cv=document.querySelector(".org-canvas"); if(cv){ orgPan={x:e.clientX,y:e.clientY,tx:orgTX,ty:orgTY}; cv.style.cursor="grabbing"; } }
      }
      return;
    }
    if(e.button===2){
      e.preventDefault();
      if(!orgConnect){ const cv=document.querySelector(".org-canvas"); if(cv){ orgPan={x:e.clientX,y:e.clientY,tx:orgTX,ty:orgTY}; cv.style.cursor="grabbing"; } }
      return;
    }
    if(e.button!==0) return;
    if(e.target.classList&&e.target.classList.contains("org-eh")){ e.preventDefault(); orgEdgeDrag={ edge:e.target.getAttribute("data-edge"), end:e.target.getAttribute("data-end"), moved:false }; return; }
    if(e.target.classList&&e.target.classList.contains("org-ehmid")){ e.preventDefault(); orgEdgeDrag={ edge:e.target.getAttribute("data-edge"), bend:true, moved:false }; return; }
    const hitEl=e.target.closest&&e.target.closest(".hit");
    if(hitEl){ e.preventDefault(); orgSelEdge=hitEl.getAttribute("data-edge"); orgSel=null; orgMulti=[]; orgSrc=null; renderOrg(); return; }
    if(e.target.closest(".org-del")){ e.preventDefault(); return; }
    const handle=e.target.closest(".org-handle");
    if(handle){ e.preventDefault(); orgHandleDrag={ id:handle.dataset.id, dir:handle.dataset.h, sx:e.clientX, sy:e.clientY, moved:false }; return; }
    const node=e.target.closest(".org-node");
    if(!node){
      if(orgConnect){ let ch=false; if(orgSrc){orgSrc=null;ch=true;} if(orgSel){orgSel=null;ch=true;} if(orgMulti.length){orgMulti=[];ch=true;} if(ch) renderOrg(); return; }
      e.preventDefault();
      const r=inner.getBoundingClientRect();
      const sx=(e.clientX-r.left)/orgZoom, sy=(e.clientY-r.top)/orgZoom;
      orgSel=null; orgSrc=null; orgMulti=[]; orgSelEdge=null;
      const mq=document.createElement("div"); mq.className="org-mq"; mq.id="orgMq";
      orgMarquee={ x:sx, y:sy, el:mq };
      renderOrg(); inner.appendChild(mq);
      return;
    }
    const id=node.dataset.id, n=orgData.nodes.find(x=>x.id===id); if(!n) return;
    const r=inner.getBoundingClientRect();
    if(orgMulti.length>1 && orgMulti.indexOf(id)>=0 && !orgConnect){
      const ox=(e.clientX-r.left)/orgZoom, oy=(e.clientY-r.top)/orgZoom;
      const orig=orgMulti.map(mid=>{ const m=orgData.nodes.find(x=>x.id===mid); return {id:mid,x:m.x,y:m.y}; });
      orgDrag={ group:true, moved:false, ox, oy, orig };
      return;
    }
    orgDrag={ id, moved:false, onText:!!e.target.closest(".org-txt"), onSub:!!e.target.closest(".org-sub"), dx:(e.clientX-r.left)/orgZoom-n.x, dy:(e.clientY-r.top)/orgZoom-n.y };
  });
  document.addEventListener("pointermove",(e)=>{
    if(e.buttons===0 && (orgDrag||orgEdgeDrag||orgHandleDrag||orgPan||orgMarquee)){ orgPointerUp(e); return; }
    if(orgEdgeDrag&&orgEdgeDrag.bend){
      orgEdgeDrag.moved=true;
      const ed=orgData.edges.find(x=>x.id===orgEdgeDrag.edge);
      if(ed){
        const a=inner.querySelector('.org-node[data-id="'+ed.de+'"]');
        const b=inner.querySelector('.org-node[data-id="'+ed.para+'"]');
        if(a&&b){
          const ca=orgCenter(a), cb=orgCenter(b);
          const r=inner.getBoundingClientRect();
          const cx=(e.clientX-r.left)/orgZoom, cy=(e.clientY-r.top)/orgZoom;
          ed.bend=(Math.abs(cb.y-ca.y)>=Math.abs(cb.x-ca.x))?cy:cx;
          orgDrawEdges();
        }
      }
      return;
    }
    if(orgEdgeDrag){
      orgEdgeDrag.moved=true;
      const ed=orgData.edges.find(x=>x.id===orgEdgeDrag.edge);
      const r=inner.getBoundingClientRect();
      const cx=(e.clientX-r.left)/orgZoom, cy=(e.clientY-r.top)/orgZoom;
      const tgt=orgNodeAt(e.clientX,e.clientY);
      inner.querySelectorAll('.org-node.linktarget').forEach(x=>x.classList.remove('linktarget'));
      if(ed){
        const fixedId=orgEdgeDrag.end==="para"?ed.de:ed.para;
        const fx=inner.querySelector('.org-node[data-id="'+fixedId+'"]');
        let ex=cx, ey=cy;
        if(tgt&&fx){ tgt.classList.add('linktarget'); const tc=orgCenter(tgt), fc=orgCenter(fx); const side=orgEdgeDrag.end==="para"?orgTreePorts(fc,tc).p:orgTreePorts(tc,fc).d; const pt=orgPortAnchor(tc,side); ex=pt.x; ey=pt.y; orgShowPorts(tc,side); } else orgHidePorts();
        if(fx){ const c=orgCenter(fx); const p=orgBorder(c,ex,ey); orgShowTemp(p.x,p.y,ex,ey); }
      }
      return;
    }
    if(orgHandleDrag){
      if(Math.abs(e.clientX-orgHandleDrag.sx)>4||Math.abs(e.clientY-orgHandleDrag.sy)>4) orgHandleDrag.moved=true;
      if(orgHandleDrag.moved){
        const r=inner.getBoundingClientRect();
        const cx=(e.clientX-r.left)/orgZoom, cy=(e.clientY-r.top)/orgZoom;
        const src=inner.querySelector('.org-node[data-id="'+orgHandleDrag.id+'"]');
        const tgt=orgNodeAt(e.clientX,e.clientY,orgHandleDrag.id);
        inner.querySelectorAll('.org-node.linktarget').forEach(x=>x.classList.remove('linktarget'));
        let ex=cx, ey=cy;
        if(tgt&&src){ tgt.classList.add('linktarget'); const tc=orgCenter(tgt); const side=orgTreePorts(orgCenter(src),tc).p; const pt=orgPortAnchor(tc,side); ex=pt.x; ey=pt.y; orgShowPorts(tc,side); } else orgHidePorts();
        if(src){ const c=orgCenter(src); const p=orgBorder(c,ex,ey); orgShowTemp(p.x,p.y,ex,ey); }
      }
      return;
    }
    if(orgMarquee){
      const r=inner.getBoundingClientRect();
      const cx=(e.clientX-r.left)/orgZoom, cy=(e.clientY-r.top)/orgZoom;
      const x1=Math.min(orgMarquee.x,cx), y1=Math.min(orgMarquee.y,cy), x2=Math.max(orgMarquee.x,cx), y2=Math.max(orgMarquee.y,cy);
      const mq=orgMarquee.el; mq.style.left=x1+"px"; mq.style.top=y1+"px"; mq.style.width=(x2-x1)+"px"; mq.style.height=(y2-y1)+"px";
      orgMulti=[];
      orgData.nodes.forEach(nd=>{
        const el=inner.querySelector('.org-node[data-id="'+nd.id+'"]'); if(!el) return;
        const ex1=el.offsetLeft, ey1=el.offsetTop, ex2=ex1+el.offsetWidth, ey2=ey1+el.offsetHeight;
        const hit=ex1<x2&&ex2>x1&&ey1<y2&&ey2>y1;
        el.classList.toggle("sel",hit);
        if(hit) orgMulti.push(nd.id);
      });
      return;
    }
    if(orgPan){ orgTX=orgPan.tx+(e.clientX-orgPan.x); orgTY=orgPan.ty+(e.clientY-orgPan.y); orgApplyTransform(); return; }
    if(!orgDrag||orgConnect) return;
    const r=inner.getBoundingClientRect();
    if(orgDrag.group){
      const dx=(e.clientX-r.left)/orgZoom-orgDrag.ox, dy=(e.clientY-r.top)/orgZoom-orgDrag.oy;
      if(Math.abs(dx)>2||Math.abs(dy)>2) orgDrag.moved=true;
      orgDrag.orig.forEach(o=>{
        const m=orgData.nodes.find(x=>x.id===o.id); if(!m) return;
        m.x=Math.max(0,o.x+dx); m.y=Math.max(0,o.y+dy);
        const el=inner.querySelector('.org-node[data-id="'+o.id+'"]'); if(el){ el.style.left=m.x+"px"; el.style.top=m.y+"px"; }
      });
      orgDrawEdges();
      return;
    }
    const n=orgData.nodes.find(x=>x.id===orgDrag.id); if(!n) return;
    const nx=Math.max(0,(e.clientX-r.left)/orgZoom-orgDrag.dx), ny=Math.max(0,(e.clientY-r.top)/orgZoom-orgDrag.dy);
    if(Math.abs(nx-n.x)>2||Math.abs(ny-n.y)>2) orgDrag.moved=true;
    n.x=nx; n.y=ny;
    const el=inner.querySelector('.org-node[data-id="'+n.id+'"]'); if(el){ el.style.left=nx+"px"; el.style.top=ny+"px"; }
    orgDrawEdges();
  });
  function orgPointerUp(e){
    if(orgEdgeDrag&&orgEdgeDrag.bend){ orgEdgeDrag=null; orgSave(); renderOrg(); return; }
    if(orgEdgeDrag){
      const eg=orgEdgeDrag; orgEdgeDrag=null; orgHideTemp(); orgHidePorts();
      inner.querySelectorAll('.org-node.linktarget').forEach(x=>x.classList.remove('linktarget'));
      if(eg.moved){
        const ed=orgData.edges.find(x=>x.id===eg.edge);
        const exceptId=ed?(eg.end==="para"?ed.de:ed.para):null;
        const tgt=orgNodeAt(e.clientX,e.clientY,exceptId);
        const tid=tgt&&tgt.dataset.id;
        if(ed&&tid){
          if(eg.end==="para"){ if(tid!==ed.de){ ed.para=tid; } }
          else { if(tid!==ed.para){ ed.de=tid; } }
          const de=inner.querySelector('.org-node[data-id="'+ed.de+'"]'), pa=inner.querySelector('.org-node[data-id="'+ed.para+'"]');
          if(de&&pa){ const tp=orgTreePorts(orgCenter(de),orgCenter(pa)); ed.dport=tp.d; ed.pport=tp.p; }
          orgSave();
        }
      }
      renderOrg(); return;
    }
    if(orgHandleDrag){
      const h=orgHandleDrag; orgHandleDrag=null; orgHideTemp(); orgHidePorts();
      inner.querySelectorAll('.org-node.linktarget').forEach(x=>x.classList.remove('linktarget'));
      if(h.moved){
        const tgt=orgNodeAt(e.clientX,e.clientY,h.id);
        const tid=tgt&&tgt.dataset.id;
        if(tid&&tid!==h.id){
          const src=inner.querySelector('.org-node[data-id="'+h.id+'"]');
          const tp=orgTreePorts(orgCenter(src),orgCenter(tgt));
          const dup=orgData.edges.some(ed=>(ed.de===h.id&&ed.para===tid)||(ed.de===tid&&ed.para===h.id));
          if(!dup){ orgData.edges.push({id:orgUid("e"),de:h.id,para:tid,dport:tp.d,pport:tp.p}); }
          orgSel=tid; orgMulti=[]; orgSave(); renderOrg();
        } else { orgBranch(h.id,h.dir); }
      } else { orgBranch(h.id,h.dir); }
      return;
    }
    if(orgMarquee){ const mq=orgMarquee.el; if(mq&&mq.parentNode) mq.parentNode.removeChild(mq); orgMarquee=null;
      orgSel = orgMulti.length===1 ? orgMulti[0] : null;
      if(orgMulti.length<=1) orgMulti=[];
      renderOrg(); return; }
    if(orgPan){ orgPan=null; const cv=document.querySelector(".org-canvas"); if(cv) cv.style.cursor="crosshair"; return; }
    if(!orgDrag) return; const d=orgDrag; orgDrag=null;
    if(d.group){ if(d.moved) orgSave(); return; }
    if(d.moved){ orgSave(); return; }
    if(orgConnect){ orgConnectClick(d.id); }
    else if((d.onText||d.onSub) && orgSel===d.id){ orgRename(d.id, d.onSub?"nome":"texto"); }
    else { orgMulti=[]; orgSelEdge=null; orgSel=d.id; renderOrg(); }
  }
  document.addEventListener("pointerup",orgPointerUp);
  inner.addEventListener("dblclick",(e)=>{
    const node=e.target.closest(".org-node"); if(!node) return;
    orgRename(node.dataset.id, e.target.closest(".org-sub")?"nome":"texto");
  });
  inner.addEventListener("click",(e)=>{
    const del=e.target.closest(".org-del"); if(!del) return;
    const id=del.dataset.del;
    if(confirm("Excluir esta caixa?")){ orgData.nodes=orgData.nodes.filter(x=>x.id!==id); orgData.edges=orgData.edges.filter(x=>x.de!==id&&x.para!==id); if(orgSel===id)orgSel=null; orgSave(); renderOrg(); }
  });
  renderOrg();
})();

// ---- Fluxograma (editor visual) ----
const FLUX_CORES = ["#157a35","#1b9e4b","#e8820e","#8e44ad","#c0392b","#0e7c8b","#5a6678"];
function fluxLoad(){ try{ const s=localStorage.getItem("fluxograma"); if(s) return JSON.parse(s); }catch(e){} return {nodes:[],edges:[]}; }
let fluxData = fluxLoad();
let fluxShape = "fim", fluxCor = FLUX_CORES[0];
let fluxSel = null, fluxSrc = null, fluxConnect = false, fluxDrag = null, fluxPan = null, fluxSeq = 0, fluxZoom = 1, fluxTX = 0, fluxTY = 0;
let fluxMulti = [], fluxMarquee = null, fluxHandleDrag = null, fluxSelEdge = null, fluxEdgeDrag = null, fluxClip = null;
function fluxUid(p){ fluxSeq++; return p+Date.now().toString(36)+fluxSeq; }
function fluxSelIds(){ return fluxMulti.length?fluxMulti.slice():(fluxSel?[fluxSel]:[]); }
function fluxShowTemp(x1,y1,x2,y2){
  const svg=document.getElementById("fluxSvg"); if(!svg) return;
  let ln=document.getElementById("fluxTempLine");
  if(!ln){ const NS="http://www.w3.org/2000/svg"; ln=document.createElementNS(NS,"line"); ln.setAttribute("id","fluxTempLine"); ln.setAttribute("stroke","#157a35"); ln.setAttribute("stroke-width","2.5"); ln.setAttribute("stroke-dasharray","6 4"); ln.setAttribute("marker-end","url(#fluxArrow)"); ln.style.pointerEvents="none"; svg.appendChild(ln); }
  ln.setAttribute("x1",x1); ln.setAttribute("y1",y1); ln.setAttribute("x2",x2); ln.setAttribute("y2",y2);
}
function fluxHideTemp(){ const ln=document.getElementById("fluxTempLine"); if(ln) ln.remove(); }
function fluxShowPorts(c,active){
  const svg=document.getElementById("fluxSvg"); if(!svg) return;
  const NS="http://www.w3.org/2000/svg";
  let g=document.getElementById("fluxPortG");
  if(!g){ g=document.createElementNS(NS,"g"); g.setAttribute("id","fluxPortG"); g.style.pointerEvents="none"; svg.appendChild(g); }
  while(g.firstChild) g.removeChild(g.firstChild);
  ["t","r","b","l"].forEach(function(p){
    const a=fluxPortAnchor(c,p); const on=(p===active);
    const d=document.createElementNS(NS,"circle");
    d.setAttribute("cx",a.x); d.setAttribute("cy",a.y);
    d.setAttribute("r",on?"7":"5");
    d.setAttribute("fill",on?"#157a35":"#fff");
    d.setAttribute("stroke",on?"#fff":"#157a35");
    d.setAttribute("stroke-width",on?"2.5":"2");
    g.appendChild(d);
  });
}
function fluxHidePorts(){ const g=document.getElementById("fluxPortG"); if(g) g.remove(); }
function fluxApplyTransform(){
  const inner=document.getElementById("fluxInner"); if(!inner) return;
  inner.style.transformOrigin="0 0";
  inner.style.transform="translate("+fluxTX+"px,"+fluxTY+"px) scale("+fluxZoom+")";
}
function fluxSetZoom(z, ax, ay){
  const cv=document.querySelector(".flux-canvas");
  const old=fluxZoom;
  fluxZoom=Math.min(1.8,Math.max(0.4,Math.round(z*100)/100));
  const lbl=document.getElementById("fluxZoomLbl"); if(lbl) lbl.textContent=Math.round(fluxZoom*100)+"%";
  if(cv && typeof ax==="number"){
    const rect=cv.getBoundingClientRect();
    const sx=ax-rect.left, sy=ay-rect.top;
    const cpx=(sx-fluxTX)/old, cpy=(sy-fluxTY)/old;
    fluxTX=Math.round(sx-cpx*fluxZoom);
    fluxTY=Math.round(sy-cpy*fluxZoom);
  }
  fluxApplyTransform();
}
let fluxHist = [], fluxPrev = JSON.stringify(fluxData);
function fluxSave(){ try{ fluxHist.push(fluxPrev); if(fluxHist.length>60) fluxHist.shift(); fluxPrev=JSON.stringify(fluxData); localStorage.setItem("fluxograma", fluxPrev); }catch(e){} }
function fluxUndo(){ if(!fluxHist.length) return; const prev=fluxHist.pop(); fluxData=JSON.parse(prev); fluxPrev=prev; fluxSel=null; fluxMulti=[]; fluxSelEdge=null; fluxSrc=null; try{ localStorage.setItem("fluxograma", prev); }catch(e){} renderFlux(); }
function fluxEsc(s){ return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

function fluxNodeHtml(n){
  let cls="flux-node";
  if(n.forma==="dec") cls+=" dec"; else if(n.forma==="fim") cls+=" fim"; else if(n.forma==="io") cls+=" io";
  if(fluxSel===n.id||fluxMulti.indexOf(n.id)>=0) cls+=" sel";
  if(fluxSrc===n.id) cls+=" src";
  return '<div class="'+cls+'" data-id="'+n.id+'" style="left:'+n.x+'px;top:'+n.y+'px;">'+
    '<div class="flux-shape" style="background:'+(n.cor||"#157a35")+';"></div>'+
    '<span class="flux-txt">'+fluxEsc(n.texto)+'</span>'+
    '<button class="flux-del" data-del="'+n.id+'" title="Excluir">×</button>'+
    '<button class="flux-handle t" data-h="t" data-id="'+n.id+'" title="Nova etapa acima">＋</button>'+
    '<button class="flux-handle r" data-h="r" data-id="'+n.id+'" title="Nova etapa à direita">＋</button>'+
    '<button class="flux-handle b" data-h="b" data-id="'+n.id+'" title="Nova etapa abaixo">＋</button>'+
    '<button class="flux-handle l" data-h="l" data-id="'+n.id+'" title="Nova etapa à esquerda">＋</button></div>';
}
function fluxBranch(id, dir){
  const src=fluxData.nodes.find(x=>x.id===id); if(!src) return;
  const W=160, H=70, GAP=55;
  let x=src.x, y=src.y;
  if(dir==="b") y=src.y+H+GAP; else if(dir==="t") y=src.y-H-GAP;
  else if(dir==="r") x=src.x+W+GAP; else if(dir==="l") x=src.x-W-GAP;
  const nn={ id:fluxUid("n"), x:Math.max(0,x), y:Math.max(0,y), texto:"Nova etapa", cor:fluxCor, forma:fluxShape };
  fluxData.nodes.push(nn);
  const ed=(dir==="t"||dir==="l")?{id:fluxUid("e"),de:nn.id,para:id}:{id:fluxUid("e"),de:id,para:nn.id};
  fluxData.edges.push(ed);
  fluxSel=nn.id; fluxSave(); renderFlux();
}
function fluxCenter(el){ return {x:el.offsetLeft+el.offsetWidth/2, y:el.offsetTop+el.offsetHeight/2, hx:el.offsetWidth/2, hy:el.offsetHeight/2}; }
function fluxNodeAt(clientX, clientY, exceptId){
  const el=document.elementFromPoint(clientX, clientY);
  const direct=el&&el.closest&&el.closest('.flux-node');
  if(direct&&direct.dataset.id!==exceptId) return direct;
  const inner=document.querySelector('.flux-inner'); if(!inner) return null;
  const r=inner.getBoundingClientRect();
  const px=(clientX-r.left)/fluxZoom, py=(clientY-r.top)/fluxZoom;
  const PAD=12;
  let best=null;
  inner.querySelectorAll('.flux-node').forEach(nd=>{
    if(nd.dataset.id===exceptId) return;
    const x1=nd.offsetLeft-PAD, y1=nd.offsetTop-PAD, x2=nd.offsetLeft+nd.offsetWidth+PAD, y2=nd.offsetTop+nd.offsetHeight+PAD;
    if(px>=x1&&px<=x2&&py>=y1&&py<=y2) best=nd;
  });
  return best;
}
function fluxBorder(c, tx, ty){
  const dx=tx-c.x, dy=ty-c.y; if(dx===0&&dy===0) return {x:c.x,y:c.y};
  const s=Math.min(c.hx/Math.abs(dx||0.0001), c.hy/Math.abs(dy||0.0001));
  return {x:c.x+dx*s, y:c.y+dy*s};
}
function fluxPortAnchor(c,p){
  if(p==="t") return {x:c.x, y:c.y-c.hy, nx:0, ny:-1};
  if(p==="b") return {x:c.x, y:c.y+c.hy, nx:0, ny:1};
  if(p==="l") return {x:c.x-c.hx, y:c.y, nx:-1, ny:0};
  return {x:c.x+c.hx, y:c.y, nx:1, ny:0};
}
function fluxAutoPort(cFrom,cTo){
  const dx=cTo.x-cFrom.x, dy=cTo.y-cFrom.y;
  if(Math.abs(dy)>=Math.abs(dx)) return dy>=0?"b":"t";
  return dx>=0?"r":"l";
}
function fluxTreePorts(cf,ct){
  if(ct.y-ct.hy >= cf.y+cf.hy-2) return {d:"b",p:"t"};
  if(ct.y+ct.hy <= cf.y-cf.hy+2) return {d:"t",p:"b"};
  return ct.x>=cf.x ? {d:"r",p:"l"} : {d:"l",p:"r"};
}
function fluxElbowPts(ca,cb,bend,dport,pport){
  if(dport&&pport){
    const stub=22;
    const A=fluxPortAnchor(ca,dport), B=fluxPortAnchor(cb,pport);
    const s1={x:A.x+A.nx*stub, y:A.y+A.ny*stub};
    const t1={x:B.x+B.nx*stub, y:B.y+B.ny*stub};
    const sV=(dport==="t"||dport==="b"), tV=(pport==="t"||pport==="b");
    const pts=[{x:A.x,y:A.y},{x:s1.x,y:s1.y}];
    const mg=24;
    if(sV&&tV){
      if(dport!==pport){ const m=(bend!=null?bend:(s1.y+t1.y)/2); pts.push({x:s1.x,y:m},{x:t1.x,y:m}); }
      else { const lt=Math.min(ca.x-ca.hx,cb.x-cb.hx)-mg, rt=Math.max(ca.x+ca.hx,cb.x+cb.hx)+mg, lx=(Math.abs(s1.x-lt)<=Math.abs(s1.x-rt))?lt:rt; pts.push({x:lx,y:s1.y},{x:lx,y:t1.y}); }
    }
    else if(!sV&&!tV){
      if(dport!==pport){ const m=(bend!=null?bend:(s1.x+t1.x)/2); pts.push({x:m,y:s1.y},{x:m,y:t1.y}); }
      else { const tp=Math.min(ca.y-ca.hy,cb.y-cb.hy)-mg, bt=Math.max(ca.y+ca.hy,cb.y+cb.hy)+mg, ly=(Math.abs(s1.y-tp)<=Math.abs(s1.y-bt))?tp:bt; pts.push({x:s1.x,y:ly},{x:t1.x,y:ly}); }
    }
    else if(sV&&!tV){ pts.push({x:t1.x,y:s1.y}); }
    else { pts.push({x:s1.x,y:t1.y}); }
    pts.push({x:t1.x,y:t1.y},{x:B.x,y:B.y});
    return pts;
  }
  const dx=cb.x-ca.x, dy=cb.y-ca.y;
  if(Math.abs(dy)>=Math.abs(dx)){
    const sB=ca.y+(dy>=0?ca.hy:-ca.hy), tB=cb.y+(dy>=0?-cb.hy:cb.hy), m=(bend!=null?bend:(sB+tB)/2);
    return [{x:ca.x,y:sB},{x:ca.x,y:m},{x:cb.x,y:m},{x:cb.x,y:tB}];
  } else {
    const sB=ca.x+(dx>=0?ca.hx:-ca.hx), tB=cb.x+(dx>=0?-cb.hx:cb.hx), m=(bend!=null?bend:(sB+tB)/2);
    return [{x:sB,y:ca.y},{x:m,y:ca.y},{x:m,y:cb.y},{x:tB,y:cb.y}];
  }
}
function fluxDropSide(node, clientX, clientY){
  const r=node.getBoundingClientRect();
  const ndx=(clientX-(r.left+r.right)/2)/((r.width/2)||1);
  const ndy=(clientY-(r.top+r.bottom)/2)/((r.height/2)||1);
  if(Math.abs(ndx)>Math.abs(ndy)) return ndx>0?"r":"l";
  return ndy>0?"b":"t";
}
function fluxRoundPath(pts,r){
  if(!pts.length) return "";
  let d="M"+pts[0].x+","+pts[0].y;
  for(let i=1;i<pts.length-1;i++){
    const p0=pts[i-1],p1=pts[i],p2=pts[i+1];
    const v1x=p0.x-p1.x,v1y=p0.y-p1.y,v2x=p2.x-p1.x,v2y=p2.y-p1.y;
    const l1=Math.hypot(v1x,v1y)||1,l2=Math.hypot(v2x,v2y)||1,rr=Math.min(r,l1/2,l2/2);
    d+=" L"+(p1.x+v1x/l1*rr)+","+(p1.y+v1y/l1*rr)+" Q"+p1.x+","+p1.y+" "+(p1.x+v2x/l2*rr)+","+(p1.y+v2y/l2*rr);
  }
  const L=pts[pts.length-1]; d+=" L"+L.x+","+L.y; return d;
}
function fluxDrawEdges(){
  const svg=document.getElementById("fluxSvg"); if(!svg) return;
  Array.prototype.slice.call(svg.querySelectorAll(".flux-edge")).forEach(e=>e.remove());
  const NS="http://www.w3.org/2000/svg";
  fluxData.edges.forEach(ed=>{
    const a=document.querySelector('.flux-node[data-id="'+ed.de+'"]');
    const b=document.querySelector('.flux-node[data-id="'+ed.para+'"]');
    if(!a||!b) return;
    const ca=fluxCenter(a), cb=fluxCenter(b);
    const pts=fluxElbowPts(ca,cb,ed.bend,ed.dport,ed.pport), d=fluxRoundPath(pts,12), sel=(ed.id===fluxSelEdge);
    const g=document.createElementNS(NS,"g"); g.setAttribute("class","flux-edge");
    const ln=document.createElementNS(NS,"path");
    const hit=document.createElementNS(NS,"path"); hit.setAttribute("class","hit"); hit.setAttribute("data-edge",ed.id);
    [ln,hit].forEach(l=>{ l.setAttribute("d",d); l.setAttribute("fill","none"); });
    ln.setAttribute("stroke",sel?"#157a35":"#7a8696"); ln.setAttribute("stroke-width",sel?"3":"2"); ln.setAttribute("stroke-linejoin","round"); ln.setAttribute("stroke-linecap","round"); ln.setAttribute("marker-end","url(#fluxArrow)");
    g.appendChild(ln); g.appendChild(hit);
    if(sel){
      for(let i=0;i<pts.length-1;i++){
        const mx=(pts[i].x+pts[i+1].x)/2, my=(pts[i].y+pts[i+1].y)/2;
        if(Math.abs(pts[i].x-pts[i+1].x)<1&&Math.abs(pts[i].y-pts[i+1].y)<1) continue;
        const dot=document.createElementNS(NS,"circle"); dot.setAttribute("class","flux-ehmid"); dot.setAttribute("data-edge",ed.id); dot.setAttribute("cx",mx); dot.setAttribute("cy",my); dot.setAttribute("r",5); g.appendChild(dot);
      }
      const ends=[["de",pts[0]],["para",pts[pts.length-1]]];
      ends.forEach(en=>{ const c=document.createElementNS(NS,"circle"); c.setAttribute("class","flux-eh"); c.setAttribute("data-edge",ed.id); c.setAttribute("data-end",en[0]); c.setAttribute("cx",en[1].x); c.setAttribute("cy",en[1].y); c.setAttribute("r",6); g.appendChild(c); });
    }
    svg.appendChild(g);
  });
}
function renderFlux(){
  const inner=document.getElementById("fluxInner"); if(!inner) return;
  const nodes=fluxData.nodes.map(fluxNodeHtml).join("");
  inner.innerHTML='<svg class="flux-svg" id="fluxSvg"><defs><marker id="fluxArrow" markerWidth="10" markerHeight="8" refX="8" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#7a8696"></path></marker></defs></svg>'+nodes;
  const hintEl=document.getElementById("fluxHint"); if(hintEl) hintEl.style.display=fluxData.nodes.length?"none":"block";
  fluxDrawEdges();
  fluxApplyTransform();
}
function fluxAdd(){
  const k=fluxData.nodes.length;
  const canvas=document.querySelector(".flux-canvas");
  let cx=760, cy=70;
  if(canvas){ cx=(canvas.clientWidth/2 - fluxTX)/fluxZoom - 75; cy=(80 - fluxTY)/fluxZoom; }
  fluxData.nodes.push({ id:fluxUid("n"), x:Math.max(0,cx)+(k%5)*24, y:Math.max(0,cy)+(k%5)*24, texto:"Nova etapa", cor:fluxCor, forma:fluxShape });
  fluxSel=fluxData.nodes[fluxData.nodes.length-1].id; fluxSave(); renderFlux();
}
function fluxConnectClick(id){
  if(!fluxSrc){ fluxSrc=id; renderFlux(); return; }
  if(id!==fluxSrc) fluxData.edges.push({ id:fluxUid("e"), de:fluxSrc, para:id });
  fluxSrc=null; fluxSave(); renderFlux();
}
function fluxRename(id){
  const n=fluxData.nodes.find(x=>x.id===id); if(!n) return;
  const node=document.querySelector('.flux-node[data-id="'+id+'"]'); if(!node) return;
  const txt=node.querySelector(".flux-txt"); if(!txt) return;
  if(txt.getAttribute("contenteditable")==="true") return;
  txt.setAttribute("contenteditable","true");
  txt.style.cursor="text"; txt.style.outline="none";
  txt.focus();
  const sel=window.getSelection(), range=document.createRange(); range.selectNodeContents(txt); sel.removeAllRanges(); sel.addRange(range);
  let done=false;
  function finish(save){ if(done) return; done=true;
    txt.removeEventListener("blur",onBlur); txt.removeEventListener("keydown",onKey);
    txt.removeAttribute("contenteditable");
    if(save){ n.texto=(txt.textContent||"").trim()||"(vazio)"; fluxSave(); }
    if(txt.blur) txt.blur();
    fluxSel=null; fluxMulti=[]; fluxSelEdge=null;
    renderFlux();
  }
  function onBlur(){ finish(true); }
  function onKey(ev){ ev.stopPropagation();
    if(ev.key==="Enter"){ ev.preventDefault(); finish(true); }
    else if(ev.key==="Escape"){ ev.preventDefault(); finish(false); }
  }
  txt.addEventListener("blur",onBlur);
  txt.addEventListener("keydown",onKey);
}
function fluxDelete(id){
  fluxData.nodes=fluxData.nodes.filter(x=>x.id!==id);
  fluxData.edges=fluxData.edges.filter(x=>x.de!==id&&x.para!==id);
  if(fluxSel===id) fluxSel=null; fluxSave(); renderFlux();
}
function fluxExemplo(){
  const cx=300;
  const n=(forma,texto,x,y,cor)=>({id:fluxUid("n"),x:x,y:y,texto:texto,cor:cor,forma:forma});
  const a=n("fim","Início",cx,40,"#157a35");
  const b=n("ret","Cliente faz o pedido",cx-12,150,"#0e7c8b");
  const c=n("dec","Tem em estoque?",cx-22,270,"#e8820e");
  const d=n("ret","Separar produto",cx-180,430,"#0e7c8b");
  const e=n("ret","Repor / comprar",cx+170,430,"#c0392b");
  const f=n("io","Emitir nota / cupom",cx-12,560,"#8e44ad");
  const g=n("fim","Fim",cx,680,"#157a35");
  fluxData={nodes:[a,b,c,d,e,f,g],edges:[
    {id:fluxUid("e"),de:a.id,para:b.id,dport:"b",pport:"t"},
    {id:fluxUid("e"),de:b.id,para:c.id,dport:"b",pport:"t"},
    {id:fluxUid("e"),de:c.id,para:d.id,dport:"l",pport:"t"},
    {id:fluxUid("e"),de:c.id,para:e.id,dport:"r",pport:"t"},
    {id:fluxUid("e"),de:e.id,para:d.id,dport:"l",pport:"r"},
    {id:fluxUid("e"),de:d.id,para:f.id,dport:"b",pport:"t"},
    {id:fluxUid("e"),de:f.id,para:g.id,dport:"b",pport:"t"}
  ]};
  fluxSel=null; fluxMulti=[]; fluxSrc=null; fluxSelEdge=null; fluxSave(); renderFlux();
}
(function initFlux(){
  const inner=document.getElementById("fluxInner"); if(!inner) return;
  const coresEl=document.getElementById("fluxCores");
  FLUX_CORES.forEach(c=>{ const b=document.createElement("button"); b.className="flux-swatch"+(c===fluxCor?" sel":""); b.style.background=c; b.dataset.cor=c; coresEl.appendChild(b); });
  coresEl.addEventListener("click",(e)=>{ const sw=e.target.closest(".flux-swatch"); if(!sw) return;
    fluxCor=sw.dataset.cor; coresEl.querySelectorAll(".flux-swatch").forEach(x=>x.classList.toggle("sel",x===sw));
    const ids=fluxSelIds(); if(ids.length){ fluxData.nodes.forEach(n=>{ if(ids.indexOf(n.id)>=0) n.cor=fluxCor; }); fluxSave(); renderFlux(); }
  });
  document.getElementById("fluxAdd").addEventListener("click", fluxAdd);
  document.getElementById("fluxExemplo").addEventListener("click", fluxExemplo);
  document.getElementById("fluxForma").addEventListener("change",(e)=>{ fluxShape=e.target.value;
    const ids=fluxSelIds(); if(ids.length){ fluxData.nodes.forEach(n=>{ if(ids.indexOf(n.id)>=0) n.forma=fluxShape; }); fluxSave(); renderFlux(); }
  });
  const btnCon=document.getElementById("fluxConectar");
  btnCon.addEventListener("click",()=>{ fluxConnect=!fluxConnect; fluxSrc=null; btnCon.classList.toggle("on",fluxConnect); renderFlux(); });
  document.getElementById("fluxLimpar").addEventListener("click",()=>{ if(confirm("Apagar todo o fluxograma?")){ fluxData={nodes:[],edges:[]}; fluxSel=null; fluxMulti=[]; fluxSrc=null; fluxSelEdge=null; fluxSave(); renderFlux(); } });
  document.getElementById("fluxZoomIn").addEventListener("click",()=>{ const cv=document.querySelector(".flux-canvas"); const r=cv&&cv.getBoundingClientRect(); fluxSetZoom(fluxZoom+0.2, r?r.left+r.width/2:undefined, r?r.top+r.height/2:undefined); });
  document.getElementById("fluxZoomOut").addEventListener("click",()=>{ const cv=document.querySelector(".flux-canvas"); const r=cv&&cv.getBoundingClientRect(); fluxSetZoom(fluxZoom-0.2, r?r.left+r.width/2:undefined, r?r.top+r.height/2:undefined); });
  (function(){ const cv=document.querySelector(".flux-canvas"); if(cv){ cv.addEventListener("wheel",(e)=>{ e.preventDefault();
    if(e.ctrlKey){ window.__trackpad=true; fluxSetZoom(fluxZoom * Math.exp(-e.deltaY*0.01), e.clientX, e.clientY); return; }
    if(e.deltaX!==0){ window.__trackpad=true; fluxTX-=e.deltaX; fluxTY-=e.deltaY; fluxApplyTransform(); return; }
    if(window.__trackpad){ fluxTY-=e.deltaY; fluxApplyTransform(); }
    else { fluxSetZoom(fluxZoom * (e.deltaY<0?1.15:0.87), e.clientX, e.clientY); }
  }, {passive:false}); } })();
  document.addEventListener("keydown",(e)=>{
    const tag=(document.activeElement&&document.activeElement.tagName)||"";
    if(tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA") return;
    if(document.activeElement&&document.activeElement.isContentEditable) return;
    const page=document.getElementById("page-fluxograma");
    if(!page||!page.classList.contains("ativo")) return;
    const k=e.key.toLowerCase();
    if((e.ctrlKey||e.metaKey)&&k==="z"){ e.preventDefault(); fluxUndo(); return; }
    if((e.ctrlKey||e.metaKey)&&k==="c"){
      const ids=fluxSelIds(); if(!ids.length) return;
      fluxClip=fluxData.nodes.filter(n=>ids.indexOf(n.id)>=0).map(n=>({texto:n.texto,cor:n.cor,forma:n.forma,x:n.x,y:n.y}));
      e.preventDefault(); return;
    }
    if((e.ctrlKey||e.metaKey)&&k==="v"){
      if(!fluxClip||!fluxClip.length) return;
      e.preventDefault();
      const novos=fluxClip.map(c=>({id:fluxUid("n"),texto:c.texto,cor:c.cor,forma:c.forma,x:c.x+30,y:c.y+30}));
      fluxData.nodes=fluxData.nodes.concat(novos);
      fluxClip=fluxClip.map(c=>({texto:c.texto,cor:c.cor,forma:c.forma,x:c.x+30,y:c.y+30}));
      fluxSel = novos.length===1?novos[0].id:null;
      fluxMulti = novos.length>1?novos.map(n=>n.id):[];
      fluxSelEdge=null; fluxSave(); renderFlux(); return;
    }
    if(e.key!=="Delete"&&e.key!=="Backspace") return;
    if(fluxSelEdge){ e.preventDefault(); fluxData.edges=fluxData.edges.filter(x=>x.id!==fluxSelEdge); fluxSelEdge=null; fluxSave(); renderFlux(); return; }
    const ids=fluxSelIds();
    if(!ids.length) return;
    e.preventDefault();
    fluxData.nodes=fluxData.nodes.filter(x=>ids.indexOf(x.id)<0);
    fluxData.edges=fluxData.edges.filter(x=>ids.indexOf(x.de)<0&&ids.indexOf(x.para)<0);
    fluxSel=null; fluxMulti=[]; fluxSave(); renderFlux();
  });

  inner.addEventListener("contextmenu",(e)=>{ e.preventDefault(); });
  inner.addEventListener("pointerdown",(e)=>{
    if(e.target&&e.target.isContentEditable) return;
    if(e.button===2){
      e.preventDefault();
      if(!fluxConnect){ const cv=document.querySelector(".flux-canvas"); if(cv){ fluxPan={x:e.clientX,y:e.clientY,tx:fluxTX,ty:fluxTY}; cv.style.cursor="grabbing"; } }
      return;
    }
    if(e.button!==0) return;
    if(e.target.classList&&e.target.classList.contains("flux-eh")){ e.preventDefault(); fluxEdgeDrag={ edge:e.target.getAttribute("data-edge"), end:e.target.getAttribute("data-end"), moved:false }; return; }
    if(e.target.classList&&e.target.classList.contains("flux-ehmid")){ e.preventDefault(); fluxEdgeDrag={ edge:e.target.getAttribute("data-edge"), bend:true, moved:false }; return; }
    const hitEl=e.target.closest&&e.target.closest(".hit");
    if(hitEl){ e.preventDefault(); fluxSelEdge=hitEl.getAttribute("data-edge"); fluxSel=null; fluxMulti=[]; fluxSrc=null; renderFlux(); return; }
    if(e.target.closest(".flux-del")){ e.preventDefault(); return; }
    const handle=e.target.closest(".flux-handle");
    if(handle){ e.preventDefault(); fluxHandleDrag={ id:handle.dataset.id, dir:handle.dataset.h, sx:e.clientX, sy:e.clientY, moved:false }; return; }
    const node=e.target.closest(".flux-node");
    if(!node){
      if(fluxConnect){ let ch=false; if(fluxSrc){fluxSrc=null;ch=true;} if(fluxSel){fluxSel=null;ch=true;} if(fluxMulti.length){fluxMulti=[];ch=true;} if(ch) renderFlux(); return; }
      e.preventDefault();
      const r=inner.getBoundingClientRect();
      const sx=(e.clientX-r.left)/fluxZoom, sy=(e.clientY-r.top)/fluxZoom;
      fluxSel=null; fluxSrc=null; fluxMulti=[]; fluxSelEdge=null;
      const mq=document.createElement("div"); mq.className="flux-mq"; mq.id="fluxMq";
      fluxMarquee={ x:sx, y:sy, el:mq };
      renderFlux(); inner.appendChild(mq);
      return;
    }
    const id=node.dataset.id, n=fluxData.nodes.find(x=>x.id===id); if(!n) return;
    const r=inner.getBoundingClientRect();
    if(fluxMulti.length>1 && fluxMulti.indexOf(id)>=0 && !fluxConnect){
      const ox=(e.clientX-r.left)/fluxZoom, oy=(e.clientY-r.top)/fluxZoom;
      const orig=fluxMulti.map(mid=>{ const m=fluxData.nodes.find(x=>x.id===mid); return {id:mid,x:m.x,y:m.y}; });
      fluxDrag={ group:true, moved:false, ox, oy, orig };
      return;
    }
    fluxDrag={ id, moved:false, onText:!!e.target.closest(".flux-txt"), dx:(e.clientX-r.left)/fluxZoom-n.x, dy:(e.clientY-r.top)/fluxZoom-n.y };
  });
  document.addEventListener("pointermove",(e)=>{
    if(e.buttons===0 && (fluxDrag||fluxEdgeDrag||fluxHandleDrag||fluxPan||fluxMarquee)){ fluxPointerUp(e); return; }
    if(fluxEdgeDrag&&fluxEdgeDrag.bend){
      fluxEdgeDrag.moved=true;
      const ed=fluxData.edges.find(x=>x.id===fluxEdgeDrag.edge);
      if(ed){
        const a=inner.querySelector('.flux-node[data-id="'+ed.de+'"]');
        const b=inner.querySelector('.flux-node[data-id="'+ed.para+'"]');
        if(a&&b){
          const ca=fluxCenter(a), cb=fluxCenter(b);
          const r=inner.getBoundingClientRect();
          const cx=(e.clientX-r.left)/fluxZoom, cy=(e.clientY-r.top)/fluxZoom;
          ed.bend=(Math.abs(cb.y-ca.y)>=Math.abs(cb.x-ca.x))?cy:cx;
          fluxDrawEdges();
        }
      }
      return;
    }
    if(fluxEdgeDrag){
      fluxEdgeDrag.moved=true;
      const ed=fluxData.edges.find(x=>x.id===fluxEdgeDrag.edge);
      const r=inner.getBoundingClientRect();
      const cx=(e.clientX-r.left)/fluxZoom, cy=(e.clientY-r.top)/fluxZoom;
      const tgt=fluxNodeAt(e.clientX,e.clientY);
      inner.querySelectorAll('.flux-node.linktarget').forEach(x=>x.classList.remove('linktarget'));
      if(ed){
        const fixedId=fluxEdgeDrag.end==="para"?ed.de:ed.para;
        const fx=inner.querySelector('.flux-node[data-id="'+fixedId+'"]');
        let ex=cx, ey=cy;
        if(tgt&&fx){ tgt.classList.add('linktarget'); const tc=fluxCenter(tgt), fc=fluxCenter(fx); const side=fluxEdgeDrag.end==="para"?fluxTreePorts(fc,tc).p:fluxTreePorts(tc,fc).d; const pt=fluxPortAnchor(tc,side); ex=pt.x; ey=pt.y; fluxShowPorts(tc,side); } else fluxHidePorts();
        if(fx){ const c=fluxCenter(fx); const p=fluxBorder(c,ex,ey); fluxShowTemp(p.x,p.y,ex,ey); }
      }
      return;
    }
    if(fluxHandleDrag){
      if(Math.abs(e.clientX-fluxHandleDrag.sx)>4||Math.abs(e.clientY-fluxHandleDrag.sy)>4) fluxHandleDrag.moved=true;
      if(fluxHandleDrag.moved){
        const r=inner.getBoundingClientRect();
        const cx=(e.clientX-r.left)/fluxZoom, cy=(e.clientY-r.top)/fluxZoom;
        const src=inner.querySelector('.flux-node[data-id="'+fluxHandleDrag.id+'"]');
        const tgt=fluxNodeAt(e.clientX,e.clientY,fluxHandleDrag.id);
        inner.querySelectorAll('.flux-node.linktarget').forEach(x=>x.classList.remove('linktarget'));
        let ex=cx, ey=cy;
        if(tgt&&src){ tgt.classList.add('linktarget'); const tc=fluxCenter(tgt); const side=fluxTreePorts(fluxCenter(src),tc).p; const pt=fluxPortAnchor(tc,side); ex=pt.x; ey=pt.y; fluxShowPorts(tc,side); } else fluxHidePorts();
        if(src){ const c=fluxCenter(src); const p=fluxBorder(c,ex,ey); fluxShowTemp(p.x,p.y,ex,ey); }
      }
      return;
    }
    if(fluxMarquee){
      const r=inner.getBoundingClientRect();
      const cx=(e.clientX-r.left)/fluxZoom, cy=(e.clientY-r.top)/fluxZoom;
      const x1=Math.min(fluxMarquee.x,cx), y1=Math.min(fluxMarquee.y,cy), x2=Math.max(fluxMarquee.x,cx), y2=Math.max(fluxMarquee.y,cy);
      const mq=fluxMarquee.el; mq.style.left=x1+"px"; mq.style.top=y1+"px"; mq.style.width=(x2-x1)+"px"; mq.style.height=(y2-y1)+"px";
      fluxMulti=[];
      fluxData.nodes.forEach(nd=>{
        const el=inner.querySelector('.flux-node[data-id="'+nd.id+'"]'); if(!el) return;
        const ex1=el.offsetLeft, ey1=el.offsetTop, ex2=ex1+el.offsetWidth, ey2=ey1+el.offsetHeight;
        const hit=ex1<x2&&ex2>x1&&ey1<y2&&ey2>y1;
        el.classList.toggle("sel",hit);
        if(hit) fluxMulti.push(nd.id);
      });
      return;
    }
    if(fluxPan){ fluxTX=fluxPan.tx+(e.clientX-fluxPan.x); fluxTY=fluxPan.ty+(e.clientY-fluxPan.y); fluxApplyTransform(); return; }
    if(!fluxDrag||fluxConnect) return;
    const r=inner.getBoundingClientRect();
    if(fluxDrag.group){
      const dx=(e.clientX-r.left)/fluxZoom-fluxDrag.ox, dy=(e.clientY-r.top)/fluxZoom-fluxDrag.oy;
      if(Math.abs(dx)>2||Math.abs(dy)>2) fluxDrag.moved=true;
      fluxDrag.orig.forEach(o=>{
        const m=fluxData.nodes.find(x=>x.id===o.id); if(!m) return;
        m.x=Math.max(0,o.x+dx); m.y=Math.max(0,o.y+dy);
        const el=inner.querySelector('.flux-node[data-id="'+o.id+'"]'); if(el){ el.style.left=m.x+"px"; el.style.top=m.y+"px"; }
      });
      fluxDrawEdges();
      return;
    }
    const n=fluxData.nodes.find(x=>x.id===fluxDrag.id); if(!n) return;
    const nx=Math.max(0,(e.clientX-r.left)/fluxZoom-fluxDrag.dx), ny=Math.max(0,(e.clientY-r.top)/fluxZoom-fluxDrag.dy);
    if(Math.abs(nx-n.x)>2||Math.abs(ny-n.y)>2) fluxDrag.moved=true;
    n.x=nx; n.y=ny;
    const el=inner.querySelector('.flux-node[data-id="'+n.id+'"]'); if(el){ el.style.left=nx+"px"; el.style.top=ny+"px"; }
    fluxDrawEdges();
  });
  function fluxPointerUp(e){
    if(fluxEdgeDrag&&fluxEdgeDrag.bend){ fluxEdgeDrag=null; fluxSave(); renderFlux(); return; }
    if(fluxEdgeDrag){
      const eg=fluxEdgeDrag; fluxEdgeDrag=null; fluxHideTemp(); fluxHidePorts();
      inner.querySelectorAll('.flux-node.linktarget').forEach(x=>x.classList.remove('linktarget'));
      if(eg.moved){
        const ed=fluxData.edges.find(x=>x.id===eg.edge);
        const exceptId=ed?(eg.end==="para"?ed.de:ed.para):null;
        const tgt=fluxNodeAt(e.clientX,e.clientY,exceptId);
        const tid=tgt&&tgt.dataset.id;
        if(ed&&tid){
          if(eg.end==="para"){ if(tid!==ed.de){ ed.para=tid; } }
          else { if(tid!==ed.para){ ed.de=tid; } }
          const de=inner.querySelector('.flux-node[data-id="'+ed.de+'"]'), pa=inner.querySelector('.flux-node[data-id="'+ed.para+'"]');
          if(de&&pa){ const tp=fluxTreePorts(fluxCenter(de),fluxCenter(pa)); ed.dport=tp.d; ed.pport=tp.p; }
          fluxSave();
        }
      }
      renderFlux(); return;
    }
    if(fluxHandleDrag){
      const h=fluxHandleDrag; fluxHandleDrag=null; fluxHideTemp(); fluxHidePorts();
      inner.querySelectorAll('.flux-node.linktarget').forEach(x=>x.classList.remove('linktarget'));
      if(h.moved){
        const tgt=fluxNodeAt(e.clientX,e.clientY,h.id);
        const tid=tgt&&tgt.dataset.id;
        if(tid&&tid!==h.id){
          const src=inner.querySelector('.flux-node[data-id="'+h.id+'"]');
          const tp=fluxTreePorts(fluxCenter(src),fluxCenter(tgt));
          const dup=fluxData.edges.some(ed=>(ed.de===h.id&&ed.para===tid)||(ed.de===tid&&ed.para===h.id));
          if(!dup){ fluxData.edges.push({id:fluxUid("e"),de:h.id,para:tid,dport:tp.d,pport:tp.p}); }
          fluxSel=tid; fluxMulti=[]; fluxSave(); renderFlux();
        } else { fluxBranch(h.id,h.dir); }
      } else { fluxBranch(h.id,h.dir); }
      return;
    }
    if(fluxMarquee){ const mq=fluxMarquee.el; if(mq&&mq.parentNode) mq.parentNode.removeChild(mq); fluxMarquee=null;
      fluxSel = fluxMulti.length===1 ? fluxMulti[0] : null;
      if(fluxMulti.length<=1) fluxMulti=[];
      renderFlux(); return; }
    if(fluxPan){ fluxPan=null; const cv=document.querySelector(".flux-canvas"); if(cv) cv.style.cursor="crosshair"; return; }
    if(!fluxDrag) return; const d=fluxDrag; fluxDrag=null;
    if(d.group){ if(d.moved) fluxSave(); return; }
    if(d.moved){ fluxSave(); return; }
    if(fluxConnect){ fluxConnectClick(d.id); }
    else if(d.onText && fluxSel===d.id){ fluxRename(d.id); }
    else { fluxMulti=[]; fluxSelEdge=null; fluxSel=d.id; renderFlux(); }
  }
  document.addEventListener("pointerup",fluxPointerUp);
  inner.addEventListener("dblclick",(e)=>{
    const node=e.target.closest(".flux-node"); if(!node) return;
    fluxRename(node.dataset.id);
  });
  inner.addEventListener("click",(e)=>{
    const del=e.target.closest(".flux-del"); if(!del) return;
    const id=del.dataset.del;
    if(confirm("Excluir esta etapa?")){ fluxData.nodes=fluxData.nodes.filter(x=>x.id!==id); fluxData.edges=fluxData.edges.filter(x=>x.de!==id&&x.para!==id); if(fluxSel===id)fluxSel=null; fluxSave(); renderFlux(); }
  });
  renderFlux();
})();

// Painel de controle: troca a página visível ao clicar no menu lateral.
// ---- Entregas (dashboard de entregas — dados diários por entregador) ----
const ENT_META1=600, ENT_META2=850;
const ENT_SEED=["Anderson","Josinaldo","Lucas","Joseildo","Francisco","Nilton"];
const ENT_CORES=["#e6194b","#f58231","#3cb44b","#4363d8","#911eb4","#000000"];
const ENT_COR_BARRA="#157a35";
let entAno=HOJE.getFullYear(), entMes=HOJE.getMonth(), entEdit=false;
let entEntEditOpen=false;
let entDiaTipData=[];
function entLoadEntregadores(){ let arr=ENT_SEED.slice(); try{ const s=localStorage.getItem("entregas_entregadores"); if(s){ const a=JSON.parse(s); if(Array.isArray(a)&&a.length) arr=a; } }catch(e){} return arr.slice().sort(function(x,y){ return x.localeCompare(y,"pt-BR",{sensitivity:"base"}); }); }
let entEntregadores=entLoadEntregadores();
function entOrdena(){ entEntregadores.sort(function(x,y){ return x.localeCompare(y,"pt-BR",{sensitivity:"base"}); }); }
function entSaveEntregadores(){ try{ localStorage.setItem("entregas_entregadores", JSON.stringify(entEntregadores)); }catch(e){} }
function entAddEntregador(nm){ nm=(nm||"").trim(); if(!nm) return false; if(entEntregadores.some(function(x){ return x.toLowerCase()===nm.toLowerCase(); })) return false; entEntregadores.push(nm); entOrdena(); entSaveEntregadores(); return true; }
function entRenameEntregador(old,nv){ nv=(nv||"").trim(); if(!nv||nv===old) return false; if(entEntregadores.some(function(x){ return x.toLowerCase()===nv.toLowerCase() && x!==old; })) return false; const i=entEntregadores.indexOf(old); if(i<0) return false; entEntregadores[i]=nv; Object.keys(entDados).forEach(function(mk){ const md=entDados[mk]; if(md && md[old]!==undefined){ md[nv]=md[old]; delete md[old]; } }); entOrdena(); entSaveEntregadores(); entSaveDados(); return true; }
function entRemoveEntregador(nm){ const i=entEntregadores.indexOf(nm); if(i<0) return false; entEntregadores.splice(i,1); entSaveEntregadores(); return true; }
function entLoadDados(){ try{ const s=localStorage.getItem("entregas_dados"); if(s) return JSON.parse(s)||{}; }catch(e){} return {}; }
let entDados=entLoadDados();
function entSaveDados(){ try{ localStorage.setItem("entregas_dados", JSON.stringify(entDados)); }catch(e){} }
function entMesKey(a,m){ return a+"-"+m; }
function entCor(i){ return ENT_CORES[i%ENT_CORES.length]; }
function entDec(n){ return (n||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function entPct(n){ return entDec(n)+"%"; }
function entGet(a,m,nome,dia){ const md=entDados[entMesKey(a,m)]; if(!md||!md[nome]) return 0; return +md[nome][dia]||0; }
function entGetRaw(a,m,nome,dia){ const md=entDados[entMesKey(a,m)]; if(!md||!md[nome]||md[nome][dia]===undefined) return ""; return +md[nome][dia]; }
function entSet(a,m,nome,dia,val){ const mk=entMesKey(a,m); if(!entDados[mk]) entDados[mk]={}; if(!entDados[mk][nome]) entDados[mk][nome]={}; if(val===""||val===null||val===undefined) delete entDados[mk][nome][dia]; else entDados[mk][nome][dia]=+val; entSaveDados(); }
function entFechado(a,m,d){ if(new Date(a,m,d).getDay()===0) return true; return feriadosFechado(a).has(fmtKey(a,m,d)); }
function entTotalEntregador(a,m,nome){ let t=0; const nd=diasDoMes(a,m); for(let d=1;d<=nd;d++){ if(entFechado(a,m,d)) continue; t+=entGet(a,m,nome,d); } return t; }
function entTotalDia(a,m,dia){ if(entFechado(a,m,dia)) return 0; let t=0; entEntregadores.forEach(function(nm){ t+=entGet(a,m,nm,dia); }); return t; }
function entTotalMes(a,m){ let t=0; entEntregadores.forEach(function(nm){ t+=entTotalEntregador(a,m,nm); }); return t; }
function entDiasRestantes(){
  const nd=diasDoMes(entAno,entMes);
  if(entAno<HOJE.getFullYear()||(entAno===HOJE.getFullYear()&&entMes<HOJE.getMonth())) return 0;
  if(entAno>HOJE.getFullYear()||(entAno===HOJE.getFullYear()&&entMes>HOJE.getMonth())) return nd;
  return Math.max(0, nd-HOJE.getDate());
}
function entRenderKpis(){
  const nd=diasDoMes(entAno,entMes);
  const total=entTotalMes(entAno,entMes);
  const ne=entEntregadores.length||1;
  const alvo1=ENT_META1*ne, alvo2=ENT_META2*ne;
  const pct1=alvo1>0?Math.max(0,(alvo1-total)/alvo1*100):0;
  const pct2=alvo2>0?Math.max(0,(alvo2-total)/alvo2*100):0;
  let melhor="—", melhorV=-1;
  entEntregadores.forEach(function(nm){ const v=entTotalEntregador(entAno,entMes,nm); if(v>melhorV){ melhorV=v; melhor=nm; } });
  if(total<=0) melhor="—";
  const cards=[[num(total),"Entregas (total)"],[entDec(total/nd),"Média diária"],[entPct(pct1),"% Meta de "+ENT_META1],[entPct(pct2),"% Meta de "+ENT_META2],[entDec(total/ne),"Média por entregador"],[melhor,"Melhor entregador"]];
  document.getElementById("entKpis").innerHTML=cards.map(function(c){ return '<div class="kpi"><div class="v">'+c[0]+'</div><div class="l">'+c[1]+'</div></div>'; }).join("");
}
function entChartPorEntregador(){
  const items=entEntregadores.map(function(nm,i){ return {nm:nm,v:entTotalEntregador(entAno,entMes,nm),cor:entCor(i)}; });
  items.sort(function(a,b){ return b.v-a.v; });
  let mx=ENT_META2; items.forEach(function(x){ if(x.v>mx) mx=x.v; }); if(mx<1) mx=1;
  let rows="";
  items.forEach(function(x,idx){
    const p1=ENT_META1/mx*100, p2=ENT_META2/mx*100;
    const lbl1=idx===0?'<span'+(p1>=88?' class="esq"':'')+'>Meta '+ENT_META1+'</span>':'', lbl2=idx===0?'<span'+(p2>=88?' class="esq"':'')+'>Meta '+ENT_META2+'</span>':'';
    rows+='<div class="ent-barra-row"><div class="nm">'+x.nm+'</div><div class="ent-barra-track">'+
      '<div class="ent-barra-fill" style="width:'+(x.v/mx*100).toFixed(1)+'%;background:'+ENT_COR_BARRA+';">'+num(x.v)+'</div>'+
      '<div class="ent-meta-line" style="left:'+p1.toFixed(1)+'%;">'+lbl1+'</div>'+
      '<div class="ent-meta-line" style="left:'+p2.toFixed(1)+'%;">'+lbl2+'</div>'+
      '</div></div>';
  });
  return '<div class="ent-graf" style="padding-top:24px;"><h3>Total por Entregador</h3>'+rows+'</div>';
}
function entChartBarras(items,titulo){
  let mx=1; items.forEach(function(x){ if(x.v>mx) mx=x.v; });
  let rows=""; items.forEach(function(x){ rows+='<div class="ent-barra-row"><div class="nm">'+x.nm+'</div><div class="ent-barra-track"><div class="ent-barra-fill" style="width:'+(x.v/mx*100).toFixed(1)+'%;background:'+ENT_COR_BARRA+';">'+num(x.v)+'</div></div></div>'; });
  return '<div class="ent-graf"><h3>'+titulo+'</h3>'+rows+'</div>';
}
function entChartFaltam(meta,titulo){
  const items=entEntregadores.map(function(nm,i){ return {nm:nm,v:Math.max(0,meta-entTotalEntregador(entAno,entMes,nm)),cor:entCor(i)}; });
  return entChartBarras(items,titulo);
}
function entChartAtingir(meta,titulo){
  const dr=entDiasRestantes();
  const items=entEntregadores.map(function(nm,i){ const falta=Math.max(0,meta-entTotalEntregador(entAno,entMes,nm)); return {nm:nm,v:dr>0?Math.ceil(falta/dr):0,cor:entCor(i)}; });
  return entChartBarras(items,titulo);
}
function entChartDiarioTotal(){
  const nd=diasDoMes(entAno,entMes);
  const vals=[]; let mx=1; for(let d=1;d<=nd;d++){ const v=entTotalDia(entAno,entMes,d); vals.push(v); if(v>mx) mx=v; }
  const stepX=46,padL=14,padR=14,h=200,padT=30,padB=24,plotH=h-padT-padB;
  const w=padL+padR+(nd-1)*stepX;
  function X(i){ return padL+i*stepX; } function Y(v){ return padT+plotH-(v/mx*plotH); }
  let pts=""; for(let i=0;i<nd;i++) pts+=X(i).toFixed(1)+","+Y(vals[i]).toFixed(1)+" ";
  let area="M "+X(0).toFixed(1)+","+(padT+plotH); for(let i=0;i<nd;i++) area+=" L "+X(i).toFixed(1)+","+Y(vals[i]).toFixed(1); area+=" L "+X(nd-1).toFixed(1)+","+(padT+plotH)+" Z";
  const baseY=padT+plotH;
  let extra=""; for(let i=0;i<nd;i++){ extra+='<circle cx="'+X(i).toFixed(1)+'" cy="'+baseY.toFixed(1)+'" r="2.5" fill="#9bb7a6"/>'+'<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(vals[i]).toFixed(1)+'" r="4" fill="#157a35" stroke="#fff" stroke-width="1.5"/>'+'<text x="'+X(i).toFixed(1)+'" y="'+(Y(vals[i])-9).toFixed(1)+'" text-anchor="middle" font-size="13" font-weight="800" fill="#33404f">'+vals[i]+'</text>'+'<text x="'+X(i).toFixed(1)+'" y="'+(h-6)+'" text-anchor="middle" font-size="11" font-weight="700" fill="#5a6b7d">'+(i+1)+'</text>'; }
  const svg='<svg width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'"><path d="'+area+'" fill="rgba(21,122,53,.10)"/><polyline points="'+pts.trim()+'" fill="none" stroke="#157a35" stroke-width="2"/>'+extra+'</svg>';
  return '<div class="ent-graf"><h3>Total de Entregas por Dia</h3><div class="ent-svg-wrap">'+svg+'</div></div>';
}
function entChartDiarioPorEntregador(){
  const nd=diasDoMes(entAno,entMes);
  let mx=1;
  const series=entEntregadores.map(function(nm,i){ const vals=[]; for(let d=1;d<=nd;d++){ const v=entGet(entAno,entMes,nm,d); vals.push(v); if(v>mx) mx=v; } return {nm:nm,cor:entCor(i),vals:vals}; });
  const stepX=46,padL=14,padR=14,h=220,padT=16,padB=24,plotH=h-padT-padB;
  const w=padL+padR+(nd-1)*stepX;
  function X(i){ return padL+i*stepX; } function Y(v){ return padT+plotH-(v/mx*plotH); }
  // Resumo de TODOS os entregadores de cada dia (mostrado ao passar o mouse num ponto).
  entDiaTipData=[];
  for(let i=0;i<nd;i++){
    let body='<div style="font-weight:800;margin-bottom:4px">Dia '+(i+1)+'</div>';
    const ord=series.slice().sort(function(a,b){ return b.vals[i]-a.vals[i]; });
    ord.forEach(function(s){ body+='<div style="display:flex;align-items:center;gap:6px;line-height:1.5"><i style="width:9px;height:9px;border-radius:50%;background:'+s.cor+';display:inline-block;flex:none"></i>'+s.nm+' - '+s.vals[i]+'</div>'; });
    entDiaTipData[i]=body;
  }
  let lines="",hit=""; series.forEach(function(s){ let pts=""; for(let i=0;i<nd;i++) pts+=X(i).toFixed(1)+","+Y(s.vals[i]).toFixed(1)+" "; lines+='<polyline points="'+pts.trim()+'" fill="none" stroke="'+s.cor+'" stroke-width="2" opacity="0.9"/>'; for(let i=0;i<nd;i++){ lines+='<circle class="ent-pt" cx="'+X(i).toFixed(1)+'" cy="'+Y(s.vals[i]).toFixed(1)+'" r="3" fill="'+s.cor+'"/>'; hit+='<circle class="ent-day-hit" cx="'+X(i).toFixed(1)+'" cy="'+Y(s.vals[i]).toFixed(1)+'" r="9" fill="transparent" data-day="'+i+'"/>'; } });
  let axis=""; for(let i=0;i<nd;i++) axis+='<text x="'+X(i).toFixed(1)+'" y="'+(h-6)+'" text-anchor="middle" font-size="11" font-weight="700" fill="#5a6b7d">'+(i+1)+'</text>';
  let leg=""; series.forEach(function(s){ leg+='<span><i style="background:'+s.cor+'"></i>'+s.nm+'</span>'; });
  const svg='<svg width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'">'+lines+axis+hit+'</svg>';
  return '<div class="ent-graf"><h3>Desempenho Diário de Cada Entregador</h3><div class="ent-leg">'+leg+'</div><div class="ent-svg-wrap">'+svg+'</div></div>';
}
function entChartMensal(){
  const totals=[]; let mx=1; for(let m=0;m<12;m++){ const t=entTotalMes(entAno,m); totals.push(t); if(t>mx) mx=t; }
  let bars='<div style="display:flex;align-items:flex-end;gap:8px;height:170px;padding:0 4px;">';
  for(let m=0;m<12;m++){ const hgt=totals[m]/mx*130; bars+='<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;">'+(totals[m]>0?'<div style="font-size:11px;font-weight:700;color:#33404f;margin-bottom:3px;">'+num(totals[m])+'</div>':'')+'<div style="width:62%;background:'+(m===entMes?'#157a35':'#a9d8b6')+';border-radius:4px 4px 0 0;height:'+hgt.toFixed(0)+'px;"></div></div>'; }
  bars+='</div>';
  let labels='<div style="display:flex;gap:8px;padding:6px 4px 0;">'; for(let m=0;m<12;m++){ const ab=MESES[m].slice(0,3); const lbl=ab.charAt(0).toUpperCase()+ab.slice(1).toLowerCase(); labels+='<div style="flex:1;text-align:center;font-size:13px;'+(m===entMes?'font-weight:800;color:#0c5a26;':'font-weight:600;color:#56606d;')+'">'+lbl+'</div>'; } labels+='</div>';
  return '<div class="ent-graf"><h3>Entregas Mensais — '+entAno+'</h3>'+bars+labels+'</div>';
}
function entRenderGrade(){
  const nd=diasDoMes(entAno,entMes);
  let head='<tr><th class="nome">Entregador</th>';
  for(let d=1;d<=nd;d++){ const dow=new Date(entAno,entMes,d).getDay(); head+='<th class="'+(dow===0?"dom":"")+'">'+d+'<br><span class="ent-dow">'+DOW_PT[dow].toUpperCase()+'</span></th>'; }
  head+='<th>Total</th></tr>';
  let body="";
  entEntregadores.forEach(function(nm){
    let cels=""; for(let d=1;d<=nd;d++){ if(entFechado(entAno,entMes,d)){ cels+='<td class="dom-fix">0</td>'; continue; } const v=entGetRaw(entAno,entMes,nm,d); cels+='<td><input type="text" inputmode="numeric" data-nome="'+nm+'" data-dia="'+d+'" value="'+v+'"></td>'; }
    body+='<tr><td class="nome">'+nm+'</td>'+cels+'<td class="tot">'+num(entTotalEntregador(entAno,entMes,nm))+'</td></tr>';
  });
  let totRow='<tr class="linha-tot"><td class="nome">Total do dia</td>'; for(let d=1;d<=nd;d++) totRow+='<td>'+num(entTotalDia(entAno,entMes,d))+'</td>'; totRow+='<td>'+num(entTotalMes(entAno,entMes))+'</td></tr>';
  document.getElementById("entGrade").innerHTML='<table class="ent-grade"><thead>'+head+'</thead><tbody>'+body+totRow+'</tbody></table>';
}
function entUpdGradeTotais(){
  const tbl=document.querySelector("#entGrade table"); if(!tbl) return;
  const rows=tbl.querySelectorAll("tbody tr");
  entEntregadores.forEach(function(nm,ri){ const tr=rows[ri]; if(!tr) return; const c=tr.querySelector("td.tot"); if(c) c.textContent=num(entTotalEntregador(entAno,entMes,nm)); });
  const last=rows[rows.length-1]; if(last){ const tds=last.querySelectorAll("td"); const nd=diasDoMes(entAno,entMes); for(let d=1;d<=nd;d++){ if(tds[d]) tds[d].textContent=num(entTotalDia(entAno,entMes,d)); } if(tds[nd+1]) tds[nd+1].textContent=num(entTotalMes(entAno,entMes)); }
}
function entRenderGraficos(){
  const g=document.getElementById("entGraficos");
  if(entTotalMes(entAno,entMes)<=0){ g.innerHTML='<div class="ent-graf"><div class="ent-vazio">Nenhuma entrega lançada em '+MESES[entMes]+" "+entAno+'.<br>Clique em <b>Lançar entregas</b> pra começar.</div></div>'; return; }
  g.innerHTML=entChartPorEntregador()+
    '<div class="ent-graf2">'+entChartFaltam(ENT_META1,"Quanto Falta para "+ENT_META1)+entChartFaltam(ENT_META2,"Quanto Falta para "+ENT_META2)+'</div>'+
    '<div class="ent-graf2">'+entChartAtingir(ENT_META1,"Ritmo Diário para Bater "+ENT_META1)+entChartAtingir(ENT_META2,"Ritmo Diário para Bater "+ENT_META2)+'</div>'+
    entChartDiarioTotal()+entChartDiarioPorEntregador()+entChartMensal();
}
function entRenderEntregadoresEdit(){
  const box=document.getElementById("entEntregadoresEdit");
  let rows="";
  entEntregadores.forEach(function(nm){ rows+='<div class="ent-edit-row"><input type="text" class="ent-nome-edit" data-old="'+nm.replace(/"/g,"&quot;")+'" value="'+nm.replace(/"/g,"&quot;")+'"><button type="button" class="rm" data-rm="'+nm.replace(/"/g,"&quot;")+'" title="Remover">×</button></div>'; });
  const corpo=entEntEditOpen
    ? '<div class="ent-edit-body">'+rows+
      '<div class="ent-edit-add"><input type="text" id="entNovoNome" placeholder="Nome do novo entregador"><button type="button" id="entAddBtn">+ Adicionar</button></div></div>'
    : '';
  box.innerHTML='<div class="ent-edit-box"><div class="ent-edit-tit"><b>👤 Entregadores</b><button type="button" class="ent-edit-toggle" id="entEditToggle">'+(entEntEditOpen?"Fechar":"Editar entregadores")+'</button></div>'+corpo+'</div>';
}
function renderEntregas(){
  document.getElementById("entTitulo").textContent=MESES[entMes]+" "+entAno;
  const be=document.getElementById("entEditar");
  be.classList.toggle("ativo",entEdit);
  be.innerHTML=entEdit?"✓ Concluir lançamento":"✏️ Lançar entregas";
  document.getElementById("entGradeWrap").style.display=entEdit?"":"none";
  entRenderKpis();
  if(entEdit){ entRenderEntregadoresEdit(); entRenderGrade(); }
  entRenderGraficos();
}
(function initEntregas(){
  document.getElementById("entPrev").addEventListener("click",function(){ entMes--; if(entMes<0){entMes=11;entAno--;} renderEntregas(); });
  document.getElementById("entNext").addEventListener("click",function(){ entMes++; if(entMes>11){entMes=0;entAno++;} renderEntregas(); });
  document.getElementById("entHoje").addEventListener("click",function(){ entAno=HOJE.getFullYear(); entMes=HOJE.getMonth(); renderEntregas(); });
  document.getElementById("entEditar").addEventListener("click",function(){ entEdit=!entEdit; renderEntregas(); });
  document.getElementById("entEntregadoresEdit").addEventListener("click",function(e){
    if(e.target.closest("#entEditToggle")){ entEntEditOpen=!entEntEditOpen; entRenderEntregadoresEdit(); return; }
    if(e.target.closest("#entAddBtn")){ const inp=document.getElementById("entNovoNome"); if(entAddEntregador(inp.value)){ renderEntregas(); } else { uiConfirm({titulo:"Aviso",msg:"Nome inválido ou já existe.",ok:"OK",cancel:""}); } return; }
    const rm=e.target.closest("[data-rm]");
    if(rm){ const nm=rm.getAttribute("data-rm"); uiConfirm({titulo:"Remover entregador",msg:'Tirar "'+nm+'" da lista? Os lançamentos antigos dele continuam guardados, mas ele some da grade.',ok:"Remover",cancel:"Cancelar"}).then(function(ok){ if(ok){ entRemoveEntregador(nm); renderEntregas(); } }); return; }
  });
  document.getElementById("entEntregadoresEdit").addEventListener("keydown",function(e){
    if(e.key==="Enter" && e.target.id==="entNovoNome"){ e.preventDefault(); if(entAddEntregador(e.target.value)){ renderEntregas(); } else { uiConfirm({titulo:"Aviso",msg:"Nome inválido ou já existe.",ok:"OK",cancel:""}); } }
  });
  document.getElementById("entEntregadoresEdit").addEventListener("change",function(e){
    const inp=e.target.closest(".ent-nome-edit"); if(!inp) return;
    const old=inp.getAttribute("data-old"), nv=inp.value.trim();
    if(nv===old) return;
    if(entRenameEntregador(old,nv)){ renderEntregas(); } else { inp.value=old; uiConfirm({titulo:"Aviso",msg:"Nome inválido ou já existe.",ok:"OK",cancel:""}); }
  });
  document.getElementById("entGrade").addEventListener("input",function(e){ const inp=e.target.closest("input[data-nome]"); if(!inp) return; const raw=(inp.value||"").replace(/[^0-9]/g,""); entSet(entAno,entMes,inp.dataset.nome,+inp.dataset.dia,raw===""?"":parseInt(raw,10)); entRenderKpis(); entUpdGradeTotais(); });
  document.getElementById("entGrade").addEventListener("change",function(e){ if(e.target.closest("input[data-nome]")) entRenderGraficos(); });
  document.getElementById("entGrade").addEventListener("keydown",function(e){
    if(e.key!=="Enter") return;
    const inp=e.target.closest("input[data-nome]"); if(!inp) return;
    e.preventDefault();
    const inputs=[].slice.call(document.querySelectorAll('#entGrade input[data-dia="'+inp.dataset.dia+'"]'));
    let next=inputs[inputs.indexOf(inp)+1];
    if(!next){
      let nd=parseInt(inp.dataset.dia,10)+1, guard=0;
      while(!next && guard<40){ const prox=[].slice.call(document.querySelectorAll('#entGrade input[data-dia="'+nd+'"]')); next=prox[0]; nd++; guard++; }
    }
    if(next){ next.focus(); next.select(); }
  });
  const entTip=document.getElementById("entTip");
  document.getElementById("entGraficos").addEventListener("mouseover",function(e){
    const c=e.target.closest(".ent-day-hit"); if(!c) return;
    const di=+c.getAttribute("data-day");
    if(entDiaTipData[di]==null) return;
    entTip.innerHTML=entDiaTipData[di]; entTip.style.display="block";
  });
  document.getElementById("entGraficos").addEventListener("mousemove",function(e){
    if(entTip.style.display!=="block") return;
    let x=e.clientX+14, y=e.clientY+14;
    const r=entTip.getBoundingClientRect();
    if(x+r.width>window.innerWidth-8) x=e.clientX-r.width-14;
    if(y+r.height>window.innerHeight-8) y=e.clientY-r.height-14;
    entTip.style.left=x+"px"; entTip.style.top=y+"px";
  });
  document.getElementById("entGraficos").addEventListener("mouseout",function(e){
    if(e.target.closest(".ent-day-hit")) entTip.style.display="none";
  });
})();

/* ===== Perdas / Quebras ===== */
const PRD_SETORES = ["Hortifruti","Açougue","Padaria","Frios/Laticínios","Mercearia","Bebidas","Limpeza","Estoque","Frente de Loja","Outro"];
const PRD_MOTIVOS = ["Vencido","Quebrado/Avariado","Estragado","Furto","Erro de pedido","Outro"];
const PRD_SETOR_COR = {"Hortifruti":"#2a9d8f","Açougue":"#c0392b","Padaria":"#e8820e","Frios/Laticínios":"#0e7c8b","Mercearia":"#157a35","Bebidas":"#7048b6","Limpeza":"#2a6fb0","Estoque":"#5a6678","Frente de Loja":"#b0398e","Outro":"#8a97a8"};
function prdSetorCor(s){ return PRD_SETOR_COR[s]||"#8a97a8"; }
let prdAno=HOJE.getFullYear(), prdMes=HOJE.getMonth(), prdEdit=false;
function prdLoad(){ try{ const s=localStorage.getItem("perdas"); if(s){ const a=JSON.parse(s); if(Array.isArray(a)) return a; } }catch(e){} return []; }
let prdData = prdLoad();
function prdSave(){ try{ localStorage.setItem("perdas", JSON.stringify(prdData)); }catch(e){} }
// Exemplos (só na 1ª vez, pra você ver como fica). Se apagar, não volta mais.
(function prdSeedDemo(){
  try{ if(localStorage.getItem("perdas_demo_v1")==="1") return; }catch(e){}
  if(prdData.length) { try{ localStorage.setItem("perdas_demo_v1","1"); }catch(e){} return; }
  const y=HOJE.getFullYear(), m=String(HOJE.getMonth()+1).padStart(2,"0");
  const d=function(dia){ return y+"-"+m+"-"+String(dia).padStart(2,"0"); };
  const ex=[
    [3,"Tomate","Hortifruti","Estragado",12,38.40],
    [3,"Banana","Hortifruti","Estragado",18,32.00],
    [5,"Alface","Hortifruti","Vencido",8,15.20],
    [6,"Picanha","Açougue","Vencido",2,178.00],
    [7,"Frango","Açougue","Estragado",5,62.50],
    [8,"Pão francês","Padaria","Estragado",40,56.00],
    [10,"Iogurte","Frios/Laticínios","Vencido",15,89.70],
    [12,"Leite","Frios/Laticínios","Quebrado/Avariado",6,29.40],
    [14,"Refrigerante 2L","Bebidas","Quebrado/Avariado",4,35.60],
    [16,"Cerveja lata","Bebidas","Quebrado/Avariado",12,48.00],
    [18,"Arroz 5kg","Mercearia","Quebrado/Avariado",2,49.80],
    [20,"Detergente","Limpeza","Quebrado/Avariado",5,14.50],
    [22,"Queijo mussarela","Frios/Laticínios","Vencido",3,96.00],
    [24,"Maçã","Hortifruti","Estragado",10,41.00],
    [25,"Chocolate","Mercearia","Furto",6,54.00]
  ];
  prdData=ex.map(function(r){ return { id:prdUid(), data:d(r[0]), produto:r[1], setor:r[2], motivo:r[3], qtd:r[4], valor:r[5], origem:"manual" }; });
  prdSave();
  try{ localStorage.setItem("perdas_demo_v1","1"); }catch(e){}
})();
function prdUid(){ return "p"+Date.now().toString(36)+Math.floor(Math.random()*1000); }
function prdEsc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
function prdMesItens(){ const pref=prdAno+"-"+String(prdMes+1).padStart(2,"0"); return prdData.filter(function(r){ return r.data && r.data.indexOf(pref)===0; }); }
function prdAgrupa(itens, keyfn){ const m=new Map(); itens.forEach(function(r){ const k=keyfn(r)||"Outro"; m.set(k,(m.get(k)||0)+(+r.valor||0)); }); return Array.from(m.entries()).map(function(e){ return {k:e[0],v:e[1]}; }); }
function prdBars(data){
  if(!data.length) return '<p class="prd-vazio">Sem dados.</p>';
  const max=Math.max.apply(null,data.map(function(d){return d.value;}).concat([1]));
  return '<div class="hbars">'+data.map(function(d){
    return '<div class="hbar-row"><span class="hbar-lbl" title="'+prdEsc(d.label)+'">'+prdEsc(d.label)+'</span><div class="hbar-track"><div class="hbar-fill" style="width:'+(d.value/max*100)+'%;background:'+(d.cor||"#157a35")+'"></div></div><span class="hbar-val">'+(d.sub||brl(d.value))+'</span></div>';
  }).join('')+'</div>';
}
function prdRenderKpis(){
  const itens=prdMesItens();
  const totVal=soma(itens.map(function(r){return +r.valor||0;}));
  const totQtd=soma(itens.map(function(r){return +r.qtd||0;}));
  const bySetor=prdAgrupa(itens,function(r){return r.setor;}).sort(function(a,b){return b.v-a.v;});
  const byMotivo=prdAgrupa(itens,function(r){return r.motivo;}).sort(function(a,b){return b.v-a.v;});
  const byProd=prdAgrupa(itens,function(r){return r.produto;}).sort(function(a,b){return b.v-a.v;});
  const cards=[
    {v:brl(totVal),l:"Total perdido"},
    {v:num(totQtd),l:"Itens perdidos"},
    {v:num(itens.length),l:"Registros"},
    {v:bySetor[0]?prdEsc(bySetor[0].k):"—",l:"Setor que mais perde"},
    {v:byMotivo[0]?prdEsc(byMotivo[0].k):"—",l:"Motivo principal"},
    {v:byProd[0]?prdEsc(byProd[0].k):"—",l:"Produto top perda"}
  ];
  document.getElementById("prdKpis").innerHTML=cards.map(function(c){ return '<div class="kpi"><div class="v">'+c.v+'</div><div class="l">'+c.l+'</div></div>'; }).join('');
}
function prdRenderEdit(){
  const wrap=document.getElementById("prdEditWrap");
  const itens=prdMesItens().slice().sort(function(a,b){ return a.data<b.data?1:(a.data>b.data?-1:0); });
  const setorOpts=PRD_SETORES.map(function(s){return '<option>'+s+'</option>';}).join("");
  const motivoOpts=PRD_MOTIVOS.map(function(s){return '<option>'+s+'</option>';}).join("");
  const isoHoje=HOJE.getFullYear()+"-"+String(HOJE.getMonth()+1).padStart(2,"0")+"-"+String(HOJE.getDate()).padStart(2,"0");
  const defData=(HOJE.getFullYear()===prdAno && HOJE.getMonth()===prdMes)?isoHoje:(prdAno+"-"+String(prdMes+1).padStart(2,"0")+"-01");
  let h='<div class="prd-form"><h4>Registrar nova perda</h4><div class="prd-grid">'
    +'<div class="prd-fld"><label>Data</label><input type="date" id="prdNData" value="'+defData+'"></div>'
    +'<div class="prd-fld"><label>Produto</label><input id="prdNProd" placeholder="Ex: Tomate"></div>'
    +'<div class="prd-fld"><label>Setor</label><select id="prdNSetor">'+setorOpts+'</select></div>'
    +'<div class="prd-fld"><label>Motivo</label><select id="prdNMotivo">'+motivoOpts+'</select></div>'
    +'<div class="prd-fld"><label>Qtd</label><input id="prdNQtd" type="number" min="0" step="1" placeholder="0"></div>'
    +'<div class="prd-fld"><label>Valor (R$)</label><input id="prdNValor" type="number" min="0" step="0.01" placeholder="0,00"></div>'
    +'<button class="prd-add" id="prdAddBtn" type="button">Adicionar</button>'
    +'</div></div>';
  if(!itens.length){ h+='<p class="prd-vazio">Nenhuma perda lançada em '+MESES[prdMes]+' '+prdAno+' ainda.</p>'; }
  else {
    h+='<div class="prd-lista-wrap"><table class="prd-lista"><thead><tr><th>Data</th><th>Produto</th><th>Setor</th><th>Motivo</th><th>Qtd</th><th>Valor</th><th></th></tr></thead><tbody>';
    itens.forEach(function(r){
      const cor=prdSetorCor(r.setor);
      h+='<tr><td>'+r.data.split("-").reverse().join("/")+'</td>'
        +'<td>'+prdEsc(r.produto||"-")+(r.origem==="vr"?' <span class="prd-origem">(VR)</span>':'')+'</td>'
        +'<td><span class="prd-tag" style="background:'+cor+'22;color:'+cor+'">'+prdEsc(r.setor||"-")+'</span></td>'
        +'<td>'+prdEsc(r.motivo||"-")+'</td>'
        +'<td class="r">'+num(r.qtd||0)+'</td>'
        +'<td class="val">'+brl(r.valor||0)+'</td>'
        +'<td>'+(r.origem==="vr"?'':'<button class="prd-rm" data-rm="'+r.id+'" title="Remover">✕</button>')+'</td></tr>';
    });
    h+='</tbody></table></div>';
  }
  wrap.innerHTML=h;
}
function prdRenderGraficos(){
  const el=document.getElementById("prdGraficos");
  const itens=prdMesItens();
  if(!itens.length){ el.innerHTML='<div class="prd-graf"><p class="prd-vazio">Nenhuma perda registrada em '+MESES[prdMes]+' '+prdAno+'.<br>Clique em <b>＋ Lançar perda</b> para começar.</p></div>'; return; }
  const porSetor=prdAgrupa(itens,function(r){return r.setor;}).map(function(d){ return {label:d.k,value:d.v,cor:prdSetorCor(d.k)}; }).sort(function(a,b){return b.value-a.value;});
  const porMotivo=prdAgrupa(itens,function(r){return r.motivo;}).map(function(d,i){ return {label:d.k,value:d.v,cor:cores[i%cores.length]}; }).sort(function(a,b){return b.value-a.value;});
  const porProd=prdAgrupa(itens,function(r){return r.produto;}).map(function(d){ return {label:d.k,value:d.v,cor:"#c0392b"}; }).sort(function(a,b){return b.value-a.value;}).slice(0,10);
  let h='<div class="prd-graf2">';
  h+='<div class="prd-graf"><h3>Perdas por setor</h3>'+prdBars(porSetor)+'</div>';
  h+='<div class="prd-graf"><h3>Perdas por motivo</h3>'+prdBars(porMotivo)+'</div>';
  h+='</div>';
  h+='<div class="prd-graf"><h3>Produtos que mais geram perda</h3>'+prdBars(porProd)+'</div>';
  el.innerHTML=h;
}
function renderPerdas(){
  document.getElementById("prdTitulo").textContent=MESES[prdMes]+" "+prdAno;
  const be=document.getElementById("prdEditar");
  be.classList.toggle("ativo",prdEdit);
  be.innerHTML=prdEdit?"✓ Concluir":"＋ Lançar perda";
  document.getElementById("prdEditWrap").style.display=prdEdit?"":"none";
  prdRenderKpis();
  if(prdEdit) prdRenderEdit();
  prdRenderGraficos();
}
function prdAddFromForm(){
  const data=document.getElementById("prdNData").value;
  const produto=(document.getElementById("prdNProd").value||"").trim();
  const setor=document.getElementById("prdNSetor").value;
  const motivo=document.getElementById("prdNMotivo").value;
  const qtd=parseFloat(document.getElementById("prdNQtd").value)||0;
  const valor=parseFloat(document.getElementById("prdNValor").value)||0;
  if(!data){ uiConfirm({titulo:"Aviso",msg:"Informe a data da perda.",ok:"OK",cancel:""}); return; }
  if(!produto && valor===0 && qtd===0){ uiConfirm({titulo:"Aviso",msg:"Preencha pelo menos o produto e o valor (ou a quantidade).",ok:"OK",cancel:""}); return; }
  prdData.push({ id:prdUid(), data:data, produto:produto, setor:setor, motivo:motivo, qtd:qtd, valor:valor, origem:"manual" });
  prdSave();
  renderPerdas();
}
(function initPerdas(){
  document.getElementById("prdPrev").addEventListener("click",function(){ prdMes--; if(prdMes<0){prdMes=11;prdAno--;} renderPerdas(); });
  document.getElementById("prdNext").addEventListener("click",function(){ prdMes++; if(prdMes>11){prdMes=0;prdAno++;} renderPerdas(); });
  document.getElementById("prdHoje").addEventListener("click",function(){ prdAno=HOJE.getFullYear(); prdMes=HOJE.getMonth(); renderPerdas(); });
  document.getElementById("prdEditar").addEventListener("click",function(){ prdEdit=!prdEdit; renderPerdas(); });
  const wrap=document.getElementById("prdEditWrap");
  wrap.addEventListener("click",function(e){
    if(e.target.closest("#prdAddBtn")){ prdAddFromForm(); return; }
    const rm=e.target.closest("[data-rm]");
    if(rm){ const id=rm.getAttribute("data-rm"); uiConfirm({titulo:"Remover perda",msg:"Tem certeza que quer apagar este registro?",ok:"Remover",cancel:"Cancelar"}).then(function(ok){ if(ok){ prdData=prdData.filter(function(r){return r.id!==id;}); prdSave(); renderPerdas(); } }); return; }
  });
  wrap.addEventListener("keydown",function(e){ if(e.key==="Enter" && e.target.closest(".prd-form") && e.target.tagName==="INPUT"){ e.preventDefault(); prdAddFromForm(); } });
})();

/* ===== Perdas do Açougue (aba dedicada) ===== */
const ACO_MOTIVOS = ["Osso/aparas","Gordura/sebo","Quebra de peso","Queda no chão","Vencido","Estragado","Corte errado","Outro"];
const ACO_BOI_URI = "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjwhLS0gQ3JlYXRlZCB3aXRoIElua3NjYXBlIChodHRwOi8vd3d3Lmlua3NjYXBlLm9yZy8pIC0tPgoKPHN2ZwogICB4bWxuczpkYz0iaHR0cDovL3B1cmwub3JnL2RjL2VsZW1lbnRzLzEuMS8iCiAgIHhtbG5zOmNjPSJodHRwOi8vY3JlYXRpdmVjb21tb25zLm9yZy9ucyMiCiAgIHhtbG5zOnJkZj0iaHR0cDovL3d3dy53My5vcmcvMTk5OS8wMi8yMi1yZGYtc3ludGF4LW5zIyIKICAgeG1sbnM6c3ZnPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIKICAgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIgogICB4bWxuczpzb2RpcG9kaT0iaHR0cDovL3NvZGlwb2RpLnNvdXJjZWZvcmdlLm5ldC9EVEQvc29kaXBvZGktMC5kdGQiCiAgIHhtbG5zOmlua3NjYXBlPSJodHRwOi8vd3d3Lmlua3NjYXBlLm9yZy9uYW1lc3BhY2VzL2lua3NjYXBlIgogICB2ZXJzaW9uPSIxLjIiCiAgIHdpZHRoPSI4MDUuNzY4MTMiCiAgIGhlaWdodD0iNjA5LjA5OTk4IgogICBpZD0ic3ZnMzgzOCIKICAgaW5rc2NhcGU6dmVyc2lvbj0iMC40NyByMjI1ODMiCiAgIHNvZGlwb2RpOmRvY25hbWU9IkJlZWZfY3V0c19CcmF6aWxfYS5zdmciPgogIDxtZXRhZGF0YQogICAgIGlkPSJtZXRhZGF0YTMyMTYiPgogICAgPHJkZjpSREY+CiAgICAgIDxjYzpXb3JrCiAgICAgICAgIHJkZjphYm91dD0iIj4KICAgICAgICA8ZGM6Zm9ybWF0PmltYWdlL3N2Zyt4bWw8L2RjOmZvcm1hdD4KICAgICAgICA8ZGM6dHlwZQogICAgICAgICAgIHJkZjpyZXNvdXJjZT0iaHR0cDovL3B1cmwub3JnL2RjL2RjbWl0eXBlL1N0aWxsSW1hZ2UiIC8+CiAgICAgIDwvY2M6V29yaz4KICAgIDwvcmRmOlJERj4KICA8L21ldGFkYXRhPgogIDxzb2RpcG9kaTpuYW1lZHZpZXcKICAgICBwYWdlY29sb3I9IiNmZmZmZmYiCiAgICAgYm9yZGVyY29sb3I9IiM2NjY2NjYiCiAgICAgYm9yZGVyb3BhY2l0eT0iMSIKICAgICBvYmplY3R0b2xlcmFuY2U9IjEwIgogICAgIGdyaWR0b2xlcmFuY2U9IjEwIgogICAgIGd1aWRldG9sZXJhbmNlPSIxMCIKICAgICBpbmtzY2FwZTpwYWdlb3BhY2l0eT0iMCIKICAgICBpbmtzY2FwZTpwYWdlc2hhZG93PSIyIgogICAgIGlua3NjYXBlOndpbmRvdy13aWR0aD0iMTI4MCIKICAgICBpbmtzY2FwZTp3aW5kb3ctaGVpZ2h0PSI5NzMiCiAgICAgaWQ9Im5hbWVkdmlldzMyMTQiCiAgICAgc2hvd2dyaWQ9ImZhbHNlIgogICAgIGlua3NjYXBlOnpvb209IjEuMTU0Mjc4OCIKICAgICBpbmtzY2FwZTpjeD0iNDAyLjg4NDA2IgogICAgIGlua3NjYXBlOmN5PSIzMDQuNTQ5OTkiCiAgICAgaW5rc2NhcGU6d2luZG93LXg9IjAiCiAgICAgaW5rc2NhcGU6d2luZG93LXk9IjI5IgogICAgIGlua3NjYXBlOndpbmRvdy1tYXhpbWl6ZWQ9IjEiCiAgICAgaW5rc2NhcGU6Y3VycmVudC1sYXllcj0ic3ZnMzgzOCIgLz4KICA8ZGVmcwogICAgIGlkPSJkZWZzMzg0MCI+CiAgICA8aW5rc2NhcGU6cGVyc3BlY3RpdmUKICAgICAgIHNvZGlwb2RpOnR5cGU9Imlua3NjYXBlOnBlcnNwM2QiCiAgICAgICBpbmtzY2FwZTp2cF94PSIwIDogMzA0LjU0OTk5IDogMSIKICAgICAgIGlua3NjYXBlOnZwX3k9IjAgOiAxMDAwIDogMCIKICAgICAgIGlua3NjYXBlOnZwX3o9IjgwNS43NjgxMyA6IDMwNC41NDk5OSA6IDEiCiAgICAgICBpbmtzY2FwZTpwZXJzcDNkLW9yaWdpbj0iNDAyLjg4NDA2IDogMjAzLjAzMzMzIDogMSIKICAgICAgIGlkPSJwZXJzcGVjdGl2ZTMyMTgiIC8+CiAgPC9kZWZzPgogIDx0ZXh0CiAgICAgeD0iMTgyLjMwNDIzIgogICAgIHk9Ijc0LjYxMjc5MyIKICAgICBpZD0idGV4dDI1NzciCiAgICAgeG1sOnNwYWNlPSJwcmVzZXJ2ZSIKICAgICBzdHlsZT0iZm9udC1zaXplOjEycHg7Zm9udC1zdHlsZTpub3JtYWw7Zm9udC12YXJpYW50Om5vcm1hbDtmb250LXdlaWdodDpub3JtYWw7Zm9udC1zdHJldGNoOm5vcm1hbDt0ZXh0LWFsaWduOnN0YXJ0O2xpbmUtaGVpZ2h0OjEyNSU7d3JpdGluZy1tb2RlOmxyLXRiO3RleHQtYW5jaG9yOnN0YXJ0O2ZpbGw6IzAwMDAwMDtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtmb250LWZhbWlseTpDYWxpYnJpOy1pbmtzY2FwZS1mb250LXNwZWNpZmljYXRpb246Q2FsaWJyaSIKICAgICBzb2RpcG9kaTpsaW5lc3BhY2luZz0iMTI1JSI+PHRzcGFuCiAgICAgICB4PSIxODIuMzA0MjMiCiAgICAgICB5PSI3NC42MTI3OTMiCiAgICAgICBpZD0idHNwYW4yNTc5IiAvPjwvdGV4dD4KICA8cGF0aAogICAgIGQ9Im0gNjk4LjM4NzUzLDI1NS4xMDc0NiBjIDAuODUzODYsMy41NzM3MSAxLjY2ODkyLDYuNDA1MjkgMi45NDY1Niw5LjAxNDY0IDIuMzIwMzMsLTMuMzI1ODUgNC4zODU5NywtNi44OTIyMiA2LjMxNzk5LC0xMC43OTM1IGwgLTkuMjY0NTUsMS43Nzg4NiB6IgogICAgIGlkPSJwYXRoMjQ4NSIKICAgICBzdHlsZT0iZmlsbDojZmZiMzgwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA2OTUuNTM5NSwxNTkuOTQzMDIgYyAtMjQuMzk5MjUsNS4xODgwMiAtNDEuNTIyNzEsNTMuMTI5NjcgLTMzLjIwODg4LDgwLjIzMTI3IDEyLjU0Nzg2LC0yMS44MDY0NSAzNy44MjMxMywtNDQuMzg4MTMgMzMuMjA4ODgsLTgwLjIzMTI3IHoiCiAgICAgaWQ9InBhdGgyNDcxIgogICAgIHN0eWxlPSJmaWxsOiNlOWM2YWY7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDY3OS45MDIxLDExMy42MDUxNCAtMi40MDYzNiw2LjA2MTgyIGMgMTQuMTI0MjcsMTUuMDAwOTcgMTYuODE4MDUsMjEuMjQ5NjQgMjAuMjE0MTUsMzYuNzA3NDcgOC4wNDAyMywxLjU2MDI1IDkuMzA5OTMsMy43NzQxMyAxNC4wODIwNyw4LjAzMjQyIDMuNTc1MTEsLTIxLjQ3NzgyIC0xMC41MDgzOSwtMzkuMTIwMTIgLTMxLjg4OTg2LC01MC44MDE3MSB6IgogICAgIGlkPSJwYXRoMjQ5MSIKICAgICBzdHlsZT0iZmlsbDojYWZkZGU5O2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA2OTQuNDMwMDMsNzAuODIxNzYgYyAtNS41ODkzNywxMS4zNTg1MSAtMTAuOTc1NjgsMjguNzczMTYgLTE0LjIyMDYxLDM5LjM4NDggMzQuNTg5NTUsMjQuMTU2OTEgMzQuMzg4NDEsMzAuNjg2NzMgMzUuNjA5MzcsNTguMDU4NzQgNy4wMjMxMiwxNC42MjgzNyA0LjU1MjIzLDI0LjIzMzU4IDcuMjgxOSw0MC43MzMwMSAxNC4yNjc2NywtNjYuMDA1MzggLTUuMTAzOSwtMTE1LjI5NDcxIC0yOC42NzA2NiwtMTM4LjE3NjU1IHoiCiAgICAgaWQ9InBhdGgyNDgzIgogICAgIHN0eWxlPSJmaWxsOiNmZmIzODA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDY4Ni4xNTQ0Miw2MS4yNDA5NjMgYyAtMTIuNDk1MjUsLTIuMDU0NTkxIC00NC44MjI0NCwtNS4xNDU0NDkgLTgzLjg5NDQ1LC0xLjcxNDIxOSAyLjM5MDMzLDE5LjIyMzA0NiAzOS4wNjI4Nyw0NC4xOTg1NzYgNzQuNTc3NjUsNDguOTkwMzA2IDQuODk5OTUsLTE0LjY2NzggMTEuNjU3MzQsLTMyLjM3MDYxIDE0LjU0NjExLC0zOS40NDQzNiBsIC01LjIyOTMxLC03LjgzMTcyNyB6IgogICAgIGlkPSJwYXRoMjQ0NyIKICAgICBzdHlsZT0iZmlsbDojY2RkZTg3O2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA0NzUuMjk5MjEsNjcuMzgyMDQgNC4xNTc2Nyw2LjkzOTAzIGMgMzkuMzcyOTUsLTUuMTQ3MTYgODkuOTk1NzYsLTAuNDkxMDUgMTIzLjg3NTQzLC0zLjcyMzU3IC0xLjYxMDc2LC0zLjc1NTQ1OSAtMi41NTA1NSwtNi4xMTM0MjUgLTcuMjAwMiwtMTEuNTQzMzMzIC00MC4zNzgzOSwwLjk0NzE1OCAtODAuNjgwMDQsNC4wNjE1NzkgLTEyMC44MzI5LDguMzI3ODczIHoiCiAgICAgaWQ9InBhdGgyNTA5IgogICAgIHN0eWxlPSJmaWxsOiNlZWZmYWE7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDYxNi44NTQ3OSwyNTIuMzY5MzUgYyA2LjU1NDAzLDcuMDczOTYgMTQuMjI3OTcsMTQuNTEwNjggMjAuMTg4NTcsMjIuNjEyNzcgMy42NjQxMywtNi40MTgwNyAxNi44MTY4MywtMjUuNjUxMjggMjIuNDU5NDcsLTMyLjc3NDUxIC04Ljc2OTA5LC0zMS44MTUwOCA0LjAzMzEzLC03MS4xNTcxNiAzNS4wNjQ5MywtODUuNjYyNCAtMS4yNzUxOCwtMTIuMzk5MDEgLTkuNDMzNTksLTI0LjIyMDkgLTE4LjYyNDUzLC0zMi4yODM3MyAtMTguMjA3NTMsNDQuMTQxMjQgLTMzLjU3NTM2LDg2LjIyNTA5IC01OS4wODg0NCwxMjguMTA3ODcgeiIKICAgICBpZD0icGF0aDI1MDEiCiAgICAgc3R5bGU9ImZpbGw6I2FjOWQ5MztmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZSIgLz4KICA8cGF0aAogICAgIGQ9Im0gMjA2LjEzNzM2LDM1LjgyMjc1NiBjIC03LjQyOTg0LDEuMjU2Nzk4IC0xNC45MTE4MywyLjg3ODUwMSAtMjIuMTEyNzUsNC45NDcxMjUgLTEuMzU0MDIsMi4xMzk3OCAtMC4yMjIsNS4zNTMyMjYgLTAuNjE3MzEsNy44OTAxODIgMC41MTk3OSwzMC43ODgwMzcgLTYuNzI3NzYsNjAuOTkxODk3IC0xNi43OTUyNSw4OS44NjE5MjcgLTAuNTk5NTQsMS41NjcgLTEuODk5MzEsNC40MjMxIDAuNjIyMzMsNC45NDk3MSAxNy42NjgyNiw1LjgwNTg2IDMwLjcwNzI1LDIwLjE0MzkxIDQxLjY4NTEyLDM0LjU1NSAyLjc1NjMzLDMuMzE2MjMgNC44MzI2NCw3LjM3MDE4IDguMjMxNjksMTAuMDc5MjIgMy4wMTkzMiwwLjAzNTQgMi4wMjU0OCwtNC4yMzMwNyAyLjQ1Nzk3LC02LjE0OTEzIDIuOTgxMzgsLTI4LjUzMjMyIDExLjQzMTk4LC01OC45MDM2NSAzNC42NTAzOCwtNzcuMjcyMjkgMC4zMDI4OCwtMi42OTk3NyAtMi43NjkxNCwtNC40NzQ1MyAtNC4wNjQzNCwtNi41NjA0OCAtMTUuMzE3MzQsLTE3LjI0OTY4IC0yMC42MDcxNCwtNDEuMzE2ODYyIC0zNy4yNTU2MSwtNTcuNjI2NTM4IC0xLjk5MzA4LC0xLjcxMDkzNSAtMy45Nzk4NSwtNC41MDU1MDMgLTYuODAyMjMsLTQuNjc0NzI2IHoiCiAgICAgaWQ9InBhdGgyNDYzIgogICAgIHN0eWxlPSJmaWxsOiNlOWM2YWY7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDE0NS41ODQxNCwxNDMuNDMyODIgYyAtMTAuMTg3NjUsLTAuNTI1NDQgLTYzLjc1MTQyNSw5LjU5NzIxIC01Ny43MTc2NjgsMjYuNDI3NCAzNC4yMTY4MzgsMTEuNzgxMDggNzcuMjAwMDM4LDExLjg2MzA4IDEwMy40Mzk0MDgsMzkuNTI5NDUgNS45NDI0OSwxNS44ODcwNSA3LjU0NDE5LDIzLjg3NDE4IDkuOTQ0MDMsMzUuODk1NzQgNS41OTc3OCwxMS43MzU1NyAxMC4yNTc4NiwyNi41ODAwNCAxOC4xMDYzNyw1Ny43MzExMyBsIDkuNzUyMTMsLTIuNzg2NTYgYyAtNC43NTQyMSwtMzMuNDMzNzIgLTEwLjE4ODEsLTcwLjgyNDQ0IC0xMC41ODExOSwtMTA0LjY2NjAxIC0xOC41ODc0NCwtMjcuMzQ5ODMgLTM3LjY5MDI4LC01Mi4yMDM3OCAtNzIuOTQzMDgsLTUyLjEzMTE1IHoiCiAgICAgaWQ9InBhdGgyNDk3IgogICAgIHN0eWxlPSJmaWxsOiNkYmUyZTM7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDI3OS42ODY3MSw5Ny4xNzQ3MyBjIC0yMC4xNTk5LC0wLjI0MDcxIC0zNC4xMzczNyw4LjA1ODk0IC00NS41NTQxOCwzMi4zNzk4OCAtMjAuNTI3NzQsMzQuNzc3NjQgLTExLjE3ODY4LDk3Ljg3MDQgLTcuODg3NzcsMTI2LjM2MjM0IDMuMjkwOTEsMjguNDkxOTQgNC4zMDE2NCwzMy4xNjM0MyA2LjkyODUzLDQ4LjEwNzcgMTUuNTYyMywyLjAyMTkgMzMuMjk5NjQsNS40MTkyIDQ4LjcxMTM0LDUuNzk1MzQgMTkuNzAwMSwtMzkuMTEwMjggNDIuNjczODksLTc3Ljc1MDkzIDUzLjA3MTkxLC0xMjAuNTExMTYgNy4xNDI2OCwtMzMuODc5NDggLTAuMzk4MTksLTY3LjQzMjc4IC0yMi4zNjQ2NywtODEuMzc0NTYgLTguMjgxODksLTUuNTUxNDYgLTIzLjAwMDY1LC0xMC44NTkyOSAtMzIuOTA1MTYsLTEwLjc1OTU0IHoiCiAgICAgaWQ9InBhdGgyNDQxIgogICAgIHN0eWxlPSJmaWxsOiNhYzlkOTM7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDY5Ni4zMjEwOSwyNTEuMzc2MjkgYyA2LjQ0MzQsLTAuODIyODEgOC44Njg0MiwtMS42MTQwNyAxMy40MjQ3MSwtMi41Nzg4NiA1LjQ0MzgzLC0xMi4yNzE2OCA2LjY2MDg0LC0xNS4yNDMwMSA5LjYyNTY0LC0yMy44MTI0IDEuMDU0OTMsLTExLjczNzIyIC0wLjk0ODgyLC00Mi43OTE5OCAtNC4yNTAzMSwtNDkuNDgxNzMgLTMuNDY3NCwyMS4yOTkyMiAtMTguMzQ0MTQsNDguNzIzNTEgLTE4LjgwMDA0LDc1Ljg3Mjk5IHoiCiAgICAgaWQ9InBhdGgyNDc1IgogICAgIHN0eWxlPSJmaWxsOiNlOWM2YWY7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDM5MS44ODU0MywxODYuNDc1MDMgYyA0LjkwOTYsMjkuOTk0MjkgNS4wOTQ0NSw1OS4yMTU2MyAxLjU2ODQsODkuOTUwMDUgMzkuMzU0NTQsLTAuODExNDQgODUuMDQ1MzgsLTkuNDY4ODUgMTIyLjIzMjM5LC0xNS4wOTM5NiAyLjkyNTE0LC0zNi40ODk0NyAxLjY5NTYzLC01OC43Njc3OCAtNS45MzY2MSwtNzUuNzUzNCAtMzguNTIwMDcsLTcuMjQ0OTkgLTc5LjI3MjI5LC00Ljc1NjkyIC0xMTcuODY0MTgsMC44OTczMSB6IgogICAgIGlkPSJwYXRoMjQ5NSIKICAgICBzdHlsZT0iZmlsbDojZGJlMmUzO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA1MTMuNTE3NzIsMTg1LjI0MDg4IGMgMTEuNDI5MiwzNi4yMTc5MSA0Ljk5MDI0LDUxLjU4NzY1IDUuNTE1NTMsNzYuMjMyNTUgbCA4Ni4yMjQwMiwtMTQuMjIwNDEgMC43MzY3NCwtMTUuMjg4NjUgYyAtMTAuMDY3MjUsLTUuMTg2MjEgLTE4LjMyODM4LC0xMi4yMTM4NSAtMjEuMzcyMzcsLTI0Ljk5MDc3IC0yMi4zNjgyMiwtOS4zMTIxNSAtNDQuODczNDQsLTE1LjcyNzU1IC03MS4xMDM5MiwtMjEuNzMyNzIgeiIKICAgICBpZD0icGF0aDI1MDUiCiAgICAgc3R5bGU9ImZpbGw6I2NkZGU4NztmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZSIgLz4KICA8cGF0aAogICAgIGQ9Im0gNDk3Ljk0Nzk4LDExMi4wNTU3MiAyLjU1OTU0LDkuMTc3MTMgYyAzNi42NDg2NSwtMS43NDI0MSA3OS4yMDk1MSwxLjYwMDM0IDEwOC40MTgxMiw1Ljg3NDYxIC0wLjEzOTIyLC03LjUyMDggLTEuMzE0ODMsLTEzLjQxNDEzIC02LjA4NjQ3LC0yMy40OTA3OCAtMjAuMDIxMzcsOS41Nzk5OSAtNTcuMzA1OTQsOS4zNjY3NiAtMTA0Ljg5MTE5LDguNDM5MDQgeiIKICAgICBpZD0icGF0aDI1MTEiCiAgICAgc3R5bGU9ImZpbGw6I2VlZmZhYTtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZSIgLz4KICA8cGF0aAogICAgIGQ9Im0gNjA2LjAyNTQ4LDEwMi4yNDY1MSBjIDcuNTI5ODUsMTEuOTU4OTggNi45NzA0OSwzMi43MTQwMSA0LjExMjUsNDUuOTEyNzggMTUuMzczNiw1LjM2MDUxIDI2LjMzNTEzLDYuMDU0NjggMjYuNzYyNDksMjMuNTkyOTEgLTIuMDgxNSwxOC41OTQyNyAtMTEuNTA1NjQsNDcuNjE4MzIgLTI4LjczNTY5LDYwLjM0OTcyIGwgMC43NDgxNCwxNS4zNTY3OSA1LjUxMDA1LDIuMDY4OTUgYyAyMS40NzAxLC0zMS4xMzA4NyA0Ni45NjUzNCwtOTQuNTgzMDUgNjIuMDU5NTEsLTEzOC4wNzc3NiAtMjkuODQ5NDMsLTYuMTg0NTIgLTM4LjMzMTY3LC0xMi42ODY5OCAtNTQuODk0MDUsLTIzLjMzMzU1IC03LjY0NjQ2LDcuODk2NjUgLTUuNDU5NTgsNi4yMzg5NCAtMTUuNTYyOTUsMTQuMTMwMTYgeiIKICAgICBpZD0icGF0aDI1MTciCiAgICAgc3R5bGU9ImZpbGw6I2FhZmZlZTtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZSIgLz4KICA8cGF0aAogICAgIGQ9Im0gNjEwLjQwOTg0LDE1MS40MjE4MyBjIC01LjA5MDkxLDE4LjY3MTMzIC0xMy42OTYyNSwzNi4zNTY0OCAtMjEuOTExODIsNTMuOTI1NzggLTEuODgzMDksNy41NjA5NyA1LjQ2MjUzLDEzLjY2MDQ1IDEwLjY1MjAxLDE3Ljk3NTI2IDMuMjEyNTUsMS44MjQyIDcuOTUyNDEsOC4wNzUxOSAxMS4yMzA5MSwzLjA2ODI0IDEyLjg2OTMsLTE0LjYzMjI1IDE4Ljk2MTk3LC0zNC4wNDUxNiAyMi42OTM0MSwtNTIuNzk2OSAyLjU5NTI5LC0xMy4wMjY0OSAtMTEuNTYyNjEsLTIxLjUyNzgyIC0yMi42NjQ1MSwtMjIuMTcyMzggeiIKICAgICBpZD0icGF0aDI1MjUiCiAgICAgc3R5bGU9ImZpbGw6I2ZmZDVkNTtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZSIgLz4KICA8cGF0aAogICAgIGQ9Im0gNjQ4LjQ1ODczLDI4OS42MTE4NCAzMS40NjAzNyw0OC42NDIzIGMgMjAuMjgzNTksLTAuNDAzNzIgMjMuMzM0NzUsLTIuMjg0MjUgMzEuNTg5OTQsLTEwLjM3NjUyIC01LjM1ODcxLC0xNS4wMzk3MyAtMTAuNzMzMzMsLTM1LjQ1MDI0IC0xNS4xODgsLTUwLjc1Nzg2IC0xNC40MjIsOS42ODM0NyAtMjQuNTAzOTEsMTMuMzQ1OTcgLTQ3Ljg2MjMxLDEyLjQ5MjA4IHoiCiAgICAgaWQ9InBhdGgyNDYxIgogICAgIHN0eWxlPSJmaWxsOiNlOWRkYWY7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDI0NC41NDkzOSwzNzkuNTgwNzIgMTUuOTMyNTMsMC4wODA3IGMgNC43NjIyOCwtMjAuMDMyNSAxNC42MTE3OSwtNDYuNzYyMzcgMTkuNzc4MTgsLTY2LjQ3Mzc5IGwgLTQzLjMyNTUxLC0zLjk3NTg5IGMgMTEuNjE2NjUsMTkuNDczMyAxNC4xNTAzOCw0Ni44NDE2OCA3LjYxNDgsNzAuMzY5MDEgeiIKICAgICBpZD0icGF0aDI0NjkiCiAgICAgc3R5bGU9ImZpbGw6I2U5ZGRhZjtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZSIgLz4KICA8cGF0aAogICAgIGQ9Im0gMzc5LjU2Nzc3LDEzNy4zMTYwMyBjIDUuNDkwMTIsMTcuMzA2MDYgNy41MDIzMSwyOC4xNTQzIDEwLjk1NDgxLDQ2LjAzOTQ2IDc0LjY5MTcxLC0xMi4xNTgzNSAxMjcuMjExMzMsLTQuOTkxODggMTk1LjM2MzQ2LDIwLjg5NTUyIDcuODA4MjEsLTE1LjA5MTUyIDIyLjc0NTEsLTQ1Ljk2MTMgMjIuODY3MTcsLTcyLjQ1MzEgLTY0Ljg1NzA1LC0xMy43MjYxNSAtMTgyLjU1ODQxLC02LjA2ODExIC0yMjkuMTg1NDQsNS41MTgxMiB6IgogICAgIGlkPSJwYXRoMjQ0MyIKICAgICBzdHlsZT0iZmlsbDojZmZlZWFhO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA0MjYuMDE3NjQsNzAuMTcxMzMgYyAxMi4wNTYyOCwxNS40NTg1MiAxNS42MjEwMiwzNC45MjIzIDIwLjE1NDQ3LDUzLjU0OTQ5IDE2LjcyNDE4LDAuMDgyNCAzMi45ODc1NCwtMC41NDA5MiA1MS4wMzExNywtMS41NzM1OCAtMC44OTQ0LC00LjU0Mzc2IC0wLjY2MzY0LC02LjA1MDMgLTQuNjc0NTIsLTEwLjYzNTgyIC0xNC42MzM4MSwtMS4wNzM2OSAtMjAuNzg2NTksLTYuOTI5NDkgLTIzLjQwMDE0LC0xNy42NjUyOCAtMS4xMDU0OSwtMTEuMjI5NzYgMC40NjI5MiwtMTMuMTUzMTUgNi43NDE3NSwtMTcuNTM4MzMgLTEuMjYwMDgsLTMuMDQ3NSAtMS44NjkxMywtNC4zMDUwNyAtNS4yNjgxNywtOC4xOTU5NCAtMTQuOTA5MDksLTAuNjQ1NzQgLTI5LjcxNjc1LDEuMjQ5MSAtNDQuNTg0NTYsMi4wNTk0NiB6IgogICAgIGlkPSJwYXRoMjUyMyIKICAgICBzdHlsZT0iZmlsbDojZmZkNWQ1O2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA0ODMuMzIyMjEsNzcuMDg5MzUgYyAtOC4yNzUwNCwxLjk0MTMzIC0xMi4xNDQ5Niw2LjIyMDc2IC0xMS41NzgyNiwxMy4wNTQ0OSAtMC40MDAzLDkuMTA2MjcgNy4wNDc5MSwxOC41OTQ3NyAxNi4yNjc0NiwxOC4yMDY4MyAyOS41NTkzOSwxLjAxMjMzIDU5LjM2MTIsMi42MDgxIDg4LjgwNTM2LC0wLjk1NTIxIDIzLjY2ODU4LC00LjA0MDggMzAuMzMyMTcsLTguMTUyMDYgNDIuMDUzMjMsLTIxLjA2NCAtNC42NTc2MSwtMy43NzUxMyAtNy42Njg1MSwtMy4zMTk2OSAtMTMuOTY0OTUsLTExLjQ4OTg1IC0xNi4yMDk2NywwLjEyMTIzIC05Ny4yMjM4NiwtMC42NTE2NyAtMTIxLjU4Mjg0LDIuMjQ3NzQgeiIKICAgICBpZD0icGF0aDI0OTkiCiAgICAgc3R5bGU9ImZpbGw6I2RiZTJlMztmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZSIgLz4KICA8cGF0aAogICAgIGQ9Im0gMzQwLjEwOTg0LDYyLjY0NTQ1OCBjIDE4LjA3ODgsMjQuMjAyOTQyIDI0Ljg3NTM3LDM5Ljc3NzQzMiAzNy40NzE1NSw3MS4xMDY0MTIgMjMuMDEyOTcsLTQuNTQ0MTkgNDQuMjEyNDYsLTcuMzc2MzQgNjUuMzY5OTksLTguOTk2OTMgLTQuMzI4MywtMjkuNDMzNTIgLTEwLjMwNjM3LC00MS4wOTcxNyAtMjAuMzM4MjksLTU1Ljc0MTQzIC0yNi41MTQ1OSwtMC44NDUzMyAtNTYuMDkwNzgsLTQuMzQxMTA1IC04Mi41MDMyNSwtNi4zNjgwNTIgeiIKICAgICBpZD0icGF0aDI1MTUiCiAgICAgc3R5bGU9ImZpbGw6I2FhZmZlZTtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZSIgLz4KICA8cGF0aAogICAgIGQ9Im0gMjI1LjkzMjI0LDMzLjcyOTk4NCBjIC01LjQ0OTQyLC0xLjIwNjkzNyAtNS4zNzIwOCwtMC41MzA2MTEgLTE0LjM2NTM4LDEuMjUyODc0IDIxLjY5NTc5LDE3Ljc4NTk4IDI3LjEwMjM4LDUzLjEzMzYxMiA0Ni4yNDQ5OCw2Ny40NTI5NTIgMTYuMDk4NjMsLTYuMjI4MTUgMjcuMzI4MTMsLTcuNDY3MjMgNDEuMDYzNDgsLTMuMDU3MDUgMzAuOTY1MTMsOS45NTY2NyAzOS44MzYxLDM4LjE4MzI4IDM4LjcyOTQsNjQuNzIyNTIgMC42NDk4NywzNy4zMTIxOCAtMzMuNTc2NDMsMTA5LjI3MTI0IC0zNi44NDc5NywxMTcuODAyNjggMzAuMTEzNjgsLTAuMjk0NTIgNjEuNjY1MDEsLTIuODYxNzcgODkuMjQ1NzQsLTUuNTk2ODUgNC40MjkwMiwtMjEuOTYwMzggMi4zNDM1NCwtNDUuMzg2MTMgMC43NjY0OSwtNjguMDkwMTUgQyAzODYuNDExNjYsMTU2Ljk2Mjk3IDM2Ny40NjU2NCwxMDIuMzcyMjggMzM0LjAzNjAzLDYxLjk4MzAwMSAzMjIuMTIxMjUsNTguOTQ0NDExIDMxMy4wODYzLDU3LjAzODA0IDI5OS44ODM2NSw1Mi41MDc3NjggMjc3LjIwODk1LDQ0LjAwNzIyNyAyNTEuODU0NzcsMzIuNjI4NjQxIDIyNS45MzIyNCwzMy43Mjk5ODQgeiIKICAgICBpZD0icGF0aDI0NDUiCiAgICAgc3R5bGU9ImZpbGw6I2ZmYjM4MDtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZSIgLz4KICA8ZwogICAgIHRyYW5zZm9ybT0idHJhbnNsYXRlKDY0NS4wMTQ1MywtNDguNDE3MTU3KSIKICAgICBpZD0iZzMxODciPgogICAgPHBhdGgKICAgICAgIGQ9Im0gLTU2Mi42MTg4NCw5MS4wNTQ5NTIgYyA1LjYxNjM5LC04LjMyODQ5IDE0LjAzMTcyLC0xNC4xOTkwODkgMjQuMDkzNSwtMTUuMDA0MDU0IDUuNTM5NjgsLTAuNDQzMTg3IDE1LjQ1MTA1LC0wLjY1Mzk0NCAyMy4wNTM5MSwyLjUyNjkzMyAxMC40ODk3Niw0LjM4ODY5NSAxMS44MDgxNiwxMi40MTUyOTggMjMuOTg0MjUsMTEuMzI5NjkzIDIzLjMyMzksLTUuNTg3MzUxIDUxLjM0OTg1LC0xMS43NzQ4OSA3NS4zNTM2OCwtMTMuNDMxNDQ5IDIwLjMwMjQ1LC0xLjQwMTExOCA0MC41MDgwOSw2LjY3NTE2MSA1OS4yMjE0NCwxNC4xMjgxMjYgNDUuNDIzODksMTguMDkwOTY5IDk1Ljg1NDEyLDIwLjg3NjQwOSAxNDQuMzY4NTEsMjEuNjY1ODg5IDg2LjU2MzE4LDEuNDA4NjUgMTcwLjMyNTIxOSwtMTYuODE3NjcyIDI1Ni40ODIxOTIsLTcuNTcxNDMgMjcuNjg0NDA5LDIuOTcxMDQgMzcuMTQxNjI3LDE3LjA1NzEyIDQ2LjA1MDk4NSwzNS45MTc1NyIKICAgICAgIGlkPSJwYXRoMjYzOCIKICAgICAgIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlOiMwMDAwMDA7c3Ryb2tlLXdpZHRoOjEyLjAwMDAwMDk1O3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLW9wYWNpdHk6MC45ODMyNjM2MjtzdHJva2UtZGFzaGFycmF5Om5vbmUiIC8+CiAgICA8cGF0aAogICAgICAgZD0ibSA5NC41Njk3MDcsMTUxLjE1MTU3IGMgMCwwLjIxNDU0IDAsMC40MjkwOSAwLDAgeiIKICAgICAgIGlkPSJwYXRoMzQxMSIKICAgICAgIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlOiMwMDAwMDA7c3Ryb2tlLXdpZHRoOjEyLjAwMDAwMDk1O3N0cm9rZS1saW5lY2FwOmJ1dHQ7c3Ryb2tlLWxpbmVqb2luOm1pdGVyO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLW9wYWNpdHk6MC45ODMyNjM2MjtzdHJva2UtZGFzaGFycmF5Om5vbmUiIC8+CiAgICA8cGF0aAogICAgICAgZD0ibSA4Ny43NDYzODcsMTM2Ljc0NSBjIDguMDU4MzU5LDIwLjQxNjIyIDEyLjk2NjkxMywzNy4xMDE4NSAxMy45MTk5OTMsNTkuMDY1MTMgMS44NjM3OSw0Mi45NDk5NiAtMTAuMDQ1OTI3LDg2LjY2NDA2IC0xMC44MjE2NjMsMTI4Ljg5ODEyIC0zLjE4MDg5LDguMjkzOTkgLTkuNTE4OTgsMjQuMTgyNDggLTYuNjU5NjQsMzMuNjg5NTMgMi42Nzc5Miw4LjkwMzg0IDcuNTI4MTcsMTcuNjY2NiAxMy45NjA3MSwzNC42MTQ0OCAwLjA4NDUsLTIyLjE3MzA4IDYuMzM1MjMzLC0yMy45NjI1OSA1LjQwMDEyMywtMzUuMjI1NzcgLTAuODY1NSwtMTAuNDI0ODIgLTguNDEyMDAzLC0yMi42NjEzMyAtMTIuMTkyNDkzLC0zMy4wMTMyIgogICAgICAgaWQ9InBhdGgzNDEzIgogICAgICAgc3R5bGU9ImZpbGw6bm9uZTtzdHJva2U6IzAwMDAwMDtzdHJva2Utd2lkdGg6MTIuMDAwMDAwOTU7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW1pdGVybGltaXQ6NDtzdHJva2Utb3BhY2l0eTowLjk4MzI2MzYyO3N0cm9rZS1kYXNoYXJyYXk6bm9uZSIgLz4KICAgIDxwYXRoCiAgICAgICBkPSJtIDQyLjg0MzU3NywxMDMuOTAwNjEgYyAxNi4zMzIwOCwxNy40NTc3NSAzMi44NTA4MywzNi41NzY0MSAzNi42NTM2OCw2MS40MTA2NCAxMi45MjI1Miw0My45NzAxMiAxMC4wMjE0NSw5Mi44NTA0NSAtOS40Nzk3NywxMzQuNTE3ODEgLTUuMjM1MjIsMTEuMTI0MjIgLTMuODU0NDEsNi40OTY3NCAtMTIuOTI2MTQsMjQuMTI0NjcgNC43MDc5LDE4LjI1NTMxIDEwLjY1NTE4LDQwLjEzMzQ0IDE1LjEwNzM3LDUwLjQ5NDA0IDYuODkwMjgsMjIuNTMwODQgMi45MTY0NiwzOS45OTY3MSA1LjEwMDQ4LDYzLjExNTQ3IDEuMDQyOTEsMTEuMDM5NjIgNy44MzcxNCwyNC45NjM2NSA5Ljg3NDQ5LDM1LjQ0MTA4IGwgLTcuNDE1OTYsMjkuMDIxOTcgLTM5LjUxNDg2LDAuNDIyNDYgMTUuNTM5NjIsLTI3LjgzMzkxIGMgLTQuNTA0NDIsLTUuNDM2MjEgLTguODI1NjEsLTkuNTY2ODggLTIuNTE1NDQsLTI0LjUwNTc2IC01LjM0MzIzLC0yNC4zMjk4NSAtMTYuNTc3LC01MC44MTE2MyAtMzAuMDk5NzksLTcxLjE2MTY3IC0xNy44NTcyNTA0LC0yNi44NzI4NCAtMzQuMDY4NzIsLTU1LjIxMDYgLTU4LjM4MTk1LC03Ni41MTIzOSAtMjUuNzQ2MzMsLTEuODIwNjcgLTQ0LjkyODAxLDE3Ljg1NDcgLTY4Ljg5ODg4NywyMy4xNzg5NiAtMjQuNjAxMTcsNi42ODQ3NyAtNDQuNDAyMjIsMjUuMzA0NDQgLTcwLjEwODc3LDI4LjkyMjA2IC0xNi44MzAwNCwtMTMuODM0OTQgLTM4LjM1ODY2LC0yMS41MDM4NyAtNTkuMTE1OCwtMTEuOTE0MzEgLTIxLjE4NzU5LDguNTkyNTkgLTQ0LjE2MTIxLDUuNjIxMTEgLTY2LjM4MDIxLDguMDUyNTkgLTIxLjAyMDQxLC0wLjIxNTQ0IC00MS4yMzIzOSw4LjE0OTM0IC02MC42NzUxNiwxNS4xOTM2IC02LjU5MjU0LDE5LjYyNDQyIC0xNS4yNjEyOCwzOS41MjY3NSAtMTguMTE1OTcsNjAuMDI2MTEgLTIuNzk0NTgsMjAuMDY3NzcgLTMuNDA5NDksMTAuNzM1MjggLTAuMDg0NSwzNC41Nzg1NCAtMTQuMTIwNSwxMS41MDc1NSAtMTQuOTU5NTYsMjAuMzczNjUgLTE3LjA2NzM0LDMwLjEyOTIzIGwgMjAuOTIzNTQsLTEuMzAzNyBjIDEuNjcyMTUsLTEyLjYxMjI0IC0wLjM4MDE5LC0xNC4wODczNCA4LjE1Nzc3LC0yNS40NzAxOSAtMi41Mzk5NSwtMTcuMzcwMzIgLTMuNzk4OCwtMjcuOTI5MjMgMy4wMTk4NCwtNDcuMjY4NDIgNS45MDI4NCwtMTYuNzQxOCA3LjI4NDQxLC0zNC41OTUgNy44NDA0MiwtNTIuNDAxNDciCiAgICAgICBpZD0icGF0aDM0MTYiCiAgICAgICBzdHlsZT0iZmlsbDpub25lO3N0cm9rZTojMDAwMDAwO3N0cm9rZS13aWR0aDoxMi4wMDAwMDA5NTtzdHJva2UtbGluZWNhcDpidXR0O3N0cm9rZS1saW5lam9pbjptaXRlcjtzdHJva2UtbWl0ZXJsaW1pdDo0O3N0cm9rZS1vcGFjaXR5OjAuOTgzMjYzNjI7c3Ryb2tlLWRhc2hhcnJheTpub25lIiAvPgogICAgPHBhdGgKICAgICAgIGQ9Im0gLTU2NC4zNzkwMiw5MS4yOTQ3NTggLTE1LjIyNDU0LC0xLjMxNTY1OSA3Ljg5OTU0LDExLjg5NTU4MSBjIC01LjY2ODM4LDUuOTYyNjggLTEwLjU2Mjg3LDExLjQ2NTE0IC0xMS45ODc3MywyMy4yMzExMyAtMi4zNDE4MiwxOS4zMzcwNyAtMS43MDY1NywzMi4xOTU2IC0xOC4xNjc4NSw0Ny43MDg4NyAtNy4yNjIxLDYuODQzOTcgLTEyLjQ4OTYsMTEuMTg4MzMgLTE2LjE1NDkzLDE3LjE4ODgzIDQuNzcyMDQsOC43MzExNSA1Ljk3NzQyLDEwLjgyNzMyIDExLjE5MDkyLDE3LjcwODIgNi45Njg0LDkuMTk3MDQgOC43MjQwNywxMC44NTg1NyAxMy40NjEyMSwxMi41MjUzNCAxNC40MjYzOSw1LjA3NTg5IDExLjI0NTY3LDIuNDExNzYgMjcuNzE5NzEsMi40OTQwNiAzNi40NTExNCwxLjQwNDk0IDYxLjUzMzk2LDguNjI3ODUgMTAyLjYyNDIzLDMxLjE2NzM1IDE2LjA2Mzg3LDExLjI2NjM0IDEwLjkwMjIzLDM0LjI2OTA0IDE5LjA3NDkxLDUwLjM0NTU2IDguNTUzMTIsMTYuODI0OSAxMi44ODM5OSw0My4xNzY3IDE5LjQ0NTEsNDYuNjgyMDUgMTMuMDg1ODQsNi45OTEyNiAxMy42MTMxMSw5LjM3NDM2IDE5Ljc5MTcxLDM0LjM3Njc2IDMuODA0NzgsMTUuMzk2NTIgMy42MTM1NSwyNi4wOTc2NiAtMS44ODA0Miw0Mi44MjM3MSAtNC4yNTc0OCwxMi45NjE2MyAtMS42NTk1MiwyMy41NTQzOSAtNy44MTM5NSwzNy42Nzk3OSAtNC4wNjU0NSw5LjMzMDgyIC04LjQ2NTA1LDExLjAxMTU3IC0yMC45NDQ4MSwyNy42ODI1OSBsIDM3Ljc2ODgsMS4xNTIwMSAxLjY0MjM0LC01LjcwMjcyIgogICAgICAgaWQ9InBhdGgzNDIzIgogICAgICAgc3R5bGU9ImZpbGw6bm9uZTtzdHJva2U6IzAwMDAwMDtzdHJva2Utd2lkdGg6MTIuMDAwMDAwOTU7c3Ryb2tlLWxpbmVjYXA6YnV0dDtzdHJva2UtbGluZWpvaW46bWl0ZXI7c3Ryb2tlLW1pdGVybGltaXQ6NDtzdHJva2Utb3BhY2l0eTowLjk4MzI2MzYyO3N0cm9rZS1kYXNoYXJyYXk6bm9uZSIgLz4KICAgIDxwYXRoCiAgICAgICBkPSJtIC0xLjkwODQyMzQsMzQyLjA4NjMzIGMgLTAuNjUyNTUsMTUuNDI0OTQgMC4zNTcyNywzMC45MDY1IDEuNjY4OTgwMDEsNDYuMjc0MjcgMS4xOTY2NCwxMS4xNjM1MSAzLjg1NzI4OTk5LDIyLjQwOTA4IDIuNTcyNDk5OTksMzMuNjc0MTMgLTIuNTk2MjI5OTksMTAuMjc2MjYgLTguNjk1MDEsMTkuMzY3MTIgLTEwLjAzNTQyLDMwLjA0NDI2IC0xLjU2MTYzLDcuODk2NDIgLTMuMTgyMDc5NiwxNi4xMDE3NyAtOC4zMTczNjk2LDIyLjQ5NjY3IC02LjMzMzM1LDkuNTYzMzMgLTEzLjExMzIzLDE4LjgwNzk1IC0xOS40MTY0NSwyOC4zOTE4MSAxMy40NDQ5MiwtMC4xODA1OSAyNi44ODk4NDk2LC0wLjM2MTE5IDQwLjMzNDc3OTYsLTAuNTQxNzggMy4xNjAwNiwtOC43NDc2OCAzLjk2MTQzLC0xOS4yNjMyNiAxMS43OTU0NzA0LC0yNS4yOTI3MiA1LjU5ODE0LC0zLjEzNTQxIDcuOTA3NjcsLTkuMDIyMDggOC4wNTI1NSwtMTUuMjkwMTYgMC40MjYyMiwtNy44MDIyMyAxLjg0NzY4LC0xNS41ODMyOCA1LjY0MjYzLC0yMi40NjcxNyA0LjI2Mzc0LC04LjczODU3IDYuNjIxMzUsLTE4LjI2NDcxIDkuMzAyMzcsLTI3LjU5MTk4IgogICAgICAgaWQ9InBhdGgzNDM5IgogICAgICAgc3R5bGU9ImZpbGw6bm9uZTtzdHJva2U6IzAwMDAwMDtzdHJva2Utd2lkdGg6MTIuMDAwMDAwOTU7c3Ryb2tlLWxpbmVjYXA6cm91bmQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLW9wYWNpdHk6MC45ODMyNjM2MjtzdHJva2UtZGFzaGFycmF5Om5vbmUiIC8+CiAgPC9nPgogIDxwYXRoCiAgICAgZD0ibSAyMzEuNDgzOTgsMzA1Ljc5NjkgYyAtNS40NjkyNywtMzguOTgyNjkgLTEzLjk0MTgyLC04My41OTc3NSAtMTEuMDA4NDYsLTEyMy4xOTc1OSAxLjk4ODI5LC0yNi44NDE1OCA4Ljk0NzMzLC01NC4zMDIwNyAyNy45OTY3NiwtNzIuNjY2MDIgMTEuNDYyNDQsLTExLjA0OTk3IDI5LjgxNzcxLC0xMy42MyA0NS41NDM5MywtMTAuMjU4MjYgMTcuNDc0NSwyLjU1OTQgMzIuMTgyMjIsMTUuNzk2OTYgMzcuNDI5MDUsMzIuNTI3MTggNS4yMzgzOSwxNS42Mjk2NCA2LjE1NjcsMzIuNTcxNDIgNC4zNjU5Myw0OC44NjU0NSAtOC41NDE5LDQyLjk4MTggLTMzLjUwNjU0LDkxLjQxNDE3IC01Mi40Njc0NSwxMzAuNjMzOTMgbCAtNTEuODU5NzYsLTUuOTA0NjkgeiIKICAgICBpZD0icGF0aDIzODkiCiAgICAgc3R5bGU9ImZpbGw6bm9uZTtzdHJva2U6IzAwMDAwMDtzdHJva2Utd2lkdGg6NDtzdHJva2UtbGluZWNhcDpyb3VuZDtzdHJva2UtbGluZWpvaW46cm91bmQ7c3Ryb2tlLW1pdGVybGltaXQ6NDtzdHJva2Utb3BhY2l0eToxO3N0cm9rZS1kYXNoYXJyYXk6bm9uZSIgLz4KICA8cGF0aAogICAgIGQ9Im0gODUuNTEyOTM1LDE3MC4wOTk4IGMgMC4zMzA1OCwtNi4xNjU3NiAzLjMxMjk2LC0xMS40NzM4MyA5Ljk3NTQxNiwtMTQuODk4OTcgMTguNjg3Njc5LC05LjYwNzI2IDM3LjAzOTMwOSwtMTQuMzY3NjQgNTcuODIzNjY5LC0xMy4yNDc0MSAzMS41MTgxNywxLjY5ODc3IDQ5LjQ1NjgxLDI4Ljk5NjY0IDY2LjM2NjEzLDUyLjQ5MjQ4IgogICAgIGlkPSJwYXRoMjM5MiIKICAgICBzdHlsZT0iZmlsbDpub25lO3N0cm9rZTojMDAwMDAwO3N0cm9rZS13aWR0aDo0O3N0cm9rZS1saW5lY2FwOnJvdW5kO3N0cm9rZS1saW5lam9pbjpyb3VuZDtzdHJva2UtbWl0ZXJsaW1pdDo0O3N0cm9rZS1vcGFjaXR5OjE7c3Ryb2tlLWRhc2hhcnJheTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSAxODIuMzE2MjMsNDEuMzk5MDM0IGMgMS45OTEwMSwzNC4yNTI5NDYgLTYuMzg3NjksNjguNTg1OTQ2IC0xOC4wMTE1OSwxMDAuNTM3MjQ2IgogICAgIGlkPSJwYXRoMjM5NiIKICAgICBzdHlsZT0iZmlsbDpub25lO3N0cm9rZTojMDAwMDAwO3N0cm9rZS13aWR0aDo0O3N0cm9rZS1saW5lY2FwOnJvdW5kO3N0cm9rZS1saW5lam9pbjpyb3VuZDtzdHJva2UtbWl0ZXJsaW1pdDo0O3N0cm9rZS1vcGFjaXR5OjE7c3Ryb2tlLWRhc2hhcnJheTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSAyMDAuODY2MzgsMjkuMDk5OTc0IGMgMzQuMjIyMjMsMjMuNjIzMDUgMjkuNDY2OTksNTAuMTkyNjY2IDU2LjA1NTcyLDc0LjQ1MDk4NiIKICAgICBpZD0icGF0aDIzOTgiCiAgICAgc3R5bGU9ImZpbGw6bm9uZTtzdHJva2U6IzAwMDAwMDtzdHJva2Utd2lkdGg6NDtzdHJva2UtbGluZWNhcDpyb3VuZDtzdHJva2UtbGluZWpvaW46cm91bmQ7c3Ryb2tlLW1pdGVybGltaXQ6NDtzdHJva2Utb3BhY2l0eToxO3N0cm9rZS1kYXNoYXJyYXk6bm9uZSIgLz4KICA8cGF0aAogICAgIGQ9Im0gMjQyLjE3MTc0LDM4MC45ODkxNCBjIDAuMzEwNTQsMC4yMzI5IDQuNzAyMTQsMC4zMjc0OCA2LjIyMjE4LDAuMzI3NDggMi4wNzQwNiwwIDQuMTQ4MTEsMCA2LjIyMjE3LDAgMS45OTI4OSwwIDQuMzYzNDUsLTAuNjU0OTcgNi41NDk2NiwtMC42NTQ5NyAxLjg1NTc0LDAgMy43MTE0NywwIDUuNTY3MjEsMCAwLjMyNzQ4LDAgMC42NTQ5NiwwIDAuOTgyNDUsMCIKICAgICBpZD0icGF0aDI0MDAiCiAgICAgc3R5bGU9ImZpbGw6bm9uZTtzdHJva2U6IzAwMDAwMDtzdHJva2Utd2lkdGg6NDtzdHJva2UtbGluZWNhcDpyb3VuZDtzdHJva2UtbGluZWpvaW46cm91bmQ7c3Ryb2tlLW1pdGVybGltaXQ6NDtzdHJva2Utb3BhY2l0eToxO3N0cm9rZS1kYXNoYXJyYXk6bm9uZSIgLz4KICA8cGF0aAogICAgIGQ9Im0gMjk2LjY0NjI1LDI4NC40NzA3OSBjIDEwMi4zNTk5OSwtMy4xNTE1IDIwOS4yMTQ5NSwtMTguODc3MDEgMzEwLjM0MzA0LC0zNS41MDk5NCAtMC42OTI5NiwtNS40MzcyOCAwLjkwNjQ2LC0xMy4xNjY5MyAwLjIxMzUsLTE4LjYwNDIxIC05Ljg0ODg4LC01LjIyMjU3IC0yMC42NjU1NSwtMTMuOTQ1MDggLTIwLjc2OTY1LC0yMy45ODM5OCBDIDUxNS4wMzA3MSwxNzUuMDUxNDkgNDY1LjA3NzIzLDE3NS45NjM3MyAzODkuNTkyODgsMTg1LjE1OTYzIDM4My4wMDQwNCwxMzkuMzIzMTQgMzYzLjI5ODY1LDk1LjcyMzc4IDMzNC43MzcwMyw1OS40MTA1OTIiCiAgICAgaWQ9InBhdGgyNDAyIgogICAgIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlOiMwMDAwMDA7c3Ryb2tlLXdpZHRoOjQ7c3Ryb2tlLWxpbmVjYXA6cm91bmQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLW9wYWNpdHk6MTtzdHJva2UtZGFzaGFycmF5Om5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDM3OC42MTk3MywxMzUuNDk4OTkgYyAzNy40MzQ4OCwtOS40NDc3MSA3Ni4zMTY4LC0xMC4yODg5NiAxMTQuNzEyMDgsLTExLjEyMzQ1IDM4LjQ0NjU4LC00LjM0NjgxIDc5LjIyNDc2LC0wLjgyMzY0IDExNy40NzMyOCw1LjIyODc2IC0xLjQ5MjU2LDEzLjQ1ODYxIC0wLjM2NDk1LDguNTUwMzYgLTEuNzE3MDYsMjAuMTAxMjUgMTQuOTMwMTIsMS4yMjAzNSAyNy4zMjY1OSwxMC42MDE4NCAyNS43ODEyMSwyMi4xNzU0MiAtMi4xNjEyOSwxNi4xODYyMSAtMTIuMDM4MzYsNDYuMDE5NjQgLTI2LjAyOTA0LDU4LjI2MDU4IgogICAgIGlkPSJwYXRoMjQwNCIKICAgICBzdHlsZT0iZmlsbDpub25lO3N0cm9rZTojMDAwMDAwO3N0cm9rZS13aWR0aDo0O3N0cm9rZS1saW5lY2FwOnJvdW5kO3N0cm9rZS1saW5lam9pbjpyb3VuZDtzdHJva2UtbWl0ZXJsaW1pdDo0O3N0cm9rZS1vcGFjaXR5OjE7c3Ryb2tlLWRhc2hhcnJheTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA2MTMuNTgwMzMsMjUzLjU1Mjg0IGMgMjkuOTM3NTUsLTQzLjQ3NjYxIDQ3LjIyMjksLTkzLjcwMzc4IDY1LjAyODgxLC0xNDIuOTU1MjkgMTkuNTgwMDYsMTAuMTUwMTEgMzQuMDUxODUsMjQuNzgwMDcgMzUuNTA4NDQsNDYuNjc1MzEgMS44NDY1MywyNy43NTY3MSAtMTQuMDA0MTYsNTMuNTM3NiAtMTguNTQ1NjcsODAuNjU2MTEgLTEuNDg0OTQsOC44NjY5NiAxLjA2NjI1LDI2LjI1MjI3IDguMDY2MjEsMzIuOTgwNDUiCiAgICAgaWQ9InBhdGgyNDA2IgogICAgIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlOiMwMDAwMDA7c3Ryb2tlLXdpZHRoOjQ7c3Ryb2tlLWxpbmVjYXA6cm91bmQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLW9wYWNpdHk6MTtzdHJva2UtZGFzaGFycmF5Om5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDYzNi4yMzYzOCwyODEuMTI2MTUgYyAxMy45MDgyMSwtMjguOTY2NTUgNDQuNTAxNCwtNTcuNzM5NDkgNTYuMjkxNzcsLTg2LjgxMTk2IDExLjI4MjczLC0yNy44MjA3NiA0LjEyMzA0LC01My4yNTM0IC0xNi41MDc0MywtNzIuOTkwMDYiCiAgICAgaWQ9InBhdGgyNDA4IgogICAgIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlOiMwMDAwMDA7c3Ryb2tlLXdpZHRoOjQ7c3Ryb2tlLWxpbmVjYXA6cm91bmQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLW9wYWNpdHk6MTtzdHJva2UtZGFzaGFycmF5Om5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDYxOS40MzIwMiw4Ny4xMzQyNyBjIC01LjQ0NDc5LDUuNDIwNTYgLTguMzIyNDEsOS4yNzIyMiAtMTQuMzk1NzYsMTMuMzc4MjkgLTguMjMzOCw1LjU2NjcgLTE4LjI3OTcyLDYuMzc4NjEgLTI3LjY5MDc3LDguMDc5MzEgLTkuMDI4OTUsMS42MzE2NSAtMTguMDIwMjIsMi40OTc4IC0yNy4zODYyMywyLjQ5MjY2IC0xNC44NTgxMywtMC4wMDggLTI2Ljk1OTg5LC0wLjg5MjQ1IC00MC44MzYxNCwtMC45NzI2NiAtOS43NzM3OSwtMC4wNTY1IC0yMC42MjYyLDEuMjUzNzMgLTI5LjIxNzg5LC0yLjA2NTI3IC02LjI0NzIsLTIuNDEzMzEgLTkuOTI5MzQsLTExLjM1NTYyIC05LjgwNTQsLTE4Ljk0NzQ1IDAuMjAxNzEsLTEyLjM1NjE2IDEwLjUzNTA1LC0xMy4xNDE4MSAyMS4yNzI1NCwtMTQuNDY1NDUgMTUuMTg4NDUsLTEuODcyMzEgMjkuMTI5MzMsLTEuNTg0ODkgNDQuMzQ2ODMsLTEuNTgxMjEgMjQuNDEwNDcsMC4wMDYgNDUuNTk2NjgsLTAuMTY0MTcgNzAuNjEzNTEsMCAxMi4zMDUzMywxMi4xMzI1OCAyNS4wNTgwMywyMi43Nzk4NiA0MC45MzA3MiwyOC45NDUyMyAxMC43NDk0LDQuMTc1MzUgMTkuODc5NjMsMy43MDUwNCAzMC44MjY0MSw4LjY2MzU5IDUuMDc4OTgsLTE1LjM3MzM4IDkuMzE2MDcsLTI5Ljc1NTU5IDE1LjkyODgyLC00My42OTUzMzUiCiAgICAgaWQ9InBhdGgyNDEwIgogICAgIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlOiMwMDAwMDA7c3Ryb2tlLXdpZHRoOjQ7c3Ryb2tlLWxpbmVjYXA6cm91bmQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLW9wYWNpdHk6MTtzdHJva2UtZGFzaGFycmF5Om5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJNIDQ3OC43NDAzOSw3Ni43NDM5MSA0NzEuMTc1MzcsNjQuMTA3NzI5IgogICAgIGlkPSJwYXRoMjQxMiIKICAgICBzdHlsZT0iZmlsbDpub25lO3N0cm9rZTojMDAwMDAwO3N0cm9rZS13aWR0aDo0O3N0cm9rZS1saW5lY2FwOnJvdW5kO3N0cm9rZS1saW5lam9pbjpyb3VuZDtzdHJva2UtbWl0ZXJsaW1pdDo0O3N0cm9rZS1vcGFjaXR5OjE7c3Ryb2tlLWRhc2hhcnJheTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA0OTMuNDQwNjYsMTEwLjQ2NjA5IGMgNC42NTk2Miw2LjIxOTk1IDMuODk0NjYsNy45NjIzNCA1LjkwNDMzLDEzLjAyOTUiCiAgICAgaWQ9InBhdGgyNDE2IgogICAgIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlOiMwMDAwMDA7c3Ryb2tlLXdpZHRoOjQ7c3Ryb2tlLWxpbmVjYXA6cm91bmQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLW9wYWNpdHk6MTtzdHJva2UtZGFzaGFycmF5Om5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDU5OC4xODg2NCw1Ny4wNjMxMSBjIDQuMjMyNTcsOC45MTI2MSA1LjQzMDA5LDExLjAwMTE5IDkuNzc3OTQsMTcuNDUyNTEiCiAgICAgaWQ9InBhdGgyNDE4IgogICAgIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlOiMwMDAwMDA7c3Ryb2tlLXdpZHRoOjQ7c3Ryb2tlLWxpbmVjYXA6cm91bmQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLW9wYWNpdHk6MTtzdHJva2UtZGFzaGFycmF5Om5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDUxMC43NTA3MiwxODMuMTQ0MDEgYyA5LjIzNTc2LDIxLjk5NzA0IDEwLjg4NTAxLDQ4LjczMTM0IDYuNTQ5NjUsNzguMjY4NDIiCiAgICAgaWQ9InBhdGgyNDIwIgogICAgIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlOiMwMDAwMDA7c3Ryb2tlLXdpZHRoOjQ7c3Ryb2tlLWxpbmVjYXA6cm91bmQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLW9wYWNpdHk6MTtzdHJva2UtZGFzaGFycmF5Om5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDYwOC45OTU1NywxNTEuMDUwNjkgYyAtNC41ODAyNiwxOC45ODU3NiAtMTMuMjQ2MywzNy4xMTIzNCAtMjIuNjI5MjMsNTQuODgxNDgiCiAgICAgaWQ9InBhdGgyNDIyIgogICAgIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlOiMwMDAwMDA7c3Ryb2tlLXdpZHRoOjQ7c3Ryb2tlLWxpbmVjYXA6cm91bmQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLW9wYWNpdHk6MTtzdHJva2UtZGFzaGFycmF5Om5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDYwMy44MTA0LDEwMS40NDA0NyBjIDQuNzg4OTcsOC42MTEzMiA2LjEyMzM2LDE1LjY4MTk3IDcuMjA0NjEsMjcuODM2MDYiCiAgICAgaWQ9InBhdGgyNDI0IgogICAgIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlOiMwMDAwMDA7c3Ryb2tlLXdpZHRoOjQ7c3Ryb2tlLWxpbmVjYXA6cm91bmQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLW9wYWNpdHk6MTtzdHJva2UtZGFzaGFycmF5Om5vbmUiIC8+CiAgPGcKICAgICB0cmFuc2Zvcm09InRyYW5zbGF0ZSg4NTYuMjAyMTQsLTM1Ny43ODg0OCkiCiAgICAgaWQ9ImczMTk1Ij4KICAgIDxwYXRoCiAgICAgICBkPSJtIC0xNTIuOTM0NDksNjI2LjQ2MDY0IGMgLTE4LjU0NTM3LDE3LjQwNTYxIC0zNy4xODAyNSwyMS42MTk3NyAtNjUuMTY5MTEsMTguMDExNTUiCiAgICAgICBpZD0icGF0aDI0MjYiCiAgICAgICBzdHlsZT0iZmlsbDpub25lO3N0cm9rZTojMDAwMDAwO3N0cm9rZS13aWR0aDo0O3N0cm9rZS1saW5lY2FwOnJvdW5kO3N0cm9rZS1saW5lam9pbjpyb3VuZDtzdHJva2UtbWl0ZXJsaW1pdDo0O3N0cm9rZS1vcGFjaXR5OjE7c3Ryb2tlLWRhc2hhcnJheTpub25lIiAvPgogICAgPHBhdGgKICAgICAgIGQ9Im0gLTE0MS4zMjA1LDYwNi42ODI4NCBjIC0xOC4xNjA3Miw3LjMwMjc0IC00Ny4wMzcyNyw3LjY4NDIzIC01NC41NDAxMywtOS41MjI5NSAtOS4yNTIzNywtMjEuMjE5NTQgNy40MzcyOSwtNzUuMTM1OSAzMy45MTQ1MSwtODAuNzQzNiAxMS40Mzk1MSwtMi40MjI4MSAyMi44NDQ5MywxMS44Mzk5NCAyNC42Mzc5NSwyMi40MjQ2IDIuOTM3ODYsMTcuMzQyODYgMi40MTQxLDM1LjI2MzQxIDIuMzgzMTYsNTIuODk3MTEiCiAgICAgICBpZD0icGF0aDI0MjgiCiAgICAgICBzdHlsZT0iZmlsbDpub25lO3N0cm9rZTojMDAwMDAwO3N0cm9rZS13aWR0aDo0O3N0cm9rZS1saW5lY2FwOnJvdW5kO3N0cm9rZS1saW5lam9pbjpyb3VuZDtzdHJva2UtbWl0ZXJsaW1pdDo0O3N0cm9rZS1vcGFjaXR5OjE7c3Ryb2tlLWRhc2hhcnJheTpub25lIiAvPgogIDwvZz4KICA8cGF0aAogICAgIGQ9Im0gMzg5LjY3NDcsMTg0LjA0NTkyIGMgNS41NjcyMSwzNC4xNjczOCA2Ljc0MTQ5LDYyLjM4Mzg4IDEuODI5MjUsOTIuMjkzOTgiCiAgICAgaWQ9InBhdGgyNDc4IgogICAgIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlOiMwMDAwMDA7c3Ryb2tlLXdpZHRoOjQ7c3Ryb2tlLWxpbmVjYXA6cm91bmQ7c3Ryb2tlLWxpbmVqb2luOnJvdW5kO3N0cm9rZS1taXRlcmxpbWl0OjQ7c3Ryb2tlLW9wYWNpdHk6MTtzdHJva2UtZGFzaGFycmF5Om5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDY3Ni43ODQ1MywzNDAuMzM1OCBjIDE4LjAzNDM4LC0wLjk5MDYxIDI1LjY4ODE1LDAuOTc2NDQgMzguNjQyOTgsLTEzLjc1NDI4IgogICAgIGlkPSJwYXRoMjQ4NiIKICAgICBzdHlsZT0iZmlsbDpub25lO3N0cm9rZTojMDAwMDAwO3N0cm9rZS13aWR0aDo0O3N0cm9rZS1saW5lY2FwOnJvdW5kO3N0cm9rZS1saW5lam9pbjpyb3VuZDtzdHJva2UtbWl0ZXJsaW1pdDo0O3N0cm9rZS1vcGFjaXR5OjE7c3Ryb2tlLWRhc2hhcnJheTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA0MTguOTk0NjQsNjUuMTYwMzkgYyAyMC4wMDU2NCwxOS44MTE2OSAyMC4zMTI1OSwzNS45MDQ5MyAyNi4xOTg2Myw2MC45MTE4MiIKICAgICBpZD0icGF0aDI0ODgiCiAgICAgc3R5bGU9ImZpbGw6bm9uZTtzdHJva2U6IzAwMDAwMDtzdHJva2Utd2lkdGg6NDtzdHJva2UtbGluZWNhcDpyb3VuZDtzdHJva2UtbGluZWpvaW46cm91bmQ7c3Ryb2tlLW1pdGVybGltaXQ6NDtzdHJva2Utb3BhY2l0eToxO3N0cm9rZS1kYXNoYXJyYXk6bm9uZSIgLz4KICA8cGF0aAogICAgIGQ9Im0gNTYuNjExODQzLDE2Ni41NDgwMyBjIC0yLjQ2MzU4NywtMC44NjgwNSAtNS41NTQ3OSwtMi42MDcyMyAtNi44NjkzNSwtMy44NjQ4NCAtMi45MzIwOSwtMi44MDUxIC0xMS40NTQxNTgsLTE0LjI0MTY5IC0xMy40Mzc0MzIsLTE4LjAzMzAxIGwgLTEuNDUzNjI4LC0yLjc3ODc5IDEwLjgyNTczNiwtMTEuMTE1MTMgYyAxNS4yMTY2MjMsLTE1LjYyMzUgMTguMTY3MTM2LC0yMS43NTEzMiAyMC45NjE0NjMsLTQzLjUzNDI5IDIuMDQwMTQ2LC0xNS45MDM4NCAzLjI0MTkxNSwtMTkuMzQ1MzUgOS4zMzQ3MDUsLTI2LjczMTkxNSA0LjY1NTY1LC01LjY0NDI1NyA1LjEyNzc4NCwtNi41OTM1NTUgNC4yNDQwNTYsLTguNTMzMTQ2IC0wLjYyNzIyNywtMS4zNzY2MTkgLTAuNjY1Mjc4LC0yLjM4NTc1NCAtMC4xMDMwMjgsLTIuNzMzMjUgMC40OTAyMjQsLTAuMzAyOTcxIDAuODkxMzMyLC0xLjc3NjcyNyAwLjg5MTMzMiwtMy4yNzQ5OTIgMCwtMy4yNjUzNjggMC41NzYzMjksLTMuMzc1Nzc4IDMuNDYzNDIxLC0wLjY2MzQ5OSBsIDIuMTkzNDI0LDIuMDYwNjA3IDQuMDExODYxLC00LjM2OTQzNCBjIDUuMzQ3OTc4LC01LjgyNDcxMiAxMi4yMzQzMzcsLTguOTkzNTQ1IDE5LjU2OTk3NywtOS4wMDUzNTUgMTEuMjU5MjQsLTAuMDE4MTQgMjAuMzg4NjcsMi43NTI2OTIgMjYuODAwMTMsOC4xMzM5NzQgNy41NTU5Myw2LjM0MTg0NCAxNi43MzEzNCw3LjMwNTEzNyAzMi43MDk3MywzLjQzNDA1IDUuMjU0MjQsLTEuMjcyOTYxIDkuNzk5NjQsLTIuMzE0NDU5IDEwLjEwMDg3LC0yLjMxNDQ1OSAwLjMwMTI0LDAgMC4yODM5LDYuMzU2NDY5IC0wLjAzODUsMTQuMTI1NDg3IC0wLjk3NTExLDIzLjQ5NzA5MiAtNC4zNTQ5MSw0MS40NjY4NTIgLTEyLjc2MTE0LDY3Ljg0ODY1MiBsIC00LjcyMjI4LDE0LjgyMDE4IC0xNS44ODYyNSwwLjA3ODIgYyAtMTQuMDA0MDgsMC4wNjkgLTE2Ljk0NTQyLDAuMzYxNzMgLTI0LjgyNjAxLDIuNDcwNzMgLTExLjkyNjksMy4xOTE4NiAtMjYuOTM3MzE5LDkuNjMzMDMgLTMxLjQ0OTcyOCwxMy40OTU0OCAtMy45NjMwMDksMy4zOTIyMiAtNi4zODY3MjEsNy4zMDM5OCAtNi4zODY3MjEsMTAuMzA4IDAsMS44MTQ0NyAtMC41MDI1MjQsMS44OTUzNSAtMTEuMzQ2NzAyLDEuODI2NzQgLTguMTY2MjU0LC0wLjA1MTcgLTEyLjYwMjIyMiwtMC41MTQxNyAtMTUuODI1OTQ2LC0xLjY1MDA0IGwgMWUtNSwxZS01IHoiCiAgICAgaWQ9InBhdGg0MjI0IgogICAgIHN0eWxlPSJmaWxsOm5vbmU7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDEwOS40MzAzNCwzMS41MDE1NTUgYyAtOS4wOTEwMiwwLjA5Nzk3IC0xNy4zMTQ5MTUsNS4zMzk0NjIgLTIyLjg5NjAyLDEyLjI3Mjk2NCAtMS45MzI0NSwtMy41MTQzOTQgLTguMjQ4MjQ3LC0zLjk3NTcxOCAtNy45ODkwMDUsMC45NTUyMDcgMC4zMzcxNDEsMy4wODI2MTYgLTIuNzgyNTI2LDUuNTQ2MzUyIC0wLjQ5MjA3Niw4LjYyNTgxIC00LjQ5ODA1NSw2LjgwNjMzNSAtMTEuMDMxMTUzLDEyLjk3ODk1MSAtMTIuMDQxMzk5LDIxLjYyMjQxNCAtMi44OTQzOTEsMTUuNTQ0OTIgLTIuNTE3NTYsMzIuNjc4NzQgLTEzLjkyMjg2Nyw0NS4wNjg0MSAtNS45NTYwNzQsNy42OTM1OCAtMTQuNDQxMjY4LDEzLjgxMjU3IC0xOS43NDA5NDcsMjEuOTExODcgMy45OTc0NTcsOC43NTA4MyAxMC4wNzA1NDYsMTYuNzQ1MiAxNi44NzUzMjYsMjMuNTMyODMgOS43ODIyNzQsNi45MDk1NCAyMi42MTE4NTcsNS4xMzU4IDMzLjg2NjQzMyw0Ljg2Mjg3IDQuNjY2ODc2LC0wLjk4NDMyIDIuMzU0MTk2LC03LjA1OTQ4IDUuODE4MDgsLTkuNDY1MjMgNy43NzY5MTYsLTguMzM3MjQgMTkuNDc5MzU1LC0xMS4wMTM0MiAyOS44MDMyNzUsLTE0Ljg4NTg3IDE0LjE3MTgyLC01LjE5OTE3IDI5Ljc4MzQ5LC0yLjQ5NTE3IDQ0LjQ4MzI2LC0zLjg1OTUgMy43ODQwNSwtMy43MjUyOSAzLjY5NDM3LC0xMC42MDMzNyA2LjAxNzk5LC0xNS40OTM2OCA5LjAyNTQxLC0yNi44MjgxMiAxNC4xMjY5OSwtNTUuMjk0ODEgMTMuMTg5OTksLTgzLjY4NTYxIC0yLjI1MjIyLC00LjcxODM2NiAtOC40MDE3MSwtMC4xMzI0NDYgLTEyLjE2ODIzLC0wLjEwODAzIC0xMS4xMDYxNiwyLjk4OTkyNiAtMjQuODIyNzIsNC44MTQ3MTYgLTMzLjY1Mjc3LC00LjI2Mjc2NiAtNy44NTg1NiwtNS40ODU3ODMgLTE3LjcyMTQ5LC03LjI2MDg3MSAtMjcuMTUxMDQsLTcuMDkxNjg5IHoiCiAgICAgaWQ9InBhdGg0MjMyIgogICAgIHN0eWxlPSJmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDI0Mi4yOTA5NywzODEuODg4ODkgYyAtNC4xNTI5MiwxNC4xNDM1NyAtMi43MzIwMywzMC40MjgwNSAtMTEuNDkxNDMsNDMuMDQyMjEgLTIuNTA3Miw0LjUzODIyIC03LjE0MDkzLDcuOTU0NzYgLTguNzEyNjUsMTMuMDU0NSAxLjQ5ODYsNS4xOTI0OSA5LjA0NzkyLDMuMjg4MzkgMTMuMjI3MjgsMy45OTM4OCA0LjA0ODE1LC0wLjA1MzMgMTAuOTQ4OCwxLjg0NDE4IDEwLjgyNTI5LC00LjQwNTM1IDIuMTQ3NTQsLTEwLjM0NDE5IDcuOTAwMTQsLTE5LjUxNTc4IDE1LjExMDkyLC0yNy4wMjkwMyAwLjkwNjUzLC02LjY3MDA2IC0xLjYzNDQ2LC0xMy40NzE2OCAtMC40NTk0LC0yMC4yODg4NyAxLjU3ODk0LC01LjIzNTQ0IC0wLjA1NTQsLTExLjI2MTgyIC02LjY5MDE4LC05LjExOTkzIC0zLjg3NDIsMC4zNjM0OCAtOC4xOTk3OCwtMC44MTM4NiAtMTEuODA5ODMsMC43NTI1OSB6IgogICAgIGlkPSJwYXRoNDIzNCIKICAgICBzdHlsZT0iZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSAyNjQuOTI2NDgsNDIwLjUzMTM2IGMgLTUuMDgyODEsMi4zNTM1NyAtOC4xNjAwOCw4LjQxMjUxIC05LjIzMzY3LDEzLjcyMDI1IDAuNjc1Myw0LjYxMDk2IDcuMjM3MzMsMy41NzkxNyAxMC4yNDY3NywyLjUxODI3IDEuNDAyNiwtNC41NTk5OCAyLjQzNTg5LC05LjY1MDI5IDIuMTQxOTgsLTE0LjQ3Mjg0IC0wLjg3Njg3LC0xLjMwNDMxIC0xLjUxMDc3LC0xLjkyNTUyIC0zLjE1NTA4LC0xLjc2NTY4IHoiCiAgICAgaWQ9InBhdGg0MjM2IgogICAgIHN0eWxlPSJmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDU2NS44NzQ2NiwyNTUuODg4MzkgYyAtMzYuMjcxNjYsNC44MDUwOSAtNzIuMzcyNDIsMTAuOTg3MDcgLTEwOC43Njk2OCwxNS4yMDMyNiAtNTIuOTc0MjQsNi43Mzg1NyAtMTA2LjI0MDczLDEwLjkxNDgxIC0xNTkuNTU2NzMsMTMuNjI2NjIgLTQuODU5MDEsNC40MzA4NSAtNi4xMDM0LDExLjg2Mzg0IC05LjQxOTY1LDE3LjUxMzUxIC0xLjMxOTk0LDIuNzcyNDIgLTUuMjc0OSw5LjA1NTM3IDAuNDc1NDQsOS4yMzIyOSAxNy44MTEyLC02LjEwNzY3IDM1LjUxMDMzLC0xMi41MTQ4NSA1NC41ODg0OCwtMTMuMDEzODYgMjQuMjc2MjIsLTIuMjEwNzUgNDkuNTk2NiwtMC4zNTM2NSA3Mi41NDA5LC05Ljk5Nzk0IDE3LjE5NzIyLC00LjI5OTc4IDM2LjQwMDEyLC0xLjE5MDg4IDUwLjY4MzkyLDkuMzQ5NDUgMy45NTEyNCw0LjI4MzUyIDkuMjI4MDYsNC4wOTA5OSAxNC4xODMyOCwxLjc5NDYzIDIyLjUzODM1LC04LjcxNzQ4IDQzLjI5OTAyLC0yMS41Njc2MyA2Ni4zNjYyNywtMjguNzM4NDEgNy4yNzkyMSwtMy4zMjc3NiAxNS43Mzg1NywtNS40MjIzNyAyMS43NzMzNCwtMTAuNzE0NTQgMS41ODAzOSwtMS45OTM0MyAtMC41MDI2OCwtNC44Mjc1OSAtMi44NjU1NywtNC4yNTUwMSB6IgogICAgIGlkPSJwYXRoNDIzOCIKICAgICBzdHlsZT0iZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA2NTEuOTUzMjUsMzIxLjA2ODI1IGMgLTYuODA1MzksNS45NzM2OCAtMC44Njc1MiwxNy42OTI3NiAtMS43MDAyMywyNS41MTAxNCAxLjc1ODM0LDEzLjczNDYzIDQuMzE4OCwyNy41NTIwNCAtMi43NTMxMyw0MC4zMDg1NSAtNS43NDYxLDE2LjY3NDMgLTguMDMxMDUsMzQuODA0NDIgLTE5LjUxMzY2LDQ4LjkyMTk0IC0yLjgwOTM5LDMuOTA5MDggLTkuMzU0NDEsMTMuMjgyODkgLTAuMjg5NDUsMTMuNzIwMjUgOC41NzQ3OSwwLjM0NzQgMjEuOTI4MDcsMy43OTY0NSAyMS44ODI5MiwtOC45MTUyNyAzLjg4MDYzLC0xMS44NzkyNCAxNi41MjgzLC0xOS42MjA0NiAxNi4zODMyNSwtMzIuOTk4MDYgMi43NTQ3MiwtMTguOTkzMjkgMTkuNjUxMTcsLTM4Ljc4Njg2IDcuNzU3NDQsLTU3Ljg5MTM0IC02LjI4MDE4LC05LjUzMzU1IC0xMC40MzY5MywtMjIuMTUwODIgLTIwLjAzMDQsLTI4LjcxNDEgLTAuNTc1MTIsLTAuMDg5MyAtMS4xNjg4OSwtMC4wODYzIC0xLjczNjc0LDAuMDU3OSB6IgogICAgIGlkPSJwYXRoNDI0MCIKICAgICBzdHlsZT0iZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA3MDkuNDM5MzUsMzM0LjYxNDgyIGMgLTcuMTc2MDMsMy4zNjY4OSAtMTQuOTUxMTIsNC44OTc3IC0yMi44MDkxOSw1Ljc4OTEzIC03LjYyNjQ5LDYuNTExODQgMy4xNjE1MywxNi44MDk4IDQuMzk5NzQsMjQuMDgyOCA4Ljc0NDUsMTYuODgxMjEgMTAuMTEwMjcsMzUuNjY0MjUgMTEuNTIwMzgsNTQuMjQ0MTkgMS43NTQyNCw0Ljc3MzU0IDQuNjM1NjQsOS4zODM2OSAwLjA1NzksMTMuODkzOTIgLTQuNDM2NzQsNi43NTI5MSAtMTMuOTk0NDIsMjEuMDQxNTEgMS44NTI1MiwxNy4zMDk1MSAxMC43NzU3NCwxLjg0NzA5IDIwLjgxMTU0LDAuMDM4IDE5LjkxNDYyLC0xMy4xOTkyMyA2LjMwMDg2LC0xOC4wMTkyNiAtNi45NDMzMSwtMzQuNjM4NiAtNi4zMTAxNSwtNTIuNzM5MDEgLTIuMTM5OTYsLTE1Ljg3ODAzIDAuNDE3ODMsLTMzLjA3NzQyIC00LjU3MzQyLC00OC4yMjM0OCAtMS4wODgsLTAuOTM2OTIgLTIuNjQyOTYsLTEuMzU4NyAtNC4wNTIzOSwtMS4xNTc4MyB6IgogICAgIGlkPSJwYXRoNDI0MiIKICAgICBzdHlsZT0iZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA3MzcuMjI3MTksMzAyLjU0MzAyIGMgLTkuMDIyMSwzLjAyOTI4IDIuNjMwNDcsMjEuNDAyMzIgNi43NzMyOSwxMC4zNjI1NSAxLjA5NzU2LC00LjU1ODY1IC0xLjE5MDEsLTEwLjk0MzExIC02Ljc3MzI5LC0xMC4zNjI1NSB6IgogICAgIGlkPSJwYXRoNDI0NCIKICAgICBzdHlsZT0iZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA2NDguOTk5NDcsMzEyLjA2MDM1IGMgLTMuMjA0NjcsMS42MzY5OCAtMS45MzIzOSw2LjAwOSAtMS43NzIwMyw4LjkwODIyIC0wLjEzNDMzLDIuNzAwNTQgMy4yMTg3OSw1LjE1ODUgNS4yODg5MywyLjk3Mzk4IDEuMDUxOCwtMS4wOTQzNiAzLjc3OTcsLTAuNTI4MTggMy44NTcxMiwtMi44MTE1NyAwLjMwMzk4LC0yLjg1MzQ3IC0yLjQzNTEzLC01LjA2NTQgLTMuNzg0NzUsLTcuMzc3MyAtMC44MTMzMywtMS4xODA2MiAtMi4wNjk0MSwtMi4xMzE1MSAtMy41ODkyNywtMS42OTMzMyB6IgogICAgIGlkPSJwYXRoNDI0NiIKICAgICBzdHlsZT0iZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA2NzcuMDk5MjcsMzYwLjI1MjI4IGMgLTIuNjAwMDYsMS4xODExMSAtMS41Njc5Niw1Ljk5OTMzIDEuNDI4NDMsNS40Mzk5OSAyLjgxMzYsLTAuMTA3MTMgMy4yNTIzNCwtNS4wMzY3NCAwLjIxOTIyLC01LjY1NDkgLTAuNTY3NzIsLTAuMTY2NzUgLTEuMDk2NTgsMC4xMjE3NyAtMS42NDc2NSwwLjIxNDkxIHoiCiAgICAgaWQ9InBhdGg0MjQ4IgogICAgIHN0eWxlPSJmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDYyMi4wMzgwMyw0NDQuMDU4MDEgYyAtMS41ODg1NywwLjU0NjggLTMuMDQwOTEsMi41MzQ5NiAtMi45NzI0Myw0LjMzNTg1IDAuMjAxOTUsMi41MDM0NSAzLjI2MzY1LDIuNjg1NTMgNS4xNTA5MiwyLjMwMjEzIDIuMTM4MDMsLTAuMjgzNTkgMi40ODc1NCwtMy4wMTMyNiAxLjI5NDk5LC00LjQ5NiAtMC42MTEyOCwtMS4zODAzOSAtMS44NTI0MiwtMi41MzA2OCAtMy40NzM0OCwtMi4xNDE5OCB6IgogICAgIGlkPSJwYXRoNDI1MCIKICAgICBzdHlsZT0iZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA3MDAuMzc3OTksNDA5LjgwMDgxIGMgLTIuMjM1OCwxLjM3NTkxIC0xLjQ4NzI2LDQuMzI3OTcgLTEuNDAzODYsNi41MDU1NCAtMC4wOTA5LDIuMjQ4NjYgMi42Mzk1Niw0LjIyMTM5IDQuNTcxMTIsMi43MDEwMiAxLjc5NzkzLC0xLjUwMDIyIDAuOTU2NSwtNC4xMTMyNyAwLjg5OTYxLC02LjEzMTA4IDAuMDMxLC0xLjgyMTggLTEuNTQzNzcsLTMuOTY1NzkgLTMuNTM5MSwtMy4yMDkwMSAtMC4xNzU5MiwwLjA0NDUgLTAuMzUxODQsMC4wODkgLTAuNTI3NzcsMC4xMzM1MyB6IgogICAgIGlkPSJwYXRoNDI1MiIKICAgICBzdHlsZT0iZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA2ODQuNDQzNCwzMzkuNjIyMDQgYyAtMS43ODU0OCwwLjA3NTIgLTQuNDIxMjcsMC4yOTYzMiAtNC41MzQ4NiwyLjU4Nzc0IDAuMTAwOTEsMS42ODgwNyAxLjI0NzM2LDMuNDA2MTEgMi42NjA2Myw0LjM1OTIyIDEuODU1NzMsMC45MDQyOCAzLjU4MTQ3LC0wLjY4MTAyIDQuMTM5MjMsLTIuMzczNTUgMS4wMzA5OSwtMS41NDI4IDAuNjg1MjksLTMuOTkzNTcgLTEuMzM4NzQsLTQuNTA4MjkgLTAuMzA4MTQsLTAuMDI4MyAtMC42MTU0OCwtMC4xMDA1OCAtMC45MjYyNiwtMC4wNjUxIHoiCiAgICAgaWQ9InBhdGg0MjU0IgogICAgIHN0eWxlPSJmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDcxMS45Nzc5NywzMzAuNTExMzkgYyAtMS45ODUyOSwwLjUwNjU0IC00LjE2NTU2LDIuNTUzMDUgLTMuNTA5NjYsNC43NzYwMyAwLjQwMjgyLDEuMjg0NzYgMS42NjUzOCwxLjcyNDMyIDIuODIyMiwxLjkxMDQyIDEuNjk5NTEsMS4zMjMxNSA0LjU3NTUzLDAuMDMxMyA0LjM3MDc5LC0yLjIyMTU4IC0wLjE2NTM1LC0yLjAyMTIgLTAuODk2NDMsLTQuNzUzMTEgLTMuNjgzMzMsLTQuNDY0ODcgeiIKICAgICBpZD0icGF0aDQyNTYiCiAgICAgc3R5bGU9ImZpbGw6IzAwMDAwMDtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZSIgLz4KICA8cGF0aAogICAgIGQ9Im0gNzM2LjA2OCwyOTAuODEyNCBjIC0xLjYzMTEyLDAuMTkwNDUgLTIuMjY1NTksMi4zODggLTIuNTY4OTMsMy45ODcyNyAtMC41NjIwMSwzLjExMTAzIC0xLjU3OTQ1LDYuMjY2ODYgLTEuMjM3NDIsOS40NTA3NiAwLjMyLDEuNzcyOTUgMi42MTM0MiwyLjYxODE2IDQuMTEwMjgsMS41NDEzNiAwLjk0Nzg2LC0xLjA3NzQxIDIuNDY4MzMsLTAuOTYzMTUgMy42NjE2MywtMC40MTI0OCAxLjk2MTYzLDAuNjYzODUgMy45Mzc1MiwtMS40MDU3NyAzLjE5ODUsLTMuMzM1OTkgLTEuMzAyLC0zLjQwNDA5IC0yLjQyMzA0LC02LjkyNTEgLTQuMjExNiwtMTAuMTA5MjcgLTAuNjIyMjksLTAuOTA3ODMgLTEuODQ4MjEsLTEuNTQzNSAtMi45NTI0NiwtMS4xMjE2NSB6IgogICAgIGlkPSJwYXRoNDI1OCIKICAgICBzdHlsZT0iZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA3MzYuNzkxNjQsMzEzLjcxNTY2IGMgLTEuODIzNjUsMS4wMTI4MyAtMS4zMzYzOSwzLjM1MTk3IC0wLjQ3NzYsNC44NTU2NCAwLjc3NTg0LDEuNjc5NDggMS4zNzgyMiw0LjQxNTY1IDMuNjEwOTcsNC41MyAyLjQxNzg5LDAuMzM0NTIgMy4xOTQ1MywtMi4zOTkxNyAzLjc5MTg5LC00LjE4OTg5IDAuNjc1ODYsLTEuNTg0OTMgMC44OTk5MSwtMy44NTY3NiAtMC45NDA3NCwtNC43NTQzMyAtMS4yMDY4NiwtMC41ODg4NSAtMi41NTQwOSwwLjE4NDY2IC0zLjczMzk5LC0wLjU3MTY3IC0wLjc3OTc4LC0wLjMyMzk0IC0xLjQ3OTIyLC0wLjA5NjUgLTIuMjUwNTMsMC4xMzAyNSB6IgogICAgIGlkPSJwYXRoNDI2MCIKICAgICBzdHlsZT0iZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA1NzQuMDAxNDQsMjUzLjg5ODM5IGMgLTEuOTA1MzEsMC4yNDUgLTMuODI0NTQsMC40OTY2NyAtNS43MDI4LDAuOTE4NDkgLTEuMzU3NjEsMC40MzQzOCAtMi4wNjUwNCwyLjAzODk1IC0xLjYwODM0LDMuMzYxNTMgMC4yNTgyNiwwLjY3MDkyIDAuMDc4MSwxLjQ2ODE2IDAuNTgzNjYsMi4wNTA1MyAwLjczNjIsMS4xNjA1MiAyLjQwMzA4LDEuMzk0MjkgMy41MjI5OCwwLjY1OTcxIDEuNTU5NTcsLTAuODA2OTggMy4xODU0NSwtMS40OTQzNCA0LjcyMTY3LC0yLjM1MTc3IDEuMjQ0ODcsLTAuNzU3NDkgMS41ODM3MiwtMi42NDQ5NSAwLjU4Mzk5LC0zLjczNTA5IC0wLjQ5MywtMC42MzgwMiAtMS4zMzUwMywtMC45NDAzNCAtMi4xMDExNiwtMC45MDM0IHoiCiAgICAgaWQ9InBhdGg0MjYyIgogICAgIHN0eWxlPSJmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDI2OC4xNjk5Myw0MTUuODM3NDMgYyAtMS40Njg2NywwLjU4Njk4IC0yLjkzMDk5LDEuOTUwMjYgLTMuOTgwMDMsMy4yNTYzOSAtMS4yMTE3OSwyLjA3NjM0IDAuOTIxNiw0LjI0MzMgMi45NjE0LDQuNDQ5NCAyLjQ0NzIsMC4yNTA3NCAzLjI5MjU1LC0yLjQ4Nzk4IDQuMTMxMzIsLTQuMjY4NDcgMC44MzM5LC0xLjkyNDg4IC0xLjA1Njk1LC00LjI0NDIyIC0zLjExMjY5LC0zLjQzNzMyIHoiCiAgICAgaWQ9InBhdGg0MjY0IgogICAgIHN0eWxlPSJmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDIyMS45OTUxMyw0MzYuNTg4NTggYyAtMS44Mjc0MiwwLjExOTQzIC0zLjAzMjE4LDIuMzU3MjEgLTIuMDYyNTcsMy45MjgwNiAwLjg5MTk1LDEuNjk0NTMgMy43ODc0MiwxLjg4NTIzIDQuODA3MTMsMC4xMjYwNiAwLjk4OTQyLC0xLjQ0OTk4IC0wLjA0NTYsLTMuNTM5MTQgLTEuNjc3MTgsLTMuOTU2NDIgLTAuMzQ0NSwtMC4wOTg2IC0wLjcxMDg3LC0wLjEyNjYgLTEuMDY3MzgsLTAuMDk3NyB6IgogICAgIGlkPSJwYXRoNDI2NiIKICAgICBzdHlsZT0iZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lIiAvPgogIDxwYXRoCiAgICAgZD0ibSA2OTkuNjg0OTksMTYwLjc1OTcgYyAwLjc1Mjc2LDMxLjA3NjI3IC05LjcyOTU3LDQ2LjUwMTk2IC0zNS40MDI3Myw4Mi4wMTEzNyAxMi4wOTQ4Miw4LjcxNTE5IDE2LjE2NDQyLDkuMDExNSAyOS42MjQ5Myw4Ljk0MjEzIC01LjE5NDE4LC0xMy4yMTY3OSAxNS4zMjA5LC02MS40MjY4IDE4LjI4NjQsLTgxLjIwOTE0IC00LjU1OTcxLC01Ljk4MzExIC04LjI4MTUxLC05LjM3NTEzIC0xMi41MDg2LC05Ljc0NDM2IHoiCiAgICAgaWQ9InBhdGgyNDczIgogICAgIHN0eWxlPSJmaWxsOiNlOWM2YWY7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHBhdGgKICAgICBkPSJtIDY2MS44MDk1LDI0NC44NTcyIGMgLTcuMzg2LDkuNDQwMzIgLTE1LjY2MzU1LDIwLjc5MTI4IC0yMi4xNzAzNCwzMy4xMTM4NSBsIDYuNDk2MSw3LjgxMzI5IGMgMjYuOTY1NjYsMi42NzIzMiA0NC43MTEyNiwtNy41ODY2OSA1NC4zNzczNSwtMTUuNjMzNDMgLTMuNjg5NjgsLTYuNjQxODYgLTMuNDYxNjUsLTcuNzc1MjcgLTUuOTMxNTYsLTE0LjU5OTY4IC0xMy45NzkzOSwtMC40NzQ1NyAtMjEuNTA2ODYsNWUtNCAtMzIuNzcxNTUsLTEwLjY5NDAzIHoiCiAgICAgaWQ9InBhdGgyNDgxIgogICAgIHN0eWxlPSJmaWxsOiNhZmRkZTk7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmUiIC8+CiAgPHRleHQKICAgICB4PSI1MjkuODc0ODIiCiAgICAgeT0iOTkuMzU5MzM3IgogICAgIHRyYW5zZm9ybT0ic2NhbGUoMS4wMDQxMDk3LDAuOTk1OTA3MTEpIgogICAgIGlkPSJ0ZXh0MjYzMSIKICAgICB4bWw6c3BhY2U9InByZXNlcnZlIgogICAgIHN0eWxlPSJmb250LXNpemU6MjQuNzE3MjQzMTlweDtmb250LXN0eWxlOm5vcm1hbDtmb250LXZhcmlhbnQ6bm9ybWFsO2ZvbnQtd2VpZ2h0Om5vcm1hbDtmb250LXN0cmV0Y2g6bm9ybWFsO3RleHQtYWxpZ246c3RhcnQ7bGluZS1oZWlnaHQ6MTAwJTt3cml0aW5nLW1vZGU6bHItdGI7dGV4dC1hbmNob3I6c3RhcnQ7ZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO2ZvbnQtZmFtaWx5OkNhbGlicmk7LWlua3NjYXBlLWZvbnQtc3BlY2lmaWNhdGlvbjpDYWxpYnJpIgogICAgIHNvZGlwb2RpOmxpbmVzcGFjaW5nPSIxMDAlIj48dHNwYW4KICAgICAgIHg9IjUyOS44NzQ4MiIKICAgICAgIHk9Ijk5LjM1OTMzNyIKICAgICAgIGlkPSJ0c3BhbjI2MzMiPjY8L3RzcGFuPjwvdGV4dD4KICA8dGV4dAogICAgIHg9IjU5MC4zMDQyNiIKICAgICB5PSIxMjIuOTk1NDgiCiAgICAgaWQ9InRleHQyNjM1IgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMDAlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEwMCUiPjx0c3BhbgogICAgICAgeD0iNTkwLjMwNDI2IgogICAgICAgeT0iMTIyLjk5NTQ4IgogICAgICAgaWQ9InRzcGFuMjYzNyI+NzwvdHNwYW4+PC90ZXh0PgogIDx0ZXh0CiAgICAgeD0iNjUxLjMwNDI2IgogICAgIHk9Ijg1Ljk5NTQ4MyIKICAgICBpZD0idGV4dDI2MzkiCiAgICAgeG1sOnNwYWNlPSJwcmVzZXJ2ZSIKICAgICBzdHlsZT0iZm9udC1zaXplOjIwcHg7Zm9udC1zdHlsZTpub3JtYWw7Zm9udC12YXJpYW50Om5vcm1hbDtmb250LXdlaWdodDpub3JtYWw7Zm9udC1zdHJldGNoOm5vcm1hbDt0ZXh0LWFsaWduOnN0YXJ0O2xpbmUtaGVpZ2h0OjEwMCU7d3JpdGluZy1tb2RlOmxyLXRiO3RleHQtYW5jaG9yOnN0YXJ0O2ZpbGw6IzAwMDAwMDtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtmb250LWZhbWlseTpDYWxpYnJpOy1pbmtzY2FwZS1mb250LXNwZWNpZmljYXRpb246Q2FsaWJyaSIKICAgICBzb2RpcG9kaTpsaW5lc3BhY2luZz0iMTAwJSI+PHRzcGFuCiAgICAgICB4PSI2NTEuMzA0MjYiCiAgICAgICB5PSI4NS45OTU0ODMiCiAgICAgICBpZD0idHNwYW4yNjQxIj44PC90c3Bhbj48L3RleHQ+CiAgPHRleHQKICAgICB4PSI2MzQuMzA0MjYiCiAgICAgeT0iMTMyLjk5NTQ4IgogICAgIGlkPSJ0ZXh0MjY0MyIKICAgICB4bWw6c3BhY2U9InByZXNlcnZlIgogICAgIHN0eWxlPSJmb250LXNpemU6MjBweDtmb250LXN0eWxlOm5vcm1hbDtmb250LXZhcmlhbnQ6bm9ybWFsO2ZvbnQtd2VpZ2h0Om5vcm1hbDtmb250LXN0cmV0Y2g6bm9ybWFsO3RleHQtYWxpZ246c3RhcnQ7bGluZS1oZWlnaHQ6MTAwJTt3cml0aW5nLW1vZGU6bHItdGI7dGV4dC1hbmNob3I6c3RhcnQ7ZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO2ZvbnQtZmFtaWx5OkNhbGlicmk7LWlua3NjYXBlLWZvbnQtc3BlY2lmaWNhdGlvbjpDYWxpYnJpIgogICAgIHNvZGlwb2RpOmxpbmVzcGFjaW5nPSIxMDAlIj48dHNwYW4KICAgICAgIHg9IjYzNC4zMDQyNiIKICAgICAgIHk9IjEzMi45OTU0OCIKICAgICAgIGlkPSJ0c3BhbjI2NDUiPjk8L3RzcGFuPjwvdGV4dD4KICA8dGV4dAogICAgIHg9IjY4Ni4zMDQyNiIKICAgICB5PSIxMDguOTk1NDgiCiAgICAgaWQ9InRleHQyNjQ3IgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMDAlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEwMCUiPjx0c3BhbgogICAgICAgeD0iNjg2LjMwNDI2IgogICAgICAgeT0iMTA4Ljk5NTQ4IgogICAgICAgaWQ9InRzcGFuMjY0OSI+MTA8L3RzcGFuPjwvdGV4dD4KICA8dGV4dAogICAgIHg9IjUwMC4zMDQyMyIKICAgICB5PSIxNTcuOTk1NDgiCiAgICAgaWQ9InRleHQyNjUxIgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMDAlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEwMCUiPjx0c3BhbgogICAgICAgeD0iNTAwLjMwNDIzIgogICAgICAgeT0iMTU3Ljk5NTQ4IgogICAgICAgaWQ9InRzcGFuMjY1MyI+MTE8L3RzcGFuPjwvdGV4dD4KICA8dGV4dAogICAgIHg9IjE1OS4zMDQyMyIKICAgICB5PSIxNzQuOTk1NDgiCiAgICAgaWQ9InRleHQyNjU1IgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMDAlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEwMCUiPjx0c3BhbgogICAgICAgeD0iMTU5LjMwNDIzIgogICAgICAgeT0iMTc0Ljk5NTQ4IgogICAgICAgaWQ9InRzcGFuMjY1NyI+MTI8L3RzcGFuPjwvdGV4dD4KICA8dGV4dAogICAgIHg9IjQzNi4zMDQyMyIKICAgICB5PSIyMjYuOTk1NDgiCiAgICAgaWQ9InRleHQyNjU5IgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMDAlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEwMCUiPjx0c3BhbgogICAgICAgeD0iNDM2LjMwNDIzIgogICAgICAgeT0iMjI2Ljk5NTQ4IgogICAgICAgaWQ9InRzcGFuMjY2MSI+MTM8L3RzcGFuPjwvdGV4dD4KICA8dGV4dAogICAgIHg9IjU0NC4zMDQyNiIKICAgICB5PSIyMjYuOTk1NDgiCiAgICAgaWQ9InRleHQyNjYzIgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMDAlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEwMCUiPjx0c3BhbgogICAgICAgeD0iNTQ0LjMwNDI2IgogICAgICAgeT0iMjI2Ljk5NTQ4IgogICAgICAgaWQ9InRzcGFuMjY2NSI+MTQ8L3RzcGFuPjwvdGV4dD4KICA8dGV4dAogICAgIHg9IjYwMS4zMDQyNiIKICAgICB5PSIxOTIuOTk1NDgiCiAgICAgaWQ9InRleHQyNjY3IgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMDAlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEwMCUiPjx0c3BhbgogICAgICAgeD0iNjAxLjMwNDI2IgogICAgICAgeT0iMTkyLjk5NTQ4IgogICAgICAgaWQ9InRzcGFuMjY2OSI+MTU8L3RzcGFuPjwvdGV4dD4KICA8dGV4dAogICAgIHg9IjYzMS4zMDQyNiIKICAgICB5PSIyNDUuOTk1NDgiCiAgICAgaWQ9InRleHQyNjcxIgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMDAlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEwMCUiPjx0c3BhbgogICAgICAgeD0iNjMxLjMwNDI2IgogICAgICAgeT0iMjQ1Ljk5NTQ4IgogICAgICAgaWQ9InRzcGFuMjY3MyI+MTY8L3RzcGFuPjwvdGV4dD4KICA8dGV4dAogICAgIHg9IjY1OS4zMDQyNiIKICAgICB5PSIyNzEuOTk1NDgiCiAgICAgaWQ9InRleHQyNjc1IgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMDAlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEwMCUiPjx0c3BhbgogICAgICAgeD0iNjU5LjMwNDI2IgogICAgICAgeT0iMjcxLjk5NTQ4IgogICAgICAgaWQ9InRzcGFuMjY3NyI+MTc8L3RzcGFuPjwvdGV4dD4KICA8dGV4dAogICAgIHg9IjY3Ni4zMDQyNiIKICAgICB5PSIyMzQuOTk1NDgiCiAgICAgaWQ9InRleHQyNjc5IgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMDAlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEwMCUiPjx0c3BhbgogICAgICAgeD0iNjc2LjMwNDI2IgogICAgICAgeT0iMjM0Ljk5NTQ4IgogICAgICAgaWQ9InRzcGFuMjY4MSI+MTg8L3RzcGFuPjwvdGV4dD4KICA8dGV4dAogICAgIHg9IjI0OS4zMDQyMyIKICAgICB5PSIzMzIuOTk1NDgiCiAgICAgaWQ9InRleHQyNjgzIgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMDAlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEwMCUiPjx0c3BhbgogICAgICAgeD0iMjQ5LjMwNDIzIgogICAgICAgeT0iMzMyLjk5NTQ4IgogICAgICAgaWQ9InRzcGFuMjY4NSI+MTk8L3RzcGFuPjwvdGV4dD4KICA8dGV4dAogICAgIHg9IjY3MS4zMDQyNiIKICAgICB5PSIzMDUuOTk1NDgiCiAgICAgaWQ9InRleHQyNjg3IgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMDAlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEwMCUiPjx0c3BhbgogICAgICAgeD0iNjcxLjMwNDI2IgogICAgICAgeT0iMzA1Ljk5NTQ4IgogICAgICAgaWQ9InRzcGFuMjY4OSI+MTk8L3RzcGFuPjwvdGV4dD4KICA8dGV4dAogICAgIHg9IjIzMi41NzUzOSIKICAgICB5PSI0OTIuOTk1NDgiCiAgICAgaWQ9InRleHQyNzQ3IgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMDAlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEwMCUiPjx0c3BhbgogICAgICAgeD0iMjMyLjU3NTM5IgogICAgICAgeT0iNDkyLjk5NTQ4IgogICAgICAgaWQ9InRzcGFuMjc0OSI+Ni4gRmlsw6kgbWlnbm9uPC90c3Bhbj48dHNwYW4KICAgICAgIHg9IjIzMi41NzUzOSIKICAgICAgIHk9IjUxMi45OTU0OCIKICAgICAgIGlkPSJ0c3BhbjI3NTEiPjcuIENvbnRyYWZpbMOpPC90c3Bhbj48dHNwYW4KICAgICAgIHg9IjIzMi41NzUzOSIKICAgICAgIHk9IjUzMi45OTU0OCIKICAgICAgIGlkPSJ0c3BhbjI3NTMiPjguIFBpY2FuaGE8L3RzcGFuPjx0c3BhbgogICAgICAgeD0iMjMyLjU3NTM5IgogICAgICAgeT0iNTUyLjk5NTQ4IgogICAgICAgaWQ9InRzcGFuMjc1NSI+OS4gQWxjYXRyYTwvdHNwYW4+PHRzcGFuCiAgICAgICB4PSIyMzIuNTc1MzkiCiAgICAgICB5PSI1NzIuOTk1NDgiCiAgICAgICBpZD0idHNwYW4yNzU3Ij4xMC4gTGFnYXJ0bzwvdHNwYW4+PC90ZXh0PgogIDx0ZXh0CiAgICAgeD0iMTguMzA0MjMyIgogICAgIHk9IjQ5Mi4yOTYzMyIKICAgICBpZD0idGV4dDI1NTMiCiAgICAgeG1sOnNwYWNlPSJwcmVzZXJ2ZSIKICAgICBzdHlsZT0iZm9udC1zaXplOjIwcHg7Zm9udC1zdHlsZTpub3JtYWw7Zm9udC12YXJpYW50Om5vcm1hbDtmb250LXdlaWdodDpub3JtYWw7Zm9udC1zdHJldGNoOm5vcm1hbDt0ZXh0LWFsaWduOnN0YXJ0O2xpbmUtaGVpZ2h0OjEwMCU7d3JpdGluZy1tb2RlOmxyLXRiO3RleHQtYW5jaG9yOnN0YXJ0O2ZpbGw6IzAwMDAwMDtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtmb250LWZhbWlseTpDYWxpYnJpOy1pbmtzY2FwZS1mb250LXNwZWNpZmljYXRpb246Q2FsaWJyaSIKICAgICBzb2RpcG9kaTpsaW5lc3BhY2luZz0iMTAwJSI+PHRzcGFuCiAgICAgICB4PSIxOC4zMDQyMzIiCiAgICAgICB5PSI0OTIuMjk2MzMiCiAgICAgICBpZD0idHNwYW4yNTU1Ij48dHNwYW4KICAgICAgICAgeD0iMTguMzA0MjMyIgogICAgICAgICB5PSI0OTIuMjk2MzMiCiAgICAgICAgIGlkPSJ0c3BhbjI1NTciPjEuIFBlc2Nvw6dvPC90c3Bhbj48dHNwYW4KICAgICAgICAgZHg9IjEwLjU0Njg3NSIKICAgICAgICAgaWQ9InRzcGFuMjU1OSIgLz48L3RzcGFuPjx0c3BhbgogICAgICAgeD0iMTguMzA0MjMyIgogICAgICAgeT0iNTEyLjI5NjMzIgogICAgICAgaWQ9InRzcGFuMjU2MSI+PHRzcGFuCiAgICAgICAgIHg9IjE4LjMwNDIzMiIKICAgICAgICAgaWQ9InRzcGFuMjU2MyI+Mi4gQWPDqW08L3RzcGFuPjx0c3BhbgogICAgICAgICBkeD0iMTUuOTc2NTYzIgogICAgICAgICBpZD0idHNwYW4yNTY1IiAvPjwvdHNwYW4+PHRzcGFuCiAgICAgICB4PSIxOC4zMDQyMzIiCiAgICAgICB5PSI1MzIuMjk2MzMiCiAgICAgICBpZD0idHNwYW4yNTY3Ij48dHNwYW4KICAgICAgICAgeD0iMTguMzA0MjMyIgogICAgICAgICBpZD0idHNwYW4yNTY5Ij4zLiBQYWxldGE8L3RzcGFuPjx0c3BhbgogICAgICAgICBkeD0iOS41NzAzMTI1IgogICAgICAgICBpZD0idHNwYW4yNTcxIiAvPjwvdHNwYW4+PHRzcGFuCiAgICAgICB4PSIxOC4zMDQyMzIiCiAgICAgICB5PSI1NTIuMjk2MzMiCiAgICAgICBpZD0idHNwYW4yNTczIj48dHNwYW4KICAgICAgICAgeD0iMTguMzA0MjMyIgogICAgICAgICBpZD0idHNwYW4yNTc1Ij40LiBDYXBhIGRlIGZpbMOpPC90c3Bhbj48dHNwYW4KICAgICAgICAgZHg9IjkuOTYwOTM3NSIKICAgICAgICAgaWQ9InRzcGFuMjU3NyIgLz48L3RzcGFuPjx0c3BhbgogICAgICAgeD0iMTguMzA0MjMyIgogICAgICAgeT0iNTcyLjI5NjMzIgogICAgICAgaWQ9InRzcGFuMjU4MCI+PHRzcGFuCiAgICAgICAgIHg9IjE4LjMwNDIzMiIKICAgICAgICAgaWQ9InRzcGFuMjU4MiI+NS4gRmlsw6kgZGUgY29zdGVsYTwvdHNwYW4+PHRzcGFuCiAgICAgICAgIGR4PSI5LjU3MDMxMjUiCiAgICAgICAgIGlkPSJ0c3BhbjI1ODQiIC8+PC90c3Bhbj48L3RleHQ+CiAgPHRleHQKICAgICB4PSI0MDMuMzc0ODgiCiAgICAgeT0iNDkyLjI5NjMzIgogICAgIGlkPSJ0ZXh0MjU4NiIKICAgICB4bWw6c3BhY2U9InByZXNlcnZlIgogICAgIHN0eWxlPSJmb250LXNpemU6MjBweDtmb250LXN0eWxlOm5vcm1hbDtmb250LXZhcmlhbnQ6bm9ybWFsO2ZvbnQtd2VpZ2h0Om5vcm1hbDtmb250LXN0cmV0Y2g6bm9ybWFsO3RleHQtYWxpZ246c3RhcnQ7bGluZS1oZWlnaHQ6MTAwJTt3cml0aW5nLW1vZGU6bHItdGI7dGV4dC1hbmNob3I6c3RhcnQ7ZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO2ZvbnQtZmFtaWx5OkNhbGlicmk7LWlua3NjYXBlLWZvbnQtc3BlY2lmaWNhdGlvbjpDYWxpYnJpIgogICAgIHNvZGlwb2RpOmxpbmVzcGFjaW5nPSIxMDAlIj48dHNwYW4KICAgICAgIHg9IjQwMy4zNzQ4OCIKICAgICAgIHk9IjQ5Mi4yOTYzMyIKICAgICAgIGlkPSJ0c3BhbjI1ODgiPjx0c3BhbgogICAgICAgICB4PSI0MDMuMzc0ODgiCiAgICAgICAgIHk9IjQ5Mi4yOTYzMyIKICAgICAgICAgaWQ9InRzcGFuMjU5MCI+MTEuIEFiYSBkZSBmaWzDqTwvdHNwYW4+PHRzcGFuCiAgICAgICAgIHg9IjUxOS43MDMiCiAgICAgICAgIHk9IjQ5Mi4yOTYzMyIKICAgICAgICAgZHg9IjAiCiAgICAgICAgIGlkPSJ0c3BhbjI1OTIiIC8+PC90c3Bhbj48dHNwYW4KICAgICAgIHg9IjQwMy4zNzQ4OCIKICAgICAgIHk9IjUxMi4yOTYzMyIKICAgICAgIGlkPSJ0c3BhbjI1OTQiPjx0c3BhbgogICAgICAgICB4PSI0MDMuMzc0ODgiCiAgICAgICAgIHk9IjUxMi4yOTYzMyIKICAgICAgICAgaWQ9InRzcGFuMjU5NiI+MTIuIFBlaXRvPC90c3Bhbj48dHNwYW4KICAgICAgICAgeD0iNDc1LjQ0NTE5IgogICAgICAgICB5PSI1MTIuMjk2MzMiCiAgICAgICAgIGR4PSIwIgogICAgICAgICBpZD0idHNwYW4yNTk4IiAvPjwvdHNwYW4+PHRzcGFuCiAgICAgICB4PSI0MDMuMzc0ODgiCiAgICAgICB5PSI1MzIuMjk2MzMiCiAgICAgICBpZD0idHNwYW4yNjAwIj48dHNwYW4KICAgICAgICAgeD0iNDAzLjM3NDg4IgogICAgICAgICB5PSI1MzIuMjk2MzMiCiAgICAgICAgIGlkPSJ0c3BhbjI2MDIiPjEzLiBQb250YSBkZSBhZ3VsaGE8L3RzcGFuPjx0c3BhbgogICAgICAgICB4PSI1NjQuNjYzOTQiCiAgICAgICAgIHk9IjUzMi4yOTYzMyIKICAgICAgICAgZHg9IjAiCiAgICAgICAgIGlkPSJ0c3BhbjI2MDQiIC8+PC90c3Bhbj48dHNwYW4KICAgICAgIHg9IjQwMy4zNzQ4OCIKICAgICAgIHk9IjU1Mi4yOTYzMyIKICAgICAgIGlkPSJ0c3BhbjI2MDYiPjx0c3BhbgogICAgICAgICB4PSI0MDMuMzc0ODgiCiAgICAgICAgIHk9IjU1Mi4yOTYzMyIKICAgICAgICAgaWQ9InRzcGFuMjYwOCI+MTQuIEZyYWxkaW5oYTwvdHNwYW4+PHRzcGFuCiAgICAgICAgIHg9IjUwOS4zMTI0MSIKICAgICAgICAgeT0iNTUyLjI5NjMzIgogICAgICAgICBkeD0iMCIKICAgICAgICAgaWQ9InRzcGFuMjYxMCIgLz48L3RzcGFuPjx0c3BhbgogICAgICAgeD0iNDAzLjM3NDg4IgogICAgICAgeT0iNTcyLjI5NjMzIgogICAgICAgaWQ9InRzcGFuMjYxMiI+PHRzcGFuCiAgICAgICAgIHg9IjQwMy4zNzQ4OCIKICAgICAgICAgeT0iNTcyLjI5NjMzIgogICAgICAgICBpZD0idHNwYW4yNjE0Ij4xNS4gTWFtaW5oYSBkZSA8L3RzcGFuPjwvdHNwYW4+PHRzcGFuCiAgICAgICB4PSI0MDMuMzc0ODgiCiAgICAgICB5PSI1OTIuMjk2MzMiCiAgICAgICBpZD0idHNwYW4yNjE2Ij48dHNwYW4KICAgICAgICAgeD0iNDAzLjM3NDg4IgogICAgICAgICB5PSI1OTIuMjk2MzMiCiAgICAgICAgIGlkPSJ0c3BhbjI2MTgiPmFsY2F0cmE8L3RzcGFuPjwvdHNwYW4+PC90ZXh0PgogIDx0ZXh0CiAgICAgeD0iNjEyLjMwNDI2IgogICAgIHk9IjQ5My4yOTYzMyIKICAgICBpZD0idGV4dDI2MjAiCiAgICAgeG1sOnNwYWNlPSJwcmVzZXJ2ZSIKICAgICBzdHlsZT0iZm9udC1zaXplOjIwcHg7Zm9udC1zdHlsZTpub3JtYWw7Zm9udC12YXJpYW50Om5vcm1hbDtmb250LXdlaWdodDpub3JtYWw7Zm9udC1zdHJldGNoOm5vcm1hbDt0ZXh0LWFsaWduOnN0YXJ0O2xpbmUtaGVpZ2h0OjEwMCU7d3JpdGluZy1tb2RlOmxyLXRiO3RleHQtYW5jaG9yOnN0YXJ0O2ZpbGw6IzAwMDAwMDtmaWxsLW9wYWNpdHk6MTtzdHJva2U6bm9uZTtmb250LWZhbWlseTpDYWxpYnJpOy1pbmtzY2FwZS1mb250LXNwZWNpZmljYXRpb246Q2FsaWJyaSIKICAgICBzb2RpcG9kaTpsaW5lc3BhY2luZz0iMTAwJSI+PHRzcGFuCiAgICAgICB4PSI2MTIuMzA0MjYiCiAgICAgICB5PSI0OTMuMjk2MzMiCiAgICAgICBpZD0idHNwYW4yNjIyIj48dHNwYW4KICAgICAgICAgeD0iNjEyLjMwNDI2IgogICAgICAgICB5PSI0OTMuMjk2MzMiCiAgICAgICAgIGlkPSJ0c3BhbjI2MjQiPjE2LiBQYXRpbmhvPC90c3Bhbj48dHNwYW4KICAgICAgICAgeD0iNzA0Ljk5OTU3IgogICAgICAgICB5PSI0OTMuMjk2MzMiCiAgICAgICAgIGR4PSIwIgogICAgICAgICBpZD0idHNwYW4yNjI2IiAvPjwvdHNwYW4+PHRzcGFuCiAgICAgICB4PSI2MTIuMzA0MjYiCiAgICAgICB5PSI1MTMuMjk2MzMiCiAgICAgICBpZD0idHNwYW4yNjI4Ij48dHNwYW4KICAgICAgICAgeD0iNjEyLjMwNDI2IgogICAgICAgICB5PSI1MTMuMjk2MzMiCiAgICAgICAgIGlkPSJ0c3BhbjI2MzAiPjE3LiBDaMOjLWRlLWZvcmE8L3RzcGFuPjx0c3BhbgogICAgICAgICB4PSI3MzguODY2NzYiCiAgICAgICAgIHk9IjUxMy4yOTYzMyIKICAgICAgICAgZHg9IjAiCiAgICAgICAgIGlkPSJ0c3BhbjI2MzIiIC8+PC90c3Bhbj48dHNwYW4KICAgICAgIHg9IjYxMi4zMDQyNiIKICAgICAgIHk9IjUzMy4yOTYzMyIKICAgICAgIGlkPSJ0c3BhbjI2MzQiPjx0c3BhbgogICAgICAgICB4PSI2MTIuMzA0MjYiCiAgICAgICAgIHk9IjUzMy4yOTYzMyIKICAgICAgICAgaWQ9InRzcGFuMjYzNiI+MTguIENow6MtZGUtZGVudHJvPC90c3Bhbj48dHNwYW4KICAgICAgICAgeD0iNzYwLjg5ODAxIgogICAgICAgICB5PSI1MzMuMjk2MzMiCiAgICAgICAgIGR4PSIwIgogICAgICAgICBpZD0idHNwYW4yNjM4IiAvPjwvdHNwYW4+PHRzcGFuCiAgICAgICB4PSI2MTIuMzA0MjYiCiAgICAgICB5PSI1NTMuMjk2MzMiCiAgICAgICBpZD0idHNwYW4yNjQwIj48dHNwYW4KICAgICAgICAgeD0iNjEyLjMwNDI2IgogICAgICAgICB5PSI1NTMuMjk2MzMiCiAgICAgICAgIGlkPSJ0c3BhbjI2NDIiPjE5LiBNw7pzY3VsbzwvdHNwYW4+PC90c3Bhbj48L3RleHQ+CiAgPHRleHQKICAgICB4PSIxOTUuMzA0MjMiCiAgICAgeT0iMTAwLjM2ODMiCiAgICAgaWQ9InRleHQyNjQ0IgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMjUlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEyNSUiPjx0c3BhbgogICAgICAgeD0iMTk1LjMwNDIzIgogICAgICAgeT0iMTAwLjM2ODMiCiAgICAgICBpZD0idHNwYW4yNjQ2Ij48dHNwYW4KICAgICAgICAgeD0iMTk1LjMwNDIzIgogICAgICAgICB5PSIxMDAuMzY4MyIKICAgICAgICAgaWQ9InRzcGFuMjY0OCI+MTwvdHNwYW4+PC90c3Bhbj48L3RleHQ+CiAgPHRleHQKICAgICB4PSIyNzIuMzA0MjMiCiAgICAgeT0iNzMuMjk2MzAzIgogICAgIGlkPSJ0ZXh0MjU3MyIKICAgICB4bWw6c3BhY2U9InByZXNlcnZlIgogICAgIHN0eWxlPSJmb250LXNpemU6MjBweDtmb250LXN0eWxlOm5vcm1hbDtmb250LXZhcmlhbnQ6bm9ybWFsO2ZvbnQtd2VpZ2h0Om5vcm1hbDtmb250LXN0cmV0Y2g6bm9ybWFsO3RleHQtYWxpZ246c3RhcnQ7bGluZS1oZWlnaHQ6MTAwJTt3cml0aW5nLW1vZGU6bHItdGI7dGV4dC1hbmNob3I6c3RhcnQ7ZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO2ZvbnQtZmFtaWx5OkNhbGlicmk7LWlua3NjYXBlLWZvbnQtc3BlY2lmaWNhdGlvbjpDYWxpYnJpIgogICAgIHNvZGlwb2RpOmxpbmVzcGFjaW5nPSIxMDAlIj48dHNwYW4KICAgICAgIHg9IjI3Mi4zMDQyMyIKICAgICAgIHk9IjczLjI5NjMwMyIKICAgICAgIGlkPSJ0c3BhbjI1NzYiPjx0c3BhbgogICAgICAgICB4PSIyNzIuMzA0MjMiCiAgICAgICAgIHk9IjczLjI5NjMwMyIKICAgICAgICAgaWQ9InRzcGFuMjU3OCI+MjwvdHNwYW4+PC90c3Bhbj48L3RleHQ+CiAgPHRleHQKICAgICB4PSIyNjkuMzA0MjMiCiAgICAgeT0iMTc4LjI5NjMiCiAgICAgaWQ9InRleHQyNTgwIgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMDAlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEwMCUiPjx0c3BhbgogICAgICAgeD0iMjY5LjMwNDIzIgogICAgICAgeT0iMTc4LjI5NjMiCiAgICAgICBpZD0idHNwYW4yNTgzIj48dHNwYW4KICAgICAgICAgeD0iMjY5LjMwNDIzIgogICAgICAgICB5PSIxNzguMjk2MyIKICAgICAgICAgaWQ9InRzcGFuMjU4NSI+MzwvdHNwYW4+PC90c3Bhbj48L3RleHQ+CiAgPHRleHQKICAgICB4PSIzODcuMzA0MjMiCiAgICAgeT0iOTguMjk2MzEiCiAgICAgaWQ9InRleHQyNTg3IgogICAgIHhtbDpzcGFjZT0icHJlc2VydmUiCiAgICAgc3R5bGU9ImZvbnQtc2l6ZToyMHB4O2ZvbnQtc3R5bGU6bm9ybWFsO2ZvbnQtdmFyaWFudDpub3JtYWw7Zm9udC13ZWlnaHQ6bm9ybWFsO2ZvbnQtc3RyZXRjaDpub3JtYWw7dGV4dC1hbGlnbjpzdGFydDtsaW5lLWhlaWdodDoxMDAlO3dyaXRpbmctbW9kZTpsci10Yjt0ZXh0LWFuY2hvcjpzdGFydDtmaWxsOiMwMDAwMDA7ZmlsbC1vcGFjaXR5OjE7c3Ryb2tlOm5vbmU7Zm9udC1mYW1pbHk6Q2FsaWJyaTstaW5rc2NhcGUtZm9udC1zcGVjaWZpY2F0aW9uOkNhbGlicmkiCiAgICAgc29kaXBvZGk6bGluZXNwYWNpbmc9IjEwMCUiPjx0c3BhbgogICAgICAgeD0iMzg3LjMwNDIzIgogICAgICAgeT0iOTguMjk2MzEiCiAgICAgICBpZD0idHNwYW4yNTg5Ij48dHNwYW4KICAgICAgICAgeD0iMzg3LjMwNDIzIgogICAgICAgICB5PSI5OC4yOTYzMSIKICAgICAgICAgaWQ9InRzcGFuMjU5MSI+NDwvdHNwYW4+PC90c3Bhbj48L3RleHQ+CiAgPHRleHQKICAgICB4PSI0NDUuMzA0MjMiCiAgICAgeT0iMTAxLjI5NjMxIgogICAgIGlkPSJ0ZXh0MjU5MyIKICAgICB4bWw6c3BhY2U9InByZXNlcnZlIgogICAgIHN0eWxlPSJmb250LXNpemU6MjBweDtmb250LXN0eWxlOm5vcm1hbDtmb250LXZhcmlhbnQ6bm9ybWFsO2ZvbnQtd2VpZ2h0Om5vcm1hbDtmb250LXN0cmV0Y2g6bm9ybWFsO3RleHQtYWxpZ246c3RhcnQ7bGluZS1oZWlnaHQ6MTAwJTt3cml0aW5nLW1vZGU6bHItdGI7dGV4dC1hbmNob3I6c3RhcnQ7ZmlsbDojMDAwMDAwO2ZpbGwtb3BhY2l0eToxO3N0cm9rZTpub25lO2ZvbnQtZmFtaWx5OkNhbGlicmk7LWlua3NjYXBlLWZvbnQtc3BlY2lmaWNhdGlvbjpDYWxpYnJpIgogICAgIHNvZGlwb2RpOmxpbmVzcGFjaW5nPSIxMDAlIj48dHNwYW4KICAgICAgIHg9IjQ0NS4zMDQyMyIKICAgICAgIHk9IjEwMS4yOTYzMSIKICAgICAgIGlkPSJ0c3BhbjI1OTUiPjx0c3BhbgogICAgICAgICB4PSI0NDUuMzA0MjMiCiAgICAgICAgIHk9IjEwMS4yOTYzMSIKICAgICAgICAgaWQ9InRzcGFuMjU5NyI+NTwvdHNwYW4+PC90c3Bhbj48L3RleHQ+Cjwvc3ZnPgo=";
let acoAno=HOJE.getFullYear(), acoMes=HOJE.getMonth(), acoEdit=false;
// O açougue usa a MESMA base da Perdas/Quebras (prdData), filtrando só o setor "Açougue".
// Assim, o que se lança aqui aparece também na análise geral de todos os setores.
function acoMesItens(){ const pref=acoAno+"-"+String(acoMes+1).padStart(2,"0"); return prdData.filter(function(r){ return r.setor==="Açougue" && r.data && r.data.indexOf(pref)===0; }); }
function acoRenderKpis(){
  const itens=acoMesItens();
  const totVal=soma(itens.map(function(r){return +r.valor||0;}));
  const totQtd=soma(itens.map(function(r){return +r.qtd||0;}));
  const byMotivo=prdAgrupa(itens,function(r){return r.motivo;}).sort(function(a,b){return b.v-a.v;});
  const byCorte=prdAgrupa(itens,function(r){return r.produto;}).sort(function(a,b){return b.v-a.v;});
  const cards=[
    {v:brl(totVal),l:"Total perdido"},
    {v:num(Math.round(totQtd))+" kg",l:"Peso perdido"},
    {v:num(itens.length),l:"Registros"},
    {v:byMotivo[0]?prdEsc(byMotivo[0].k):"—",l:"Motivo principal"},
    {v:byCorte[0]?prdEsc(byCorte[0].k):"—",l:"Corte que mais perde"}
  ];
  document.getElementById("acoKpis").innerHTML=cards.map(function(c){ return '<div class="kpi"><div class="v">'+c.v+'</div><div class="l">'+c.l+'</div></div>'; }).join('');
}
function acoRenderEdit(){
  const wrap=document.getElementById("acoEditWrap");
  const itens=acoMesItens().slice().sort(function(a,b){ return a.data<b.data?1:(a.data>b.data?-1:0); });
  const motivoOpts=ACO_MOTIVOS.map(function(s){return '<option>'+s+'</option>';}).join("");
  const isoHoje=HOJE.getFullYear()+"-"+String(HOJE.getMonth()+1).padStart(2,"0")+"-"+String(HOJE.getDate()).padStart(2,"0");
  const defData=(HOJE.getFullYear()===acoAno && HOJE.getMonth()===acoMes)?isoHoje:(acoAno+"-"+String(acoMes+1).padStart(2,"0")+"-01");
  let h='<div class="prd-form"><h4>Registrar perda do açougue</h4><div class="prd-grid" style="grid-template-columns:130px 1.6fr 1.2fr .8fr 1fr auto;">'
    +'<div class="prd-fld"><label>Data</label><input type="date" id="acoNData" value="'+defData+'"></div>'
    +'<div class="prd-fld"><label>Corte / Produto</label><input id="acoNProd" placeholder="Ex: Costela, Picanha, Frango"></div>'
    +'<div class="prd-fld"><label>Motivo</label><select id="acoNMotivo">'+motivoOpts+'</select></div>'
    +'<div class="prd-fld"><label>Qtd (kg)</label><input id="acoNQtd" type="number" min="0" step="0.01" placeholder="0"></div>'
    +'<div class="prd-fld"><label>Valor (R$)</label><input id="acoNValor" type="number" min="0" step="0.01" placeholder="0,00"></div>'
    +'<button class="prd-add" id="acoAddBtn" type="button">Adicionar</button>'
    +'</div></div>';
  if(!itens.length){ h+='<p class="prd-vazio">Nenhuma perda lançada em '+MESES[acoMes]+' '+acoAno+' ainda.</p>'; }
  else {
    h+='<div class="prd-lista-wrap"><table class="prd-lista"><thead><tr><th>Data</th><th>Corte</th><th>Motivo</th><th>Qtd (kg)</th><th>Valor</th><th></th></tr></thead><tbody>';
    itens.forEach(function(r){
      h+='<tr><td>'+r.data.split("-").reverse().join("/")+'</td>'
        +'<td>'+prdEsc(r.produto||"-")+'</td>'
        +'<td>'+prdEsc(r.motivo||"-")+'</td>'
        +'<td class="r">'+num(r.qtd||0)+'</td>'
        +'<td class="val">'+brl(r.valor||0)+'</td>'
        +'<td><button class="prd-rm" data-rm="'+r.id+'" title="Remover">✕</button></td></tr>';
    });
    h+='</tbody></table></div>';
  }
  wrap.innerHTML=h;
}
function acoRenderGraficos(){
  const el=document.getElementById("acoGraficos");
  const itens=acoMesItens();
  if(!itens.length){ el.innerHTML='<div class="prd-graf"><p class="prd-vazio">Nenhuma perda registrada em '+MESES[acoMes]+' '+acoAno+'.<br>Clique em <b>＋ Lançar perda</b> para começar.</p></div>'; return; }
  const porMotivo=prdAgrupa(itens,function(r){return r.motivo;}).map(function(d,i){ return {label:d.k,value:d.v,cor:cores[i%cores.length]}; }).sort(function(a,b){return b.value-a.value;});
  const porCorte=prdAgrupa(itens,function(r){return r.produto;}).map(function(d){ return {label:d.k,value:d.v,cor:"#c0392b"}; }).sort(function(a,b){return b.value-a.value;}).slice(0,10);
  let h='<div class="prd-graf2">';
  h+='<div class="prd-graf"><h3>Perdas por motivo</h3>'+prdBars(porMotivo)+'</div>';
  h+='<div class="prd-graf"><h3>Cortes que mais perdem</h3>'+prdBars(porCorte)+'</div>';
  h+='</div>';
  el.innerHTML=h;
}
function renderAcougue(){
  document.getElementById("acoTitulo").textContent=MESES[acoMes]+" "+acoAno;
  const be=document.getElementById("acoEditar");
  be.classList.toggle("ativo",acoEdit);
  be.innerHTML=acoEdit?"✓ Concluir":"＋ Lançar perda";
  document.getElementById("acoEditWrap").style.display=acoEdit?"":"none";
  acoRenderKpis();
  if(acoEdit) acoRenderEdit();
  acoRenderGraficos();
}
function acoAddFromForm(){
  const data=document.getElementById("acoNData").value;
  const produto=(document.getElementById("acoNProd").value||"").trim();
  const motivo=document.getElementById("acoNMotivo").value;
  const qtd=parseFloat(document.getElementById("acoNQtd").value)||0;
  const valor=parseFloat(document.getElementById("acoNValor").value)||0;
  if(!data){ uiConfirm({titulo:"Aviso",msg:"Informe a data da perda.",ok:"OK",cancel:""}); return; }
  if(!produto && valor===0 && qtd===0){ uiConfirm({titulo:"Aviso",msg:"Preencha pelo menos o corte e o valor (ou a quantidade).",ok:"OK",cancel:""}); return; }
  prdData.push({ id:prdUid(), data:data, produto:produto, setor:"Açougue", motivo:motivo, qtd:qtd, valor:valor, origem:"manual" });
  prdSave();
  renderAcougue();
}
// Cortes do boi (mapa) + perda esperada típica (ajustável depois)
const ACO_CORTES=[
  {n:"Pescoço",p:25},{n:"Acém",p:18},{n:"Paleta",p:20},{n:"Capa de filé",p:14},
  {n:"Filé de costela",p:18},{n:"Filé mignon",p:12},{n:"Contrafilé",p:10},{n:"Picanha",p:8},
  {n:"Alcatra",p:12},{n:"Lagarto",p:8},{n:"Aba de filé",p:15},{n:"Peito",p:22},
  {n:"Ponta de agulha",p:25},{n:"Fraldinha",p:12},{n:"Maminha de alcatra",p:10},{n:"Patinho",p:10},
  {n:"Chã-de-fora",p:9},{n:"Chã-de-dentro",p:8},{n:"Músculo",p:28}
];
function acoRenderMapa(){
  var img=document.getElementById("acoBoiImg"); if(img && !img.src) img.src=ACO_BOI_URI;
  document.getElementById("acoChips").innerHTML=ACO_CORTES.map(function(c,i){
    return '<div class="aco-chip" data-corte="'+prdEsc(c.n)+'"><span class="nm">'+(i+1)+'. '+prdEsc(c.n)+'</span><span class="pp">Perda esperada ~'+c.p+'%</span></div>';
  }).join('');
}
// ----- Desossa / Rendimento -----
function desLoad(){ try{ var s=localStorage.getItem("acougue_desossas"); if(s){var a=JSON.parse(s); if(Array.isArray(a))return a;} }catch(e){} return []; }
let desData=desLoad();
function desSave(){ try{ localStorage.setItem("acougue_desossas",JSON.stringify(desData)); }catch(e){} }
function maskNum(str){ str=String(str).replace(/[^\\d,]/g,""); var p=str.split(","); var i=p[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g,"."); return p.length>1 ? i+","+p.slice(1).join("").slice(0,2) : i; }
function unmaskNum(str){ return parseFloat(String(str).replace(/\\./g,"").replace(",","."))||0; }
function desRenderTabela(){
  document.getElementById("desBody").innerHTML=ACO_CORTES.map(function(c){
    return '<tr><td>'+prdEsc(c.n)+'</td><td><input class="des-kg" type="number" min="0" step="0.01" placeholder="0"></td><td><input class="des-pv" type="number" min="0" step="0.01" placeholder="0,00"></td><td class="des-cr">—</td><td class="des-lk">—</td><td class="des-lt">—</td></tr>';
  }).join('');
}
function desCalc(){
  var peso=unmaskNum(document.getElementById("desPeso").value);
  var custo=unmaskNum(document.getElementById("desCusto").value);
  var rows=document.querySelectorAll("#desBody tr");
  var carne=0, fat=0, dados=[];
  rows.forEach(function(tr){ var kg=parseFloat(tr.querySelector(".des-kg").value)||0; var pv=parseFloat(tr.querySelector(".des-pv").value)||0; carne+=kg; fat+=kg*pv; dados.push({tr:tr,kg:kg,pv:pv}); });
  var custoReal = carne>0 ? custo/carne : 0;
  dados.forEach(function(d){
    var cr=d.tr.querySelector(".des-cr"), lk=d.tr.querySelector(".des-lk"), lt=d.tr.querySelector(".des-lt");
    cr.textContent=(d.kg>0&&carne>0)?brl(custoReal):"—";
    if(d.pv>0&&carne>0){ var lkg=d.pv-custoReal, ltot=lkg*d.kg; lk.textContent=brl(lkg); lk.className="des-lk "+(lkg>=0?"des-pos":"des-neg"); lt.textContent=brl(ltot); lt.className="des-lt "+(ltot>=0?"des-pos":"des-neg"); }
    else { lk.textContent="—"; lk.className="des-lk"; lt.textContent="—"; lt.className="des-lt"; }
  });
  var osso = peso>0 ? Math.max(0,peso-carne) : 0;
  var ossoPct = peso>0 ? osso/peso*100 : 0, rend = peso>0 ? carne/peso*100 : 0, lucro = fat-custo;
  document.getElementById("desFoot").innerHTML = peso>0 ? '<tr class="osso"><td>Osso / perda</td><td>'+num(Math.round(osso*10)/10)+' kg</td><td>'+ossoPct.toFixed(0)+'%</td><td colspan="3"></td></tr>' : '';
  var cards=[
    {v:num(Math.round(carne*10)/10)+" kg",l:"Carne aproveitada"},
    {v:num(Math.round(osso*10)/10)+" kg ("+ossoPct.toFixed(0)+"%)",l:"Osso / perda"},
    {v:rend.toFixed(0)+"%",l:"Rendimento"},
    {v:carne>0?brl(custoReal):"—",l:"Custo real do kg"},
    {v:brl(fat),l:"Faturamento esperado"},
    {v:brl(lucro),l:"Lucro esperado"}
  ];
  document.getElementById("desResumo").innerHTML=cards.map(function(c){return '<div class="kpi"><div class="v">'+c.v+'</div><div class="l">'+c.l+'</div></div>';}).join('');
}
function desSalvar(){
  var peso=unmaskNum(document.getElementById("desPeso").value), custo=unmaskNum(document.getElementById("desCusto").value);
  if(peso<=0||custo<=0){ uiConfirm({titulo:"Aviso",msg:"Preencha o peso e o custo do boi.",ok:"OK",cancel:""}); return; }
  var itens=[], carne=0;
  document.querySelectorAll("#desBody tr").forEach(function(tr,i){ var kg=parseFloat(tr.querySelector(".des-kg").value)||0; var pv=parseFloat(tr.querySelector(".des-pv").value)||0; if(kg>0){ itens.push({n:ACO_CORTES[i].n,kg:kg,pv:pv}); carne+=kg; } });
  if(!itens.length){ uiConfirm({titulo:"Aviso",msg:"Lance pelo menos um corte (kg).",ok:"OK",cancel:""}); return; }
  var iso=HOJE.getFullYear()+"-"+("0"+(HOJE.getMonth()+1)).slice(-2)+"-"+("0"+HOJE.getDate()).slice(-2);
  desData.unshift({id:prdUid(),data:iso,peso:peso,custo:custo,carne:carne,itens:itens});
  desSave(); renderDesHist();
  uiConfirm({titulo:"Salvo",msg:"Desossa registrada com sucesso!",ok:"OK",cancel:""});
}
function renderDesHist(){
  var el=document.getElementById("desHist");
  if(!desData.length){ el.innerHTML=""; return; }
  var h='<h4 style="margin:0 0 8px;font-size:13px;color:#0c5a26;">Desossas registradas</h4><div class="prd-lista-wrap"><table class="prd-lista"><thead><tr><th>Data</th><th>Peso</th><th>Custo</th><th>Carne</th><th>Rendim.</th><th>Custo real/kg</th><th></th></tr></thead><tbody>';
  desData.forEach(function(d){ var rend=d.peso?d.carne/d.peso*100:0, cr=d.carne?d.custo/d.carne:0; h+='<tr><td>'+d.data.split("-").reverse().join("/")+'</td><td class="r">'+num(Math.round(d.peso*10)/10)+' kg</td><td class="r">'+brl(d.custo)+'</td><td class="r">'+num(Math.round(d.carne*10)/10)+' kg</td><td class="r">'+rend.toFixed(0)+'%</td><td class="val">'+brl(cr)+'</td><td><button class="prd-rm" data-desrm="'+d.id+'">✕</button></td></tr>'; });
  h+='</tbody></table></div>'; el.innerHTML=h;
}
(function initAcougue(){
  acoRenderMapa();
  desRenderTabela(); desCalc(); renderDesHist();
  document.getElementById("desBody").addEventListener("input",desCalc);
  ["desPeso","desCusto"].forEach(function(id){ document.getElementById(id).addEventListener("input",function(e){ e.target.value=maskNum(e.target.value); desCalc(); }); });
  document.getElementById("desSalvar").addEventListener("click",desSalvar);
  document.getElementById("desCard").addEventListener("keydown",function(e){
    if(e.key!=="Enter"||e.target.tagName!=="INPUT") return;
    e.preventDefault();
    var inputs=Array.prototype.slice.call(document.querySelectorAll("#desCard input"));
    var i=inputs.indexOf(e.target);
    if(i>=0 && i+1<inputs.length){ inputs[i+1].focus(); if(inputs[i+1].select) inputs[i+1].select(); }
    else e.target.blur();
  });
  document.getElementById("desHist").addEventListener("click",function(e){ var rm=e.target.closest("[data-desrm]"); if(rm){ var id=rm.getAttribute("data-desrm"); uiConfirm({titulo:"Remover",msg:"Apagar esta desossa?",ok:"Remover",cancel:"Cancelar"}).then(function(ok){ if(ok){ desData=desData.filter(function(x){return x.id!==id;}); desSave(); renderDesHist(); } }); } });
  document.getElementById("acoChips").addEventListener("click",function(e){
    var ch=e.target.closest("[data-corte]"); if(!ch) return;
    acoEdit=true; renderAcougue();
    var inp=document.getElementById("acoNProd"); if(inp){ inp.value=ch.getAttribute("data-corte"); inp.focus(); }
    var w=document.getElementById("acoEditWrap"); if(w) w.scrollIntoView({behavior:"smooth",block:"nearest"});
  });
  document.getElementById("acoPrev").addEventListener("click",function(){ acoMes--; if(acoMes<0){acoMes=11;acoAno--;} renderAcougue(); });
  document.getElementById("acoNext").addEventListener("click",function(){ acoMes++; if(acoMes>11){acoMes=0;acoAno++;} renderAcougue(); });
  document.getElementById("acoHoje").addEventListener("click",function(){ acoAno=HOJE.getFullYear(); acoMes=HOJE.getMonth(); renderAcougue(); });
  document.getElementById("acoEditar").addEventListener("click",function(){ acoEdit=!acoEdit; renderAcougue(); });
  const wrap=document.getElementById("acoEditWrap");
  wrap.addEventListener("click",function(e){
    if(e.target.closest("#acoAddBtn")){ acoAddFromForm(); return; }
    const rm=e.target.closest("[data-rm]");
    if(rm){ const id=rm.getAttribute("data-rm"); uiConfirm({titulo:"Remover perda",msg:"Tem certeza que quer apagar este registro?",ok:"Remover",cancel:"Cancelar"}).then(function(ok){ if(ok){ prdData=prdData.filter(function(r){return r.id!==id;}); prdSave(); renderAcougue(); } }); return; }
  });
  wrap.addEventListener("keydown",function(e){ if(e.key==="Enter" && e.target.closest(".prd-form") && e.target.tagName==="INPUT"){ e.preventDefault(); acoAddFromForm(); } });
})();

/* ===== Layout da loja (planta + planograma) ===== */
const LAY_TIPOS={
  gondola:{nome:"Gôndola",w:170,h:46,cor:"#2a9d8f",txt:"#fff"},
  setor:{nome:"SETOR",w:280,h:200,cor:"#e7f0fa",txt:"#33506b",area:true},
  caixa:{nome:"Caixa",w:66,h:50,cor:"#e8820e",txt:"#fff"},
  entrada:{nome:"Entrada",w:108,h:40,cor:"#157a35",txt:"#fff"},
  camara:{nome:"Câmara fria",w:150,h:96,cor:"#0e7c8b",txt:"#fff"},
  parede:{nome:"",w:200,h:14,cor:"#5a6678",txt:"#fff"}
};
const LAY_CORES=["#2a9d8f","#157a35","#e8820e","#c0392b","#7048b6","#0e7c8b","#2a6fb0","#b0398e","#5a6678","#e7f0fa"];
let layZoom=1, layTX=0, layTY=0, laySel=null, layDrag=null, layResize=null, layPan=null, laySeq=0, layCor=LAY_CORES[0];
function layLoad(){ try{ const s=localStorage.getItem("layout_planta"); if(s){ const o=JSON.parse(s); if(o&&o.blocos) return o; } }catch(e){} return {blocos:[]}; }
let layData=layLoad();
function laySave(){ try{ localStorage.setItem("layout_planta", JSON.stringify(layData)); }catch(e){} }
function layUid(){ laySeq++; return "b"+Date.now().toString(36)+laySeq; }
function layEsc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
function layFind(id){ return layData.blocos.find(function(b){ return b.id===id; }); }
function layApplyTransform(){ const inner=document.getElementById("layInner"); if(!inner) return; inner.style.transformOrigin="0 0"; inner.style.transform="translate("+layTX+"px,"+layTY+"px) scale("+layZoom+")"; }
function layBlocoHtml(b){
  const t=LAY_TIPOS[b.tipo]||LAY_TIPOS.gondola;
  const cor=b.cor||t.cor; const txt=(b.cor&&b.cor!=="#e7f0fa")?(t.area?"#33506b":"#fff"):t.txt;
  return '<div class="lay-bloco'+(t.area?" area":"")+(b.id===laySel?" sel":"")+'" data-id="'+b.id+'" style="left:'+b.x+'px;top:'+b.y+'px;width:'+b.w+'px;height:'+b.h+'px;background:'+cor+';color:'+txt+'">'
    +'<span class="lay-txt" data-id="'+b.id+'">'+layEsc(b.texto||"")+'</span>'
    +'<span class="lay-h" data-id="'+b.id+'"></span></div>';
}
function layRender(){
  const inner=document.getElementById("layInner"); if(!inner) return;
  let maxX=1400,maxY=760;
  layData.blocos.forEach(function(b){ if(b.x+b.w+120>maxX)maxX=b.x+b.w+120; if(b.y+b.h+120>maxY)maxY=b.y+b.h+120; });
  inner.style.width=Math.round(maxX)+"px"; inner.style.height=Math.round(maxY)+"px";
  const ord=layData.blocos.slice().sort(function(a,bb){ const aa=(LAY_TIPOS[a.tipo]&&LAY_TIPOS[a.tipo].area)?0:1, bv=(LAY_TIPOS[bb.tipo]&&LAY_TIPOS[bb.tipo].area)?0:1; return aa-bv; });
  inner.innerHTML=ord.map(layBlocoHtml).join("");
  layApplyTransform();
}
function laySetZoom(z, ax, ay){
  const cv=document.querySelector(".lay-canvas"); const old=layZoom;
  layZoom=Math.min(2.4,Math.max(0.3,Math.round(z*100)/100));
  const lbl=document.getElementById("layZoomLbl"); if(lbl) lbl.textContent=Math.round(layZoom*100)+"%";
  if(cv && typeof ax==="number"){ const r=cv.getBoundingClientRect(); const sx=ax-r.left, sy=ay-r.top; const cpx=(sx-layTX)/old, cpy=(sy-layTY)/old; layTX=Math.round(sx-cpx*layZoom); layTY=Math.round(sy-cpy*layZoom); }
  layApplyTransform();
}
function layFitView(){
  const cv=document.querySelector(".lay-canvas"); if(!cv) return;
  if(!layData.blocos.length){ layZoom=1; layTX=0; layTY=0; const lbl=document.getElementById("layZoomLbl"); if(lbl) lbl.textContent="100%"; layApplyTransform(); return; }
  let minX=Infinity,minY=Infinity,maxX=0,maxY=0;
  layData.blocos.forEach(function(b){ if(b.x<minX)minX=b.x; if(b.y<minY)minY=b.y; if(b.x+b.w>maxX)maxX=b.x+b.w; if(b.y+b.h>maxY)maxY=b.y+b.h; });
  const cw=(maxX-minX)||1, ch=(maxY-minY)||1, pad=50;
  let z=Math.min((cv.clientWidth-pad)/cw,(cv.clientHeight-pad)/ch); z=Math.min(2.4,Math.max(0.3,z));
  layZoom=Math.round(z*100)/100;
  const lbl=document.getElementById("layZoomLbl"); if(lbl) lbl.textContent=Math.round(layZoom*100)+"%";
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2;
  layTX=Math.round(cv.clientWidth/2 - cx*layZoom); layTY=Math.round(cv.clientHeight/2 - cy*layZoom);
  layApplyTransform();
}
async function layAdd(tipo){
  const t=LAY_TIPOS[tipo]||LAY_TIPOS.gondola;
  const nome=await uiPrompt({ titulo:"Nomear "+t.nome, msg:"Digite o nome. Você pode mudar depois com duplo-clique.", placeholder:t.nome, valor:t.nome, inputType:"text", icone:"🏷️", ok:"Criar" });
  if(nome===null) return;
  const txt=(nome||"").trim()||t.nome;
  const cv=document.querySelector(".lay-canvas");
  let cx=200, cy=120;
  if(cv){ cx=(cv.clientWidth/2 - layTX)/layZoom - t.w/2; cy=(90 - layTY)/layZoom; }
  const k=layData.blocos.length; cx+=(k%6)*18; cy+=(k%6)*18;
  const b={ id:layUid(), tipo:tipo, x:Math.max(0,Math.round(cx)), y:Math.max(0,Math.round(cy)), w:t.w, h:t.h, texto:txt, cor:t.cor };
  layData.blocos.push(b); laySel=b.id; laySave(); layRender();
}
function layRenameStart(el,b){
  el.setAttribute("contenteditable","true"); el.focus();
  const sel=window.getSelection(), rg=document.createRange(); rg.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(rg);
  let done=false;
  function fin(save){ if(done)return; done=true; el.removeEventListener("blur",ob); el.removeEventListener("keydown",ok); el.removeAttribute("contenteditable");
    if(save){ b.texto=(el.textContent||"").trim(); laySave(); } layRender(); }
  function ob(){ fin(true); }
  function ok(ev){ ev.stopPropagation(); if(ev.key==="Enter"){ ev.preventDefault(); fin(true); } else if(ev.key==="Escape"){ ev.preventDefault(); fin(false); } }
  el.addEventListener("blur",ob); el.addEventListener("keydown",ok);
}
function layUp(){
  const cv=document.querySelector(".lay-canvas");
  if(layPan){ layPan=null; if(cv) cv.style.cursor="crosshair"; }
  if(layResize){ layResize=null; laySave(); layRender(); }
  if(layDrag){ const mv=layDrag.moved; layDrag=null; if(mv){ laySave(); } layRender(); }
}
/* ---- Planograma ---- */
function layPlanoLoad(){ try{ const s=localStorage.getItem("layout_plano"); if(s){ const o=JSON.parse(s); if(o&&o.gondolas&&o.gondolas.length) return o; } }catch(e){} const id="g"+Date.now().toString(36); return {gondolas:[{id:id,nome:"Gôndola 1",prateleiras:[[],[],[],[]]}],ativo:id}; }
let layPlano=layPlanoLoad();
function layPlanoSave(){ try{ localStorage.setItem("layout_plano", JSON.stringify(layPlano)); }catch(e){} }
function layPlanoAtiva(){ return layPlano.gondolas.find(function(g){ return g.id===layPlano.ativo; })||layPlano.gondolas[0]; }
function layPlanoRender(){
  const tabsEl=document.getElementById("layPlanoTabs"); if(!tabsEl) return;
  tabsEl.innerHTML=layPlano.gondolas.map(function(g){ return '<button class="lay-ptab'+(g.id===layPlano.ativo?" on":"")+'" data-g="'+g.id+'">'+layEsc(g.nome)+'</button>'; }).join("");
  const g=layPlanoAtiva(); const area=document.getElementById("layPlanoArea"); if(!area) return;
  if(!g){ area.innerHTML=""; return; }
  let h='<div class="lay-plano-head"><input class="lay-plano-nome" id="layPlanoNome" value="'+layEsc(g.nome)+'"><button class="btn-s" id="layPlanoAddP" type="button">＋ Prateleira</button><button class="btn-s" id="layPlanoDelG" type="button">🗑 Excluir gôndola</button></div>';
  h+='<div class="lay-gondola">';
  g.prateleiras.forEach(function(p,i){
    h+='<div class="lay-prat"><div class="lay-prat-lbl">Prateleira '+(i+1)+'</div><div class="lay-prat-itens">';
    h+=p.map(function(prod,j){ const c=LAY_CORES[j%LAY_CORES.length]; return '<span class="lay-chip" style="background:'+c+'22;color:'+c+'">'+layEsc(prod)+'<b data-rmprod="'+i+'_'+j+'">✕</b></span>'; }).join("");
    h+='<input class="lay-prat-add" data-prat="'+i+'" placeholder="+ produto"><button class="lay-prat-del" data-delprat="'+i+'" title="Remover prateleira">🗑</button>';
    h+='</div></div>';
  });
  h+='</div>';
  area.innerHTML=h;
}
function renderLayout(){ layRender(); layPlanoRender(); }
(function initLayout(){
  const inner=document.getElementById("layInner"); if(!inner) return;
  // paleta de cores
  const cores=document.getElementById("layCores");
  LAY_CORES.forEach(function(c){ const b=document.createElement("button"); b.className="lay-swatch"+(c===layCor?" sel":""); b.style.background=c; b.dataset.cor=c; cores.appendChild(b); });
  cores.addEventListener("click",function(e){ const sw=e.target.closest(".lay-swatch"); if(!sw) return; layCor=sw.dataset.cor; cores.querySelectorAll(".lay-swatch").forEach(function(x){ x.classList.toggle("sel",x===sw); }); if(laySel){ const b=layFind(laySel); if(b){ b.cor=layCor; laySave(); layRender(); } } });
  // sub-abas
  document.querySelectorAll(".lay-subtab").forEach(function(t){ t.addEventListener("click",function(){
    document.querySelectorAll(".lay-subtab").forEach(function(x){ x.classList.toggle("on",x===t); });
    const sub=t.dataset.sub;
    document.getElementById("laySubPlanta").style.display=sub==="planta"?"":"none";
    document.getElementById("laySubPlano").style.display=sub==="plano"?"":"none";
    if(sub==="planta"){ layRender(); layFitView(); } else { layPlanoRender(); }
  }); });
  // botões adicionar
  document.querySelectorAll('#laySubPlanta [data-add]').forEach(function(btn){ btn.addEventListener("click",function(){ layAdd(btn.dataset.add); }); });
  document.getElementById("layZoomIn").addEventListener("click",function(){ const cv=document.querySelector(".lay-canvas"); const r=cv&&cv.getBoundingClientRect(); laySetZoom(layZoom+0.2, r?r.left+r.width/2:undefined, r?r.top+r.height/2:undefined); });
  document.getElementById("layZoomOut").addEventListener("click",function(){ const cv=document.querySelector(".lay-canvas"); const r=cv&&cv.getBoundingClientRect(); laySetZoom(layZoom-0.2, r?r.left+r.width/2:undefined, r?r.top+r.height/2:undefined); });
  document.getElementById("layFit").addEventListener("click", layFitView);
  document.getElementById("layLimpar").addEventListener("click",function(){ uiConfirm({titulo:"Limpar planta",msg:"Apagar toda a planta da loja?",ok:"Limpar",cancel:"Cancelar"}).then(function(ok){ if(ok){ layData={blocos:[]}; laySel=null; laySave(); layRender(); } }); });
  (function(){ const bf=document.getElementById("layFull"); if(!bf) return;
    bf.addEventListener("click",function(){ const c=document.getElementById("layCard"); if(!document.fullscreenElement){ (c.requestFullscreen?c.requestFullscreen():c.webkitRequestFullscreen&&c.webkitRequestFullscreen()); } else { (document.exitFullscreen?document.exitFullscreen():document.webkitExitFullscreen&&document.webkitExitFullscreen()); } });
    document.addEventListener("fullscreenchange",function(){ bf.textContent=document.fullscreenElement?"⛶ Sair":"⛶ Tela cheia"; setTimeout(function(){ layRender(); layFitView(); },80); });
  })();
  // zoom/pan via trackpad
  (function(){ const cv=document.querySelector(".lay-canvas"); if(cv){ cv.addEventListener("wheel",function(e){ e.preventDefault(); if(e.ctrlKey){ window.__trackpad=true; laySetZoom(layZoom*Math.exp(-e.deltaY*0.01), e.clientX, e.clientY); return; } if(e.deltaX!==0){ window.__trackpad=true; layTX-=e.deltaX; layTY-=e.deltaY; layApplyTransform(); return; } if(window.__trackpad){ layTY-=e.deltaY; layApplyTransform(); } else { laySetZoom(layZoom*(e.deltaY<0?1.15:0.87), e.clientX, e.clientY); } }, {passive:false}); } })();
  inner.addEventListener("contextmenu",function(e){ e.preventDefault(); });
  inner.addEventListener("pointerdown",function(e){
    if(e.target&&e.target.isContentEditable) return;
    if(e.button===2){ e.preventDefault(); const cv=document.querySelector(".lay-canvas"); if(cv){ layPan={x:e.clientX,y:e.clientY,tx:layTX,ty:layTY}; cv.style.cursor="grabbing"; } return; }
    if(e.button!==0) return;
    const hd=e.target.closest(".lay-h");
    if(hd){ e.preventDefault(); const b=layFind(hd.dataset.id); if(b){ laySel=b.id; layResize={id:b.id,sx:e.clientX,sy:e.clientY,w0:b.w,h0:b.h}; layRender(); } return; }
    const node=e.target.closest(".lay-bloco");
    if(!node){ if(laySel){ laySel=null; layRender(); } return; }
    const b=layFind(node.dataset.id); if(!b) return;
    laySel=b.id;
    const r=inner.getBoundingClientRect();
    layDrag={ id:b.id, dx:(e.clientX-r.left)/layZoom-b.x, dy:(e.clientY-r.top)/layZoom-b.y, moved:false };
    layRender();
  });
  document.addEventListener("pointermove",function(e){
    if(e.buttons===0 && (layDrag||layResize||layPan)){ layUp(); return; }
    if(layPan){ layTX=layPan.tx+(e.clientX-layPan.x); layTY=layPan.ty+(e.clientY-layPan.y); layApplyTransform(); return; }
    if(layResize){ const b=layFind(layResize.id); if(!b) return; b.w=Math.max(28,Math.round(layResize.w0+(e.clientX-layResize.sx)/layZoom)); b.h=Math.max(12,Math.round(layResize.h0+(e.clientY-layResize.sy)/layZoom)); const el=inner.querySelector('.lay-bloco[data-id="'+b.id+'"]'); if(el){ el.style.width=b.w+"px"; el.style.height=b.h+"px"; } return; }
    if(layDrag){ const b=layFind(layDrag.id); if(!b) return; const r=inner.getBoundingClientRect(); const nx=Math.max(0,Math.round((e.clientX-r.left)/layZoom-layDrag.dx)), ny=Math.max(0,Math.round((e.clientY-r.top)/layZoom-layDrag.dy)); if(Math.abs(nx-b.x)>2||Math.abs(ny-b.y)>2) layDrag.moved=true; b.x=nx; b.y=ny; const el=inner.querySelector('.lay-bloco[data-id="'+b.id+'"]'); if(el){ el.style.left=nx+"px"; el.style.top=ny+"px"; } return; }
  });
  document.addEventListener("pointerup", layUp);
  inner.addEventListener("dblclick",function(e){ const t=e.target.closest(".lay-txt"); if(!t) return; const b=layFind(t.dataset.id); if(b) layRenameStart(t,b); });
  document.addEventListener("keydown",function(e){
    const page=document.getElementById("page-layout"); if(!page||!page.classList.contains("ativo")) return;
    const tag=(document.activeElement&&document.activeElement.tagName)||""; if(tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA"||(document.activeElement&&document.activeElement.isContentEditable)) return;
    if((e.key==="Delete"||e.key==="Backspace")&&laySel){ e.preventDefault(); layData.blocos=layData.blocos.filter(function(b){ return b.id!==laySel; }); laySel=null; laySave(); layRender(); }
  });
  // planograma eventos
  document.getElementById("layPlanoAddG").addEventListener("click",function(){ const id="g"+Date.now().toString(36); layPlano.gondolas.push({id:id,nome:"Gôndola "+(layPlano.gondolas.length+1),prateleiras:[[],[],[],[]]}); layPlano.ativo=id; layPlanoSave(); layPlanoRender(); });
  document.getElementById("layPlanoTabs").addEventListener("click",function(e){ const t=e.target.closest(".lay-ptab"); if(!t) return; layPlano.ativo=t.dataset.g; layPlanoSave(); layPlanoRender(); });
  const parea=document.getElementById("layPlanoArea");
  parea.addEventListener("click",function(e){
    const g=layPlanoAtiva(); if(!g) return;
    if(e.target.closest("#layPlanoAddP")){ g.prateleiras.push([]); layPlanoSave(); layPlanoRender(); return; }
    if(e.target.closest("#layPlanoDelG")){ if(layPlano.gondolas.length<=1){ uiConfirm({titulo:"Aviso",msg:"Deixe pelo menos uma gôndola.",ok:"OK",cancel:""}); return; } uiConfirm({titulo:"Excluir gôndola",msg:'Apagar "'+g.nome+'"?',ok:"Excluir",cancel:"Cancelar"}).then(function(ok){ if(ok){ layPlano.gondolas=layPlano.gondolas.filter(function(x){ return x.id!==g.id; }); layPlano.ativo=layPlano.gondolas[0].id; layPlanoSave(); layPlanoRender(); } }); return; }
    const rmp=e.target.closest("[data-rmprod]"); if(rmp){ const pp=rmp.getAttribute("data-rmprod").split("_"); g.prateleiras[+pp[0]].splice(+pp[1],1); layPlanoSave(); layPlanoRender(); return; }
    const dp=e.target.closest("[data-delprat]"); if(dp){ if(g.prateleiras.length<=1){ uiConfirm({titulo:"Aviso",msg:"Deixe pelo menos uma prateleira.",ok:"OK",cancel:""}); return; } g.prateleiras.splice(+dp.getAttribute("data-delprat"),1); layPlanoSave(); layPlanoRender(); return; }
  });
  parea.addEventListener("keydown",function(e){ if(e.key!=="Enter") return; const inp=e.target.closest(".lay-prat-add"); if(!inp) return; e.preventDefault(); const v=(inp.value||"").trim(); if(!v) return; const g=layPlanoAtiva(); if(!g) return; g.prateleiras[+inp.dataset.prat].push(v); layPlanoSave(); layPlanoRender(); });
  parea.addEventListener("change",function(e){ const nm=e.target.closest("#layPlanoNome"); if(!nm) return; const g=layPlanoAtiva(); if(g){ g.nome=(nm.value||"").trim()||"Gôndola"; layPlanoSave(); layPlanoRender(); } });
})();

// ---- Férias dos funcionários ----
let feriasDados = (function(){ try{ return JSON.parse(localStorage.getItem("ferias_dados")||"[]"); }catch(e){ return []; } })();
let ferEditId = null;
function feriasSave(){ try{ localStorage.setItem("ferias_dados", JSON.stringify(feriasDados)); }catch(e){} }
function ferUid(){ return "f"+(HOJE.getTime())+Math.floor(performance.now()*1000)+feriasDados.length; }
function ferD(s){ if(!/^\\d{4}-\\d{2}-\\d{2}\$/.test(s||"")) return null; var p=s.split("-"); return new Date(+p[0],+p[1]-1,+p[2]); }
function ferStatus(f){ var i=ferD(f.inicio), fm=ferD(f.fim); if(!i||!fm) return "agendada"; if(HOJE>=i&&HOJE<=fm) return "ferias"; if(i>HOJE) return "agendada"; return "concluida"; }
function ferDias(f){ var i=ferD(f.inicio), fm=ferD(f.fim); if(!i||!fm) return 0; return Math.round((fm-i)/86400000)+1; }
function ferBadge(f){ var s=ferStatus(f); if(s==="ferias") return '<span class="fer-badge fer-b-ferias">EM FÉRIAS</span>'; if(s==="agendada") return '<span class="fer-badge fer-b-agendada">AGENDADA</span>'; return '<span class="fer-badge fer-b-concluida">CONCLUÍDA</span>'; }
function ferNoDia(dt){ // dt = Date; retorna nomes de quem está de férias nesse dia
  return feriasDados.filter(function(f){ var i=ferD(f.inicio), fm=ferD(f.fim); return i&&fm&&dt>=i&&dt<=fm; });
}
function ferPreencheLista(){
  var vistos={}, opts="";
  (roster||[]).forEach(function(c){ var n=(c.nome||"").trim(); if(n&&n!=="(vaga)"&&!vistos[n]){ vistos[n]=1; opts+='<option value="'+pxEsc(n)+'"></option>'; } });
  var dl=document.getElementById("ferFuncList"); if(dl) dl.innerHTML=opts;
}
function ferConsultaRender(){
  var inp=document.getElementById("ferConsultaDia"); if(!inp) return;
  var dt=ferD(inp.value); var box=document.getElementById("ferConsultaResultado");
  if(!dt){ box.innerHTML='<div class="fer-vazio">Escolha um dia acima.</div>'; return; }
  var lista=ferNoDia(dt);
  var dataFmt=pxFmtData(inp.value);
  if(!lista.length){ box.innerHTML='<div class="fer-chip" style="background:#eef1f5;border-color:#dfe4ea;color:#56606d;"><span class="ico">✅</span> Ninguém de férias em '+dataFmt+'</div>'; return; }
  box.innerHTML='<p style="margin:0 0 8px;color:#46535f;font-size:13.5px;"><b>'+lista.length+'</b> de férias em '+dataFmt+':</p>'+
    lista.map(function(f){ return '<span class="fer-chip"><span class="ico">🏖️</span>'+pxEsc(f.nome)+' <span style="color:#8a97a8;font-weight:500;">(até '+pxFmtData(f.fim)+')</span></span>'; }).join("");
}
function renderFerias(){
  ferPreencheLista();
  // KPIs
  var hojeFer=feriasDados.filter(function(f){ return ferStatus(f)==="ferias"; }).length;
  var agendadas=feriasDados.filter(function(f){ return ferStatus(f)==="agendada"; }).length;
  var total=feriasDados.length;
  document.getElementById("ferKpis").innerHTML=
    '<div class="kpi"><div class="v">'+hojeFer+'</div><div class="l">De férias hoje</div></div>'+
    '<div class="kpi"><div class="v">'+agendadas+'</div><div class="l">Agendadas (futuras)</div></div>'+
    '<div class="kpi"><div class="v">'+total+'</div><div class="l">Total cadastradas</div></div>';
  // tabela ordenada: em férias primeiro, depois agendadas (por início), depois concluídas (mais recentes)
  var ordem={ferias:0,agendada:1,concluida:2};
  var lista=feriasDados.slice().sort(function(a,b){ var d=ordem[ferStatus(a)]-ordem[ferStatus(b)]; if(d) return d; return (a.inicio||"").localeCompare(b.inicio||""); });
  if(!lista.length){ document.getElementById("ferTabela").innerHTML='<div class="fer-vazio">Nenhuma férias cadastrada ainda. Use o formulário acima.</div>'; }
  else {
    document.getElementById("ferTabela").innerHTML='<table><thead><tr><th>Funcionário</th><th>Início</th><th>Fim</th><th>Dias</th><th>Situação</th><th>Obs.</th><th></th></tr></thead><tbody>'+
      lista.map(function(f){ return '<tr><td><b>'+pxEsc(f.nome)+'</b></td><td>'+pxFmtData(f.inicio)+'</td><td>'+pxFmtData(f.fim)+'</td><td>'+ferDias(f)+'</td><td>'+ferBadge(f)+'</td><td>'+pxEsc(f.obs||"")+'</td>'+
        '<td class="acoes"><span class="esc-nome" data-feredit="'+f.id+'">editar</span> &nbsp; <span class="fer-del" data-ferdel="'+f.id+'">excluir</span></td></tr>'; }).join("")+
      '</tbody></table>';
  }
  ferConsultaRender();
}
function ferLimparForm(){ ["ferNome","ferIni","ferFim","ferObs"].forEach(function(id){ document.getElementById(id).value=""; }); ferEditId=null; document.getElementById("ferSalvar").textContent="Adicionar"; document.getElementById("ferCancelar").style.display="none"; document.getElementById("ferMsg").style.display="none"; }
(function(){
  var sb=document.getElementById("ferSalvar"); if(!sb) return;
  sb.addEventListener("click", function(){
    var nome=document.getElementById("ferNome").value.trim();
    var ini=document.getElementById("ferIni").value, fim=document.getElementById("ferFim").value, obs=document.getElementById("ferObs").value.trim();
    var msg=document.getElementById("ferMsg");
    function erro(t){ msg.textContent=t; msg.style.display="block"; }
    if(!nome){ return erro("Digite o nome do funcionário."); }
    if(!ferD(ini)||!ferD(fim)){ return erro("Preencha as datas de início e fim."); }
    if(ferD(fim)<ferD(ini)){ return erro("A data de fim não pode ser antes do início."); }
    if(ferEditId){ var f=feriasDados.find(function(x){ return x.id===ferEditId; }); if(f){ f.nome=nome; f.inicio=ini; f.fim=fim; f.obs=obs; } }
    else { feriasDados.push({id:ferUid(),nome:nome,inicio:ini,fim:fim,obs:obs}); }
    feriasSave(); ferLimparForm(); renderFerias();
  });
  document.getElementById("ferCancelar").addEventListener("click", ferLimparForm);
  document.getElementById("ferConsultaDia").addEventListener("change", ferConsultaRender);
  document.getElementById("ferTabela").addEventListener("click", function(e){
    var ed=e.target.closest("[data-feredit]"); var dl=e.target.closest("[data-ferdel]");
    if(ed){ var f=feriasDados.find(function(x){ return x.id===ed.dataset.feredit; }); if(f){ document.getElementById("ferNome").value=f.nome||""; document.getElementById("ferIni").value=f.inicio||""; document.getElementById("ferFim").value=f.fim||""; document.getElementById("ferObs").value=f.obs||""; ferEditId=f.id; document.getElementById("ferSalvar").textContent="Salvar"; document.getElementById("ferCancelar").style.display=""; window.scrollTo(0,document.getElementById("page-ferias").offsetTop); } return; }
    if(dl){ var alvo=feriasDados.find(function(x){ return x.id===dl.dataset.ferdel; }); uiConfirm({titulo:"Excluir férias",msg:"Remover as férias de "+((alvo&&alvo.nome)||"")+"?",ok:"Remover",cancel:"Cancelar"}).then(function(sim){ if(!sim) return; feriasDados=feriasDados.filter(function(x){ return x.id!==dl.dataset.ferdel; }); feriasSave(); renderFerias(); }); return; }
  });
})();

// ---- Negociações (produtos negociados pra o comprador lançar no sistema) ----
let negDados = (function(){ try{ return JSON.parse(localStorage.getItem("negociacoes_dados")||"[]"); }catch(e){ return []; } })();
let negEditId = null;
function negSave(){ try{ localStorage.setItem("negociacoes_dados", JSON.stringify(negDados)); }catch(e){} }
function negUid(){ return "n"+(HOJE.getTime())+Math.floor(performance.now()*1000)+negDados.length; }
function negBadgeHtml(n){ return n.status==="lancado" ? '<span class="neg-badge neg-b-lancado">LANÇADO</span>' : '<span class="neg-badge neg-b-pendente">PENDENTE</span>'; }
function negAtualizaBadge(){
  var b=document.getElementById("negNavBadge"); if(!b) return;
  var pend=negDados.filter(function(n){ return n.status!=="lancado"; }).length;
  if(pend>0){ b.textContent=pend; b.title=pend+" negociação(ões) pendente(s) de lançamento"; b.style.display=""; }
  else { b.style.display="none"; }
}
function renderNegociar(){
  var pend=negDados.filter(function(n){ return n.status!=="lancado"; }).length;
  var lanc=negDados.filter(function(n){ return n.status==="lancado"; }).length;
  document.getElementById("negKpis").innerHTML=
    '<div class="kpi"><div class="v">'+pend+'</div><div class="l">Pendentes (lançar)</div></div>'+
    '<div class="kpi"><div class="v">'+lanc+'</div><div class="l">Já lançados</div></div>'+
    '<div class="kpi"><div class="v">'+negDados.length+'</div><div class="l">Total</div></div>';
  // pendentes primeiro
  var lista=negDados.slice().sort(function(a,b){ var pa=a.status==="lancado"?1:0, pb=b.status==="lancado"?1:0; return pa-pb; });
  if(!lista.length){ document.getElementById("negTabela").innerHTML='<div class="neg-vazio">Nenhuma negociação anotada ainda. Use o formulário acima.</div>'; }
  else {
    document.getElementById("negTabela").innerHTML='<table><thead><tr><th>Produto</th><th>Fornecedor</th><th>Preço / condição</th><th>Qtd.</th><th>Obs.</th><th>Situação</th><th></th></tr></thead><tbody>'+
      lista.map(function(n){
        var acao = n.status==="lancado"
          ? '<button class="neg-reabrir" data-negreabrir="'+n.id+'">↩ Reabrir</button>'
          : '<button class="neg-mark" data-neglancar="'+n.id+'">✓ Lançado</button>';
        return '<tr><td><b>'+pxEsc(n.produto)+'</b></td><td>'+pxEsc(n.fornecedor||"")+'</td><td>'+pxEsc(n.preco||"")+'</td><td>'+pxEsc(n.qtd||"")+'</td><td>'+pxEsc(n.obs||"")+'</td><td>'+negBadgeHtml(n)+'</td>'+
          '<td class="acoes">'+acao+' &nbsp; <span class="esc-nome" data-negedit="'+n.id+'">editar</span> &nbsp; <span class="neg-del" data-negdel="'+n.id+'">excluir</span></td></tr>';
      }).join("")+'</tbody></table>';
  }
  negAtualizaBadge();
}
function negLimparForm(){ ["negProd","negForn","negPreco","negQtd","negObs"].forEach(function(id){ document.getElementById(id).value=""; }); negEditId=null; document.getElementById("negSalvar").textContent="Adicionar"; document.getElementById("negCancelar").style.display="none"; document.getElementById("negMsg").style.display="none"; }
(function(){
  var sb=document.getElementById("negSalvar"); if(!sb) return;
  sb.addEventListener("click", function(){
    var produto=document.getElementById("negProd").value.trim();
    var msg=document.getElementById("negMsg");
    if(!produto){ msg.textContent="Digite pelo menos o produto."; msg.style.display="block"; return; }
    var dados={ produto:produto, fornecedor:document.getElementById("negForn").value.trim(), preco:document.getElementById("negPreco").value.trim(), qtd:document.getElementById("negQtd").value.trim(), obs:document.getElementById("negObs").value.trim() };
    if(negEditId){ var n=negDados.find(function(x){ return x.id===negEditId; }); if(n){ Object.assign(n,dados); } }
    else { negDados.push(Object.assign({id:negUid(),status:"pendente"},dados)); }
    negSave(); negLimparForm(); renderNegociar();
  });
  document.getElementById("negCancelar").addEventListener("click", negLimparForm);
  document.getElementById("negTabela").addEventListener("click", function(e){
    var la=e.target.closest("[data-neglancar]"), re=e.target.closest("[data-negreabrir]"), ed=e.target.closest("[data-negedit]"), dl=e.target.closest("[data-negdel]");
    if(la){ var n1=negDados.find(function(x){ return x.id===la.dataset.neglancar; }); if(n1){ n1.status="lancado"; negSave(); renderNegociar(); } return; }
    if(re){ var n2=negDados.find(function(x){ return x.id===re.dataset.negreabrir; }); if(n2){ n2.status="pendente"; negSave(); renderNegociar(); } return; }
    if(ed){ var n3=negDados.find(function(x){ return x.id===ed.dataset.negedit; }); if(n3){ document.getElementById("negProd").value=n3.produto||""; document.getElementById("negForn").value=n3.fornecedor||""; document.getElementById("negPreco").value=n3.preco||""; document.getElementById("negQtd").value=n3.qtd||""; document.getElementById("negObs").value=n3.obs||""; negEditId=n3.id; document.getElementById("negSalvar").textContent="Salvar"; document.getElementById("negCancelar").style.display=""; window.scrollTo(0,document.getElementById("page-negociar").offsetTop); } return; }
    if(dl){ var alvo=negDados.find(function(x){ return x.id===dl.dataset.negdel; }); uiConfirm({titulo:"Excluir negociação",msg:"Remover a negociação de "+((alvo&&alvo.produto)||"")+"?",ok:"Remover",cancel:"Cancelar"}).then(function(sim){ if(!sim) return; negDados=negDados.filter(function(x){ return x.id!==dl.dataset.negdel; }); negSave(); renderNegociar(); }); return; }
  });
})();

// ---- Calendário de Operação (contagem regressiva das campanhas, do Calendário Comercial) ----
function renderOperacao(){
  var OP_STEP={ "Negociação":{i:"🤝",c:"#7048b6"}, "Pedido":{i:"📦",c:"#e8590c"}, "Aprovação":{i:"✅",c:"#1b9e4b"}, "Recebimento":{i:"🚚",c:"#2a9d8f"}, "Montagem":{i:"🛠️",c:"#e8a800"}, "Encartes":{i:"📰",c:"#0c8599"}, "Divulgação":{i:"📣",c:"#d6336c"}, "Análise":{i:"📊",c:"#495057"}, "Reunião":{i:"👥",c:"#1c7ed6"} };
  var diasSemana=["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];
  function iso(d){ return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2); }
  function chip(t){ var s=OP_STEP[t[0]]||{i:"•",c:"#888"}; return '<span class="op-task" style="border-left-color:'+s.c+'"><b>'+s.i+' '+t[0]+'</b> '+pxEsc(t[1])+'</span>'; }
  var hojeD=new Date(HOJE.getFullYear(),HOJE.getMonth(),HOJE.getDate());
  var hojeT=OPERACAO[iso(hojeD)]||[];
  document.getElementById("opHojeTitulo").textContent="Para fazer HOJE ("+diasSemana[hojeD.getDay()]+", "+("0"+hojeD.getDate()).slice(-2)+"/"+("0"+(hojeD.getMonth()+1)).slice(-2)+")";
  document.getElementById("opHoje").innerHTML = hojeT.length ? hojeT.map(chip).join('') : '<div class="op-vazio">Nada programado para hoje. 🎉</div>';
  var html='';
  for(var k=1;k<=14;k++){
    var d=new Date(hojeD); d.setDate(d.getDate()+k);
    var t=OPERACAO[iso(d)];
    if(t&&t.length){ html+='<div class="op-dia"><div class="op-dia-h">'+diasSemana[d.getDay()]+', '+("0"+d.getDate()).slice(-2)+'/'+("0"+(d.getMonth()+1)).slice(-2)+'</div>'+t.map(chip).join('')+'</div>'; }
  }
  document.getElementById("opProximos").innerHTML = html || '<div class="op-vazio">Nada programado nos próximos 14 dias.</div>';
}
function opAtualizaBadge(){
  var b=document.getElementById("opNavBadge"); if(!b) return;
  try{
    var d=new Date(HOJE.getFullYear(),HOJE.getMonth(),HOJE.getDate());
    var iso=d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
    var n=(OPERACAO[iso]||[]).length;
    if(n>0){ b.textContent=n; b.title=n+" tarefa(s) de operação para hoje"; b.style.display=""; } else { b.style.display="none"; }
  }catch(e){}
}

document.querySelectorAll(".nav-item").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".nav-item").forEach(b=>b.classList.remove("ativo"));
    document.querySelectorAll(".page").forEach(p=>p.classList.remove("ativo"));
    btn.classList.add("ativo");
    document.getElementById("page-"+btn.dataset.page).classList.add("ativo");
    if(btn.dataset.page==="calendario"){ calAno=HOJE.getFullYear(); calMes=HOJE.getMonth(); setView("ano"); }
    if(btn.dataset.page==="organograma"){ renderOrg(); orgCenterView(); }
    if(btn.dataset.page==="fluxograma") renderFlux();
    if(btn.dataset.page==="layout"){ renderLayout(); layFitView(); }
    if(btn.dataset.page==="perdas") renderPerdas();
    if(btn.dataset.page==="acougue") renderAcougue();
    if(btn.dataset.page==="escala") voltarSetores();
    if(btn.dataset.page==="entregas") renderEntregas();
    if(btn.dataset.page==="ferias"){ if(!document.getElementById("ferConsultaDia").value){ document.getElementById("ferConsultaDia").value=HOJE.getFullYear()+"-"+("0"+(HOJE.getMonth()+1)).slice(-2)+"-"+("0"+HOJE.getDate()).slice(-2); } renderFerias(); }
    if(btn.dataset.page==="negociar") renderNegociar();
    if(btn.dataset.page==="analise") renderAnalise();
    try{ localStorage.setItem("ui_pagina_atual", btn.dataset.page); }catch(e){}
    window.scrollTo(0,0);
  });
});

// Abertura normal (ou Cmd+R) = sempre no dia de hoje (DATA_MAX em "de" e "ate").
// Exceção: se o usuário clicou em "Pesquisar", restaura a data/filtro que ele escolheu
// (a página recarregou pra trazer os dados frescos, mas mantendo o filtro).
(function(){ try{
  const f=JSON.parse(sessionStorage.getItem("vendas_pesquisar")||"null");
  if(f){
    sessionStorage.removeItem("vendas_pesquisar");
    if(f.de) document.getElementById("de").value=f.de;
    if(f.ate) document.getElementById("ate").value=f.ate;
    document.getElementById("cod").value=f.cod||"";
    document.getElementById("nome").value=f.nome||"";
  }
}catch(e){} })();

render();
try{ pxAtualizaBadge(); }catch(e){}
try{ negAtualizaBadge(); }catch(e){}

// Restaura a última página aberta após recarregar (Cmd+R) e sempre vai pro topo
(function(){
  try{ if("scrollRestoration" in history) history.scrollRestoration="manual"; }catch(e){}
  try{
    const pg=localStorage.getItem("ui_pagina_atual");
    if(pg && pg!=="vendas"){
      const b=document.querySelector('.nav-item[data-page="'+pg+'"]');
      if(b) b.click();
    }
  }catch(e){}
  window.scrollTo(0,0);
})();
</script>
</body></html>`;

await mkdir("output", { recursive: true });
const finalHtml = html.replace("</head>", () => "<script>" + qrcodeLib + "</script>\n</head>");
await writeFile("output/index.html", finalHtml);
console.log("OK -> output/index.html (painel com dados reais do VR)");
