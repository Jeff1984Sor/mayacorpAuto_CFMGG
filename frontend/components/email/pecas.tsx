"use client";

import { Check, FileCode2, FileText, Paperclip, ReceiptText, X } from "lucide-react";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";

import { useBrand } from "@/lib/brand";
import { pedacos } from "@/lib/comunicador";
import type { TipoAnexo } from "@/lib/types";
import { cn } from "@/lib/utils";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const emailValido = (e: string) => EMAIL_RE.test(e);

// ---------------------------------------------------------------- destinatários (estilo Gmail)
export function LinhaEmails({
  rotulo,
  valor,
  onChange,
  sugestoes = [],
  placeholder,
  autoFocus,
  acao,
  id,
}: {
  rotulo: string;
  valor: string[];
  onChange: (v: string[]) => void;
  sugestoes?: string[];
  placeholder?: string;
  autoFocus?: boolean;
  acao?: React.ReactNode;
  id?: string;
}) {
  const [txt, setTxt] = useState("");
  const [foco, setFoco] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const termo = txt.trim().toLowerCase();
  const opcoes = sugestoes.filter((s) => !valor.includes(s) && (!termo || s.includes(termo))).slice(0, 6);
  const parcialInvalido = termo.length > 0 && /[@.]/.test(termo) && !emailValido(termo) && /[,;\s]$/.test(txt);

  const adicionar = (bruto: string) => {
    const novos = bruto
      .split(/[;,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (novos.length) onChange([...new Set([...valor, ...novos])]);
    setTxt("");
    setSel(0);
  };

  return (
    <div className="relative">
      <div
        className="flex min-h-10 cursor-text flex-wrap items-center gap-1.5 border-b px-1 py-1.5 transition-colors focus-within:border-brand/60"
        onClick={() => input.current?.focus()}
      >
        <label htmlFor={id} className="min-w-10 shrink-0 pr-1.5 text-sm text-muted-foreground">
          {rotulo}
        </label>
        {valor.map((e) => {
          const ok = emailValido(e);
          return (
            <span
              key={e}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs font-medium",
                ok ? "bg-brand/12 text-foreground" : "bg-danger/12 text-danger-ink ring-1 ring-danger/30",
              )}
              title={ok ? e : "E-mail inválido"}
            >
              <span className="truncate">{e}</span>
              <button
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  onChange(valor.filter((x) => x !== e));
                }}
                className="grid size-4 place-items-center rounded-full hover:bg-foreground/10"
                aria-label={`Remover ${e}`}
              >
                <X className="size-3" />
              </button>
            </span>
          );
        })}
        <input
          ref={input}
          id={id}
          value={txt}
          autoFocus={autoFocus}
          onFocus={() => setFoco(true)}
          onBlur={() => {
            setFoco(false);
            if (txt.trim()) adicionar(txt);
          }}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]$/.test(v) || (/\s$/.test(v) && emailValido(v.trim()))) adicionar(v);
            else setTxt(v);
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData("text");
            if (/[,;\s]/.test(t.trim())) {
              e.preventDefault();
              adicionar(t);
            }
          }}
          onKeyDown={(e) => {
            if (opcoes.length && foco && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setSel((s) => (s + (e.key === "ArrowDown" ? 1 : -1) + opcoes.length) % opcoes.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              if (termo) {
                e.preventDefault();
                adicionar(txt);
              } else if (opcoes.length && foco && e.key === "Enter") {
                e.preventDefault();
                adicionar(opcoes[sel]);
              }
            } else if (e.key === "Backspace" && !txt && valor.length) onChange(valor.slice(0, -1));
          }}
          placeholder={valor.length ? "" : placeholder}
          className={cn("h-7 min-w-40 flex-1 bg-transparent text-sm outline-none", termo && !emailValido(termo) && termo.includes("@") && "text-danger-ink")}
          aria-invalid={parcialInvalido}
          autoComplete="off"
        />
        {acao && <span className="ml-auto flex shrink-0 items-center gap-2">{acao}</span>}
      </div>
      {foco && opcoes.length > 0 && (
        <ul className="absolute top-full left-10 z-30 mt-1 w-72 overflow-hidden rounded-xl border bg-popover p-1 shadow-xl" role="listbox">
          <li className="px-2 py-1 text-[10.5px] font-semibold tracking-wider text-muted-foreground uppercase">E-mails do cliente</li>
          {opcoes.map((o, i) => (
            <li key={o}>
              <button
                type="button"
                role="option"
                aria-selected={i === sel}
                onMouseDown={(e) => {
                  e.preventDefault();
                  adicionar(o);
                }}
                className={cn("w-full rounded-lg px-2 py-1.5 text-left text-sm", i === sel ? "bg-brand/10" : "hover:bg-muted")}
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- anexos
const ICONE_ANEXO: Record<TipoAnexo, React.ComponentType<{ className?: string }>> = {
  pdf: FileText,
  xml: FileCode2,
  fatura: ReceiptText,
};
const ROTULO_ANEXO: Record<TipoAnexo, string> = { pdf: "PDF da nota", xml: "XML da nota", fatura: "Fatura (PDF)" };
const COR_ANEXO: Record<TipoAnexo, string> = {
  pdf: "bg-danger/10 text-danger-ink",
  xml: "bg-brand/12 text-info-ink",
  fatura: "bg-success/10 text-success-ink",
};
export const kb = (b: number) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(b < 10_240 ? 1 : 0).replace(".", ",")} KB`);

export function AnexosEscolha({
  anexos,
  marcados,
  onAlternar,
}: {
  anexos: { tipo: TipoAnexo; nome?: string; tamanho?: number }[];
  marcados: TipoAnexo[];
  onAlternar: (t: TipoAnexo) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Anexos">
      {anexos.map((a) => {
        const on = marcados.includes(a.tipo);
        const I = ICONE_ANEXO[a.tipo];
        return (
          <button
            key={a.tipo}
            type="button"
            aria-pressed={on}
            onClick={() => onAlternar(a.tipo)}
            className={cn(
              "group flex min-w-0 items-center gap-2.5 rounded-xl border bg-card py-2 pr-3 pl-2 text-left transition-all",
              on ? "border-brand/50 shadow-sm ring-1 ring-brand/30" : "opacity-60 hover:opacity-100",
            )}
          >
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", COR_ANEXO[a.tipo])}>
              <I className="size-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block max-w-44 truncate text-sm font-medium">{a.nome ?? ROTULO_ANEXO[a.tipo]}</span>
              <span className="block text-[11px] text-muted-foreground">{a.tamanho != null ? kb(a.tamanho) : ROTULO_ANEXO[a.tipo]}</span>
            </span>
            <span
              className={cn(
                "ml-1 grid size-5 shrink-0 place-items-center rounded-full border transition-colors",
                on ? "border-brand bg-brand text-brand-foreground" : "border-muted-foreground/30",
              )}
            >
              {on && <Check className="size-3" strokeWidth={3} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- textarea autoexpansível
export const TextareaAuto = forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea"> & { max?: number }>(function TextareaAuto(
  { className, max = 520, value, ...props },
  ref,
) {
  const el = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => el.current!);
  useLayoutEffect(() => {
    const t = el.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight + 2, max)}px`;
  }, [value, max]);
  return (
    <textarea
      ref={el}
      value={value}
      className={cn("w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground", className)}
      {...props}
    />
  );
});

// ---------------------------------------------------------------- pré-visualização (como o cliente vê)
function CorpoComLinks({ texto, variaveis }: { texto: string; variaveis?: boolean }) {
  // {variavel} que o front não sabe resolver aparece como etiqueta
  const partes = variaveis ? texto.split(/(\{[a-z_]+\})/g) : [texto];
  return (
    <>
      {partes.map((p, i) =>
        variaveis && /^\{[a-z_]+\}$/.test(p) ? (
          <span key={i} className="mx-0.5 rounded bg-brand/12 px-1 font-mono text-[0.85em] text-info-ink">
            {p}
          </span>
        ) : (
          pedacos(p).map((q, j) =>
            q.tipo === "url" ? (
              <a key={`${i}-${j}`} href={q.v} target="_blank" rel="noopener noreferrer" className="break-all text-[#1e2d6b] underline underline-offset-2 dark:text-brand">
                {q.v}
              </a>
            ) : (
              <span key={`${i}-${j}`}>{q.tipo === "mencao" ? `@${q.nome}` : q.v}</span>
            ),
          )
        ),
      )}
    </>
  );
}

export function PreviaEmail({
  de,
  para,
  cc,
  assunto,
  corpo,
  anexos,
  variaveis,
  topo,
}: {
  de: string;
  para: string;
  cc?: string[];
  assunto: string;
  corpo: string;
  anexos: { tipo: TipoAnexo; nome: string; tamanho?: number }[];
  /** realça {variaveis} não resolvidas (modelo em lote) */
  variaveis?: boolean;
  topo?: React.ReactNode;
}) {
  const { nome_exibicao, logoSrc } = useBrand();
  return (
    <div className="overflow-hidden rounded-2xl border bg-card shadow-xl shadow-dark-maya/5">
      {topo}
      <div className="space-y-1 border-b bg-muted/40 px-5 py-3 text-xs">
        <p className="truncate">
          <span className="inline-block w-14 text-muted-foreground">De</span> {de}
        </p>
        <p className="truncate">
          <span className="inline-block w-14 text-muted-foreground">Para</span> {para || <span className="text-danger-ink">ninguém ainda</span>}
        </p>
        {cc && cc.length > 0 && (
          <p className="truncate">
            <span className="inline-block w-14 text-muted-foreground">Cc</span> {cc.join(", ")}
          </p>
        )}
        <p className="pt-1 text-sm font-semibold">
          <CorpoComLinks texto={assunto || "(sem assunto)"} variaveis={variaveis} />
        </p>
      </div>
      <div className="brand-gradient flex h-16 items-center gap-3 px-6">
        {logoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoSrc} alt="" className="h-9 max-w-40 rounded-md bg-white object-contain p-1" />
        ) : (
          <span className="text-lg font-semibold tracking-tight text-white">{nome_exibicao}</span>
        )}
      </div>
      <div className="bg-[#ffffff] px-6 py-5 text-[14px] leading-relaxed whitespace-pre-wrap text-[#0f1729] dark:bg-card dark:text-foreground">
        <CorpoComLinks texto={corpo} variaveis={variaveis} />
      </div>
      {anexos.length > 0 && (
        <div className="border-t bg-muted/30 px-5 py-3">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
            <Paperclip className="size-3" /> {anexos.length} anexo{anexos.length > 1 ? "s" : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            {anexos.map((a) => {
              const I = ICONE_ANEXO[a.tipo];
              return (
                <span key={a.tipo} className="inline-flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-xs">
                  <span className={cn("grid size-6 place-items-center rounded", COR_ANEXO[a.tipo])}>
                    <I className="size-3.5" />
                  </span>
                  <span className="max-w-40 truncate font-medium">{a.nome}</span>
                  {a.tamanho != null && <span className="text-muted-foreground">{kb(a.tamanho)}</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}
      <p className="border-t px-5 py-2 text-center text-[10.5px] text-muted-foreground">Enviado por {nome_exibicao} · Uma solução MayaCorp</p>
    </div>
  );
}
