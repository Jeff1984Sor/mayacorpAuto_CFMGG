"use client";

import { Mono } from "@/components/mayacorp/brand";
import { StatusBadge } from "@/components/mayacorp/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { dataHora } from "@/lib/format";
import type { UsoCertificado } from "@/lib/tribunais-protocolo";

/** Cor da validade do certificado: alerta em 30, 15 e 7 dias. */
export function tomValidade(dias: number): "success" | "info" | "warning" | "danger" {
  if (dias <= 7) return "danger";
  if (dias <= 15) return "warning";
  if (dias <= 30) return "info";
  return "success";
}

export const ROTULO_ACAO_USO: Record<string, string> = {
  login: "Acesso ao tribunal",
  consulta: "Consulta",
  download: "Download de documento",
  assinatura: "Assinatura",
  protocolo: "Protocolo",
};

const RESULTADO: Record<string, [string, "success" | "danger" | "warning" | "neutral"]> = {
  ok: ["OK", "success"],
  erro: ["Erro", "danger"],
  simulado: ["Simulado", "warning"],
  negado: ["Negado", "danger"],
};

export function TabelaUso({ itens, carregando, comUsuario = true }: { itens: UsoCertificado[]; carregando?: boolean; comUsuario?: boolean }) {
  if (carregando) return <Skeleton className="h-32" />;
  if (itens.length === 0) return <p className="p-6 text-center text-sm text-muted-foreground">O certificado ainda não foi usado.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5 font-medium">Quando</th>
            <th className="px-3 py-2.5 font-medium">Ação</th>
            <th className="px-3 py-2.5 font-medium">Tribunal</th>
            <th className="hidden px-3 py-2.5 font-medium md:table-cell">Referência</th>
            {comUsuario && <th className="hidden px-3 py-2.5 font-medium md:table-cell">Disparado por</th>}
            <th className="px-3 py-2.5 font-medium">Resultado</th>
            <th className="hidden px-3 py-2.5 font-medium lg:table-cell">IP</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {itens.map((u) => (
            <tr key={u.id}>
              <td className="px-4 py-2.5 whitespace-nowrap">
                <Mono>{dataHora(u.data_hora)}</Mono>
              </td>
              <td className="px-3 py-2.5">
                {ROTULO_ACAO_USO[u.acao] ?? u.acao}
                {u.aprovacao_humana_id && <span className="ml-1 text-[11px] text-success-ink">· aprovado pelo advogado</span>}
              </td>
              <td className="px-3 py-2.5">{u.tribunal ?? "—"}</td>
              <td className="hidden max-w-56 truncate px-3 py-2.5 font-mono text-xs text-muted-foreground md:table-cell">{u.referencia ?? "—"}</td>
              {comUsuario && <td className="hidden px-3 py-2.5 text-muted-foreground md:table-cell">{u.usuario}</td>}
              <td className="px-3 py-2.5">
                <StatusBadge label={(RESULTADO[u.resultado ?? ""] ?? [u.resultado ?? "—"])[0]} tom={(RESULTADO[u.resultado ?? ""] ?? ["", "neutral"])[1]} />
                {u.detalhe && <p className="mt-0.5 max-w-56 truncate text-[11px] text-muted-foreground" title={u.detalhe}>{u.detalhe}</p>}
              </td>
              <td className="hidden px-3 py-2.5 font-mono text-xs text-muted-foreground lg:table-cell">{u.ip_origem ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

