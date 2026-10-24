"use client";

import { AlertTriangle, CheckCircle2, FileSearch, Sparkles, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Mono } from "@/components/mayacorp/brand";
import { SearchInput, Segmented } from "@/components/mayacorp/data-table";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { data, documento, moeda } from "@/lib/format";
import type { RpsOut } from "@/lib/types";
import { cn } from "@/lib/utils";

export type FiltroRps = "todos" | "ok" | "aviso" | "erro";

const grupo = (r: RpsOut): FiltroRps | "outro" =>
  r.status === "erro" || r.status === "rejeitado"
    ? "erro"
    : r.status === "aviso" || r.tomador_novo
      ? "aviso"
      : r.status === "ok" || r.status === "emitido"
        ? "ok"
        : "outro";

function StatusLinha({ r }: { r: RpsOut }) {
  if (r.status === "erro" || r.status === "rejeitado") {
    const msg = r.erros.find((e) => e.nivel === "erro")?.mensagem ?? "Com erro";
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex max-w-56 items-center gap-1.5 text-sm text-danger-ink" />}>
          <XCircle className="size-4 shrink-0" />
          <span className="truncate">{msg}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{r.erros.map((e) => e.mensagem).join(" · ")}</TooltipContent>
      </Tooltip>
    );
  }
  if (r.status === "emitido")
    return r.nfse_id ? (
      <Link href={`/nfse/notas/${r.nfse_id}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
        <StatusBadge status="emitido" label={`NFS-e ${r.nfse_numero}`} />
      </Link>
    ) : (
      <StatusBadge status="emitido" />
    );
  if (r.status === "aviso" || r.tomador_novo) {
    const msg = r.erros.find((e) => e.nivel === "aviso")?.mensagem ?? "Tomador novo";
    return (
      <span className="inline-flex max-w-56 items-center gap-1.5 text-sm text-warning-ink">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="truncate">{msg}</span>
      </span>
    );
  }
  if (r.status === "ok")
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-success-ink">
        <CheckCircle2 className="size-4" /> OK
      </span>
    );
  return <StatusBadge status={r.status} />;
}

export function RpsTable({
  rps,
  selecionavel,
  onToggle,
  onToggleTodos,
  onAbrir,
  className,
  destaque,
  onLimparDestaque,
  acaoNota,
}: {
  rps: RpsOut[];
  /** Linhas apontadas por um insight do Raio-X: a tabela mostra só elas, com anel indigo. */
  destaque?: { titulo: string; ids: number[] } | null;
  onLimparDestaque?: () => void;
  /** Ação extra ao lado do status das linhas já emitidas (ex.: enviar a nota por e-mail). */
  acaoNota?: (r: RpsOut) => React.ReactNode;
  selecionavel?: boolean;
  onToggle?: (r: RpsOut, v: boolean) => void;
  onToggleTodos?: (v: boolean, filtro: FiltroRps) => void;
  onAbrir?: (r: RpsOut) => void;
  className?: string;
}) {
  const [filtro, setFiltro] = useState<FiltroRps>("todos");
  const [q, setQ] = useState("");
  const [foco, setFoco] = useState(0);
  const corpo = useRef<HTMLTableSectionElement>(null);

  const visiveis = useMemo(() => rps.filter((r) => r.status !== "descartado"), [rps]);
  const contagem = useMemo(() => {
    const c = { todos: visiveis.length, ok: 0, aviso: 0, erro: 0 };
    visiveis.forEach((r) => {
      const g = grupo(r);
      if (g !== "outro") c[g]++;
    });
    return c;
  }, [visiveis]);

  const idsDestaque = useMemo(() => (destaque ? new Set(destaque.ids) : null), [destaque]);
  const linhas = useMemo(() => {
    const termo = q.trim().toLowerCase();
    const dig = termo.replace(/\D/g, "");
    return visiveis.filter((r) => {
      if (idsDestaque) return idsDestaque.has(r.id);
      if (filtro !== "todos" && grupo(r) !== filtro) return false;
      if (!termo) return true;
      return (
        r.tomador_nome.toLowerCase().includes(termo) ||
        String(r.numero).includes(termo) ||
        (!!dig && (r.tomador_doc ?? "").includes(dig))
      );
    });
  }, [visiveis, filtro, q, idsDestaque]);

  // ao destacar um insight: volta ao topo da tabela e traz a tabela para a tela
  useEffect(() => {
    if (!idsDestaque) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- foco na primeira linha destacada
    setFoco(0);
    const el = corpo.current?.querySelector('[data-idx="0"]');
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [idsDestaque]);

  const todosMarcados = linhas.length > 0 && linhas.every((r) => r.selecionado);
  const algunsMarcados = linhas.some((r) => r.selecionado);

  // atalhos: ↑/↓ (ou j/k) navegam, espaço marca, Enter abre
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (alvo.closest("input, textarea, select, [role=dialog]")) return;
      if (!linhas.length) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setFoco((f) => Math.min(linhas.length - 1, f + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setFoco((f) => Math.max(0, f - 1));
      } else if (e.key === " " && selecionavel) {
        e.preventDefault();
        const r = linhas[foco];
        if (r) onToggle?.(r, !r.selecionado);
      } else if (e.key === "Enter") {
        const r = linhas[foco];
        if (r) onAbrir?.(r);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linhas, foco, onAbrir, onToggle, selecionavel]);

  useEffect(() => {
    corpo.current?.querySelector(`[data-idx="${foco}"]`)?.scrollIntoView({ block: "nearest" });
  }, [foco]);

  return (
    <div className={cn("card-surface overflow-hidden", className)}>
      <div className="flex flex-col gap-2 border-b p-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          value={filtro}
          onChange={(v) => {
            setFiltro(v);
            setFoco(0);
          }}
          opcoes={[
            { value: "todos", label: "Todos", contagem: contagem.todos },
            { value: "ok", label: "OK", contagem: contagem.ok, tom: "success" },
            { value: "aviso", label: "Avisos", contagem: contagem.aviso, tom: "warning" },
            { value: "erro", label: "Erros", contagem: contagem.erro, tom: "danger" },
          ]}
        />
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground xl:inline">
            <kbd className="rounded border bg-muted px-1 font-mono">↑↓</kbd> navegar ·{" "}
            {selecionavel && (
              <>
                <kbd className="rounded border bg-muted px-1 font-mono">espaço</kbd> marcar ·{" "}
              </>
            )}
            <kbd className="rounded border bg-muted px-1 font-mono">enter</kbd> abrir
          </span>
          <SearchInput value={q} onChange={setQ} placeholder="Tomador, RPS ou CPF/CNPJ" className="sm:w-72" />
        </div>
      </div>

      {destaque && (
        <div className="flex items-center gap-2 border-b bg-brand/6 px-4 py-2 text-sm">
          <span className="size-2 rounded-full bg-brand shadow-[0_0_8px_var(--brand)]" />
          <span className="min-w-0 flex-1 truncate">
            Mostrando <strong className="num">{linhas.length}</strong> linha(s) de <strong>{destaque.titulo}</strong>
          </span>
          <button type="button" onClick={onLimparDestaque} className="shrink-0 text-xs font-medium text-info-ink hover:underline">
            Ver todas
          </button>
        </div>
      )}
      {linhas.length === 0 ? (
        <EmptyState
          icone={filtro === "erro" ? Sparkles : FileSearch}
          titulo={filtro === "erro" ? "Nenhum erro por aqui 🎉" : "Nada encontrado"}
          descricao={filtro === "erro" ? "Todas as linhas passaram na pré-validação." : "Ajuste a busca ou o filtro."}
        />
      ) : (
        <div className="max-h-[calc(100dvh-360px)] min-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-card/95 text-left text-xs text-muted-foreground backdrop-blur">
              <tr className="border-b">
                {selecionavel && (
                  <th className="w-10 px-3 py-2.5">
                    <Checkbox
                      checked={todosMarcados}
                      indeterminate={!todosMarcados && algunsMarcados}
                      onCheckedChange={(v) => onToggleTodos?.(!!v, filtro)}
                      aria-label="Marcar todos"
                    />
                  </th>
                )}
                <th className="px-3 py-2.5 font-medium">RPS</th>
                <th className="px-3 py-2.5 font-medium">Data</th>
                <th className="px-3 py-2.5 font-medium">Tomador</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">CPF/CNPJ</th>
                <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Serviço</th>
                <th className="px-3 py-2.5 text-right font-medium">Valor</th>
                <th className="hidden px-3 py-2.5 text-right font-medium sm:table-cell">ISS</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody ref={corpo} className="divide-y">
              {linhas.map((r, i) => {
                const g = grupo(r);
                return (
                  <tr
                    key={r.id}
                    data-idx={i}
                    onClick={() => {
                      setFoco(i);
                      onAbrir?.(r);
                    }}
                    className={cn(
                      "group cursor-pointer transition-colors hover:bg-accent/40",
                      i === foco && "bg-accent/50 shadow-[inset_3px_0_0_var(--brand)]",
                      !r.selecionado && selecionavel && "opacity-55",
                      g === "erro" && "bg-danger/[0.03]",
                      idsDestaque && "bg-brand/[0.05] shadow-[inset_0_0_0_1.5px_var(--brand)]",
                    )}
                  >
                    {selecionavel && (
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={r.selecionado} onCheckedChange={(v) => onToggle?.(r, !!v)} aria-label={`Marcar RPS ${r.numero}`} />
                      </td>
                    )}
                    <td className="px-3 py-2.5 font-medium">
                      <Mono>{r.numero}</Mono>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      <Mono>{data(r.data_emissao).slice(0, 5)}</Mono>
                    </td>
                    <td className="max-w-56 px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{r.tomador_nome}</span>
                        {r.tomador_novo && <Pill tom="brand">novo</Pill>}
                      </div>
                    </td>
                    <td className="hidden px-3 py-2.5 whitespace-nowrap text-muted-foreground md:table-cell">
                      <Mono>{documento(r.tomador_doc)}</Mono>
                    </td>
                    <td className="hidden px-3 py-2.5 text-muted-foreground lg:table-cell">
                      <Mono>{r.cod_servico}</Mono>
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      <Mono>{moeda(r.valor)}</Mono>
                    </td>
                    <td className="hidden px-3 py-2.5 text-right whitespace-nowrap text-muted-foreground sm:table-cell">
                      <Mono>{moeda(r.iss)}</Mono>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1">
                        <StatusLinha r={r} />
                        {acaoNota && r.status === "emitido" && r.nfse_id ? acaoNota(r) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
