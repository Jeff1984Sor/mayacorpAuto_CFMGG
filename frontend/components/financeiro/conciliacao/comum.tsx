"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { ContaSelect } from "@/components/financeiro/comum";
import { Field } from "@/components/mayacorp/form";
import { Pill } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import type { ConciliacaoDetalhe, EnvioOut, LinhaOut, TipoTitulo, TituloOut } from "@/lib/conciliacao";
import { data, moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

export const chaveConciliacao = (id: number) => ["fin", "conciliacao", id] as const;

/** Depois de gravar: a tela aberta já recebe a conciliação nova e o resto do Financeiro é recarregado. */
export function useAposGravar(id: number) {
  const qc = useQueryClient();
  return (c: ConciliacaoDetalhe | null) => {
    if (c) qc.setQueryData(chaveConciliacao(id), c);
    qc.invalidateQueries({ queryKey: ["fin"] });
    qc.invalidateQueries({ queryKey: ["faturas"] });
  };
}

/** Valor da linha do extrato com o sinal e a cor (entrada verde, saída vermelha). */
export function ValorLinha({ l, className }: { l: Pick<LinhaOut, "tipo" | "valor">; className?: string }) {
  const entrada = l.tipo === "credito";
  return (
    <span className={cn("font-mono whitespace-nowrap tabular-nums", entrada ? "text-success-ink" : "text-danger-ink", className)}>
      {entrada ? "+" : "−"} {moeda(l.valor)}
    </span>
  );
}

// ---------------------------------------------------------------- popup largo de revisão em lote
/** Cabeçalho e rodapé fixos; só o miolo (a tabela) rola. */
export function PopupLote({
  open,
  onOpenChange,
  titulo,
  descricao,
  ferramentas,
  children,
  rodape,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  titulo: string;
  descricao: React.ReactNode;
  ferramentas?: React.ReactNode;
  children: React.ReactNode;
  rodape: React.ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,calc(100vw-2rem))]">
        <div className="border-b px-5 py-4 pr-12">
          <DialogTitle className="text-base font-semibold">{titulo}</DialogTitle>
          <DialogDescription className="mt-1">{descricao}</DialogDescription>
          {ferramentas && <div className="mt-3 flex flex-wrap items-center gap-2">{ferramentas}</div>}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t bg-muted/40 px-5 py-3">{rodape}</div>
      </DialogContent>
    </Dialog>
  );
}

export const TH = "sticky top-0 z-10 border-b bg-popover px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted-foreground";

/** Rodapé padrão: quantas marcadas, o total, o aviso do que falta e o botão que grava. */
export function RodapeLote({
  marcadas,
  total,
  faltando,
  rotuloFalta,
  rotuloGravar,
  gravando,
  onGravar,
  onFechar,
  onIrParaFalta,
}: {
  marcadas: number;
  total: number;
  faltando: number;
  rotuloFalta: string;
  rotuloGravar: string;
  gravando: boolean;
  onGravar: () => void;
  onFechar: () => void;
  onIrParaFalta: () => void;
}) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        <strong className="text-foreground">{marcadas}</strong> marcada(s) · total <strong className="font-mono text-foreground tabular-nums">{moeda(total)}</strong>
        {marcadas > 0 && <span className="hidden sm:inline"> · as desmarcadas ficam para depois</span>}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onFechar}>
          Fechar
        </Button>
        {faltando > 0 ? (
          <Button variant="outline" className="border-warning/50 text-warning-ink" onClick={onIrParaFalta}>
            {faltando === 1 ? `Falta ${rotuloFalta} em 1 linha` : `Falta ${rotuloFalta} em ${faltando} linhas`}
          </Button>
        ) : (
          <Button disabled={marcadas === 0 || gravando} onClick={onGravar}>
            {gravando && <Loader2 className="animate-spin" />}
            {rotuloGravar}
          </Button>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- busca de título em aberto
export function CartaoTitulo({ t, onRemover, compacto }: { t: TituloOut; onRemover?: () => void; compacto?: boolean }) {
  const liquido = t.valor_liquido && toNum(t.valor_liquido) !== toNum(t.valor) ? t.valor_liquido : null;
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-lg border bg-background px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm">
          <Pill className="shrink-0 whitespace-nowrap" tom={t.tipo === "fatura" ? "success" : "warning"}>{t.tipo === "fatura" ? "Fatura" : "A pagar"}</Pill>
          <span className={cn("min-w-0 truncate font-medium", t.tipo === "fatura" && "font-mono text-[13px]")} title={t.rotulo}>
            {t.rotulo}
          </span>
        </p>
        <p className="truncate text-xs text-muted-foreground" title={t.nome}>
          {t.nome || "sem favorecido"} · vence {data(t.vencimento)}
          {liquido && !compacto && ` · líquido ${moeda(liquido)}`}
        </p>
      </div>
      <span className="pt-0.5 font-mono text-sm whitespace-nowrap tabular-nums">{moeda(t.valor)}</span>
      {onRemover && (
        <button type="button" aria-label={`Tirar ${t.rotulo}`} onClick={onRemover} className="mt-0.5 rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          ×
        </button>
      )}
    </div>
  );
}

/** Procura conta a pagar ou fatura em aberto (por nome, descrição ou número) para trocar ou acrescentar o título. */
export function TituloBusca({
  tipo,
  escolhidos,
  onEscolher,
  rotulo,
  invalido,
}: {
  tipo: TipoTitulo;
  escolhidos: number[];
  onEscolher: (t: TituloOut) => void;
  rotulo: string;
  invalido?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const termo = useDebounce(q, 250);
  const busca = useQuery({
    queryKey: ["fin", "conciliacao", "titulos", tipo, termo],
    queryFn: () => api.get<TituloOut[]>("/financeiro/conciliacao/titulos", { tipo, q: termo }),
    enabled: aberto,
    staleTime: 5_000,
  });
  const lista = (busca.data ?? []).filter((t) => !escolhidos.includes(t.id));
  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger render={<Button type="button" variant="outline" size="sm" aria-invalid={invalido || undefined} className="h-8" />}>
        {escolhidos.length ? <Plus /> : <Search />} {rotulo}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[26rem] max-w-[calc(100vw-2rem)] gap-0 p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tipo === "fatura" ? "Cliente, CNPJ ou número da fatura" : "Favorecido, descrição ou documento"}
              aria-label={tipo === "fatura" ? "Buscar fatura em aberto" : "Buscar conta a pagar em aberto"}
              className="h-8 w-full rounded-lg border bg-background pr-2 pl-8 text-sm outline-none focus:border-ring"
              autoFocus
            />
          </div>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1">
          {busca.isPending && <li className="p-3 text-center text-sm text-muted-foreground">Buscando…</li>}
          {!busca.isPending && lista.length === 0 && (
            <li className="p-3 text-center text-sm text-muted-foreground">{tipo === "fatura" ? "Nenhuma fatura em aberto." : "Nenhuma conta a pagar em aberto."}</li>
          )}
          {lista.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => {
                  onEscolher(t);
                  setAberto(false);
                  setQ("");
                }}
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm font-medium", tipo === "fatura" && "font-mono text-[13px]")}>{t.rotulo}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t.nome || "sem favorecido"} · vence {data(t.vencimento)}
                  </span>
                </span>
                <span className="font-mono text-sm whitespace-nowrap tabular-nums">{moeda(t.valor)}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------- subir o extrato
/** Escolhe a conta e sobe o arquivo; ao terminar, abre a conciliação. */
export function EnviarExtratoDialog({ open, onOpenChange, contaId }: { open: boolean; onOpenChange: (o: boolean) => void; contaId?: number }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [conta, setConta] = useState<number | null>(contaId ?? null);
  const enviar = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append("conta_id", String(conta));
      fd.append("arquivo", f);
      return api.post<EnvioOut>("/financeiro/conciliacao", fd);
    },
    onSuccess: (r) => {
      if (r.ja_importado) toast.info(r.mensagem);
      else toast.success(r.mensagem);
      qc.invalidateQueries({ queryKey: ["fin", "conciliacao"] });
      onOpenChange(false);
      router.push(`/financeiro/conciliacao/${r.id}`);
    },
  });
  const dz = useDropzone({
    multiple: false,
    maxSize: 15 * 1024 * 1024,
    accept: { "application/x-ofx": [".ofx"], "text/csv": [".csv"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
    onDrop: (f) => f[0] && conta && enviar.mutate(f[0]),
    onDropRejected: () => toast.error("Envie o extrato em OFX, CSV ou XLSX (até 15 MB)."),
    disabled: enviar.isPending || !conta,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Conciliar extrato</DialogTitle>
        <DialogDescription>
          Suba o extrato que o banco fornece. O sistema compara com as contas a pagar, as faturas e o que já está lançado na conta. Nada é gravado sem a
          sua confirmação.
        </DialogDescription>
        <Field label="Conta bancária" obrigatorio htmlFor="conc-conta">
          <ContaSelect id="conc-conta" value={conta} onChange={setConta} />
        </Field>
        <div
          {...dz.getRootProps()}
          className={cn(
            "flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition",
            !conta ? "cursor-not-allowed opacity-60" : "cursor-pointer",
            dz.isDragActive ? "border-brand bg-brand/6" : conta && "hover:border-brand/50 hover:bg-muted/40",
          )}
        >
          <input {...dz.getInputProps()} aria-label="Arquivo do extrato" />
          {enviar.isPending ? <Loader2 className="size-7 animate-spin text-info-ink" /> : <UploadCloud className="size-7 text-info-ink" />}
          <p className="text-sm font-medium">
            {enviar.isPending ? "Lendo o extrato e comparando…" : conta ? "Arraste o extrato ou clique para escolher" : "Escolha a conta bancária primeiro"}
          </p>
          <p className="text-xs text-muted-foreground">OFX (recomendado), CSV ou Excel, até 15 MB. Linha que já veio em outro extrato desta conta não entra de novo.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
