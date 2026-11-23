import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { CampoOut, ValorCampo } from "@/lib/faturamento";

/** Mesmo motor de backend/app/modules/faturamento/titulo_caso.py (só para a prévia: quem grava é o servidor). */

export interface ModeloTituloOut {
  tomador_id: number;
  modelo_titulo_caso: string | null;
  /** texto da NFS-e deste cliente; null = segue Configurações › Automações */
  nota_titulo_caso: boolean | null;
  nota_texto_regra: boolean | null;
  /** ao faturar: null/contrato = tudo numa nota · caso = uma por caso · cobranca = uma por cobrança */
  fatura_agrupamento: "contrato" | "caso" | "cobranca" | null;
  /** rótulos dos campos padrão que podem ir entre chaves */
  padrao: string[];
  atualizados: number;
}

export function useModeloCaso(tomadorId: number | null | undefined) {
  return useQuery({
    queryKey: ["fat", "modelo-caso", tomadorId],
    queryFn: () =>
      api.get<ModeloTituloOut>(
        `/faturamento/clientes/${tomadorId}/modelo-caso`,
      ),
    enabled: !!tomadorId,
    staleTime: 30_000,
  });
}

/** Rótulo de cada campo padrão (o que vai entre chaves). */
export const PADRAO_TITULO: Record<string, string> = {
  numero: "Nº do caso",
  processo: "Processo",
  parte_contraria: "Parte contrária",
  tipo: "Tipo",
  area: "Área",
  tribunal: "Tribunal",
  vara: "Vara",
  comarca: "Comarca",
  valor_causa: "Valor da causa",
  data_distribuicao: "Distribuição",
  cliente: "Cliente",
  contrato: "Contrato",
};

const SEP = "-–—|/·,;:";
const esc = SEP.replace(/[-\\^\]]/g, "\\$&");

function norm(s: string) {
  return (s ?? "")
    .replace(/[º°ª]/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function fmt(v: ValorCampo | undefined): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s))
    return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  return s;
}

/** Monta o título. `padrao` usa as chaves de PADRAO_TITULO; `valores` são os campos adicionais por id. */
export function renderTitulo(
  modelo: string,
  padrao: Partial<Record<string, string | null | undefined>>,
  campos: CampoOut[],
  valores: Record<string, ValorCampo>,
) {
  const mapa = new Map<string, string>();
  for (const [k, rot] of Object.entries(PADRAO_TITULO)) {
    mapa.set(norm(rot), padrao[k] ?? "");
    mapa.set(norm(k), padrao[k] ?? "");
  }
  // campo do cliente vence o geral de mesmo nome
  for (const c of [...campos].sort(
    (a, b) => Number(!!a.tomador_id) - Number(!!b.tomador_id),
  ))
    mapa.set(norm(c.nome), fmt(valores[String(c.id)]));
  let t = (modelo ?? "").replace(
    /\{([^{}]{1,100})\}/g,
    (_, nome: string) => mapa.get(norm(nome)) ?? "",
  );
  t = t.replace(new RegExp(`\\s*([${esc}])(\\s*[${esc}])+\\s*`, "g"), " $1 ");
  t = t.replace(/\(\s*\)|\[\s*\]/g, "").replace(/\s{2,}/g, " ");
  t = t.replace(new RegExp(`^[\\s${esc}]+|[\\s${esc}]+$`, "g"), "");
  return t.slice(0, 250);
}
