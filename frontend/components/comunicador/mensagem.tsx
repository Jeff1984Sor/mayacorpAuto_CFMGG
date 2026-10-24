"use client";

import { AlertCircle, ArrowRight, Check, CheckCheck, Clock3, CornerUpLeft, Pencil, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { hora, type Msg, pedacos, rotuloLink } from "@/lib/comunicador";
import { cn } from "@/lib/utils";

/** Texto com menções @Nome em destaque e links clicáveis. */
export function TextoRico({ texto, eu, minha }: { texto: string; eu: number | undefined; minha: boolean }) {
  return (
    <>
      {pedacos(texto).map((p, i) => {
        if (p.tipo === "texto") return <span key={i}>{p.v}</span>;
        if (p.tipo === "url")
          return (
            <a key={i} href={p.v} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">
              {p.v}
            </a>
          );
        const souEu = p.id === eu;
        return (
          <span
            key={i}
            className={cn(
              "rounded px-1 font-semibold",
              minha ? "bg-white/20" : souEu ? "bg-warning/25 text-foreground" : "bg-brand/15 text-info-ink",
            )}
          >
            @{p.nome}
          </span>
        );
      })}
    </>
  );
}

export type EstadoEnvio = "pendente" | "erro" | undefined;

export function Bolha({
  m,
  eu,
  minha,
  inicioGrupo,
  fimGrupo,
  grupo,
  lidaAte,
  estado,
  destaque,
  onResponder,
  onEditar,
  onApagar,
  onIrPara,
  onTentarDeNovo,
  onDescartar,
  avatar,
}: {
  m: Msg;
  eu: number | undefined;
  minha: boolean;
  inicioGrupo: boolean;
  fimGrupo: boolean;
  grupo: boolean;
  lidaAte: number;
  estado?: EstadoEnvio;
  destaque?: boolean;
  onResponder?: () => void;
  onEditar?: (texto: string) => Promise<unknown>;
  onApagar?: () => void;
  onIrPara?: (id: number) => void;
  onTentarDeNovo?: () => void;
  onDescartar?: () => void;
  avatar?: React.ReactNode;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState(m.texto);
  const [salvando, setSalvando] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editando) {
      taRef.current?.focus();
      taRef.current?.setSelectionRange(rascunho.length, rascunho.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao entrar em edição
  }, [editando]);

  const salvar = async () => {
    const t = rascunho.trim();
    if (!t || t === m.texto || !onEditar) return setEditando(false);
    setSalvando(true);
    try {
      await onEditar(t);
      setEditando(false);
    } finally {
      setSalvando(false);
    }
  };

  const lida = minha && !estado && m.id <= lidaAte;
  const robo = m.robo;
  const acoes = !estado && !m.apagada && !editando;

  return (
    <div
      id={`msg-${m.id}`}
      className={cn("group/msg relative flex gap-2 px-3 sm:px-5", minha ? "justify-end" : "justify-start", inicioGrupo ? "mt-3" : "mt-0.5")}
    >
      {!minha && (grupo || robo) && <div className="w-8 shrink-0 self-end">{fimGrupo ? avatar : null}</div>}
      <div className={cn("flex max-w-[min(78%,560px)] min-w-0 flex-col", minha ? "items-end" : "items-start")}>
        {inicioGrupo && !minha && (grupo || robo) && (
          <span className={cn("mb-0.5 px-1 text-[11px] font-semibold", robo ? "text-info-ink" : "text-muted-foreground")}>{m.autor_nome}</span>
        )}
        <div
          className={cn(
            "relative rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap shadow-sm transition-[box-shadow,background-color] duration-700",
            minha ? "bg-brand text-brand-foreground" : robo ? "border border-brand/25 bg-linear-to-br from-brand/10 to-card" : "border bg-card",
            minha && !fimGrupo && "rounded-br-md",
            minha && !inicioGrupo && "rounded-tr-md",
            !minha && !fimGrupo && "rounded-bl-md",
            !minha && !inicioGrupo && "rounded-tl-md",
            m.apagada && "border border-dashed bg-transparent text-muted-foreground italic shadow-none",
            estado === "pendente" && "opacity-70",
            estado === "erro" && "ring-2 ring-danger/50",
            destaque && "ring-4 ring-warning/60",
          )}
        >
          {m.resposta_a && !m.apagada && (
            <button
              type="button"
              onClick={() => onIrPara?.(m.resposta_a!.id)}
              className={cn(
                "mb-1.5 block w-full rounded-lg border-l-[3px] px-2 py-1 text-left text-xs",
                minha ? "border-white/60 bg-white/15" : "border-brand bg-brand/8",
              )}
            >
              <span className="block font-semibold">{m.resposta_a.autor_nome}</span>
              <span className={cn("line-clamp-2", minha ? "text-white/80" : "text-muted-foreground")}>{m.resposta_a.texto}</span>
            </button>
          )}

          {m.apagada ? (
            "Mensagem apagada"
          ) : editando ? (
            <div className="min-w-56">
              <textarea
                ref={taRef}
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                rows={Math.min(6, rascunho.split("\n").length + 1)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void salvar();
                  }
                  if (e.key === "Escape") setEditando(false);
                }}
                className="w-full resize-none rounded-lg bg-white/15 p-2 text-sm text-inherit outline-none"
                aria-label="Editar mensagem"
              />
              <div className="mt-1 flex justify-end gap-2 text-xs">
                <button type="button" onClick={() => setEditando(false)} className="rounded px-2 py-0.5 hover:bg-white/15">
                  Cancelar
                </button>
                <button type="button" onClick={() => void salvar()} disabled={salvando} className="rounded bg-white/25 px-2 py-0.5 font-semibold hover:bg-white/35">
                  {salvando ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </div>
          ) : (
            <TextoRico texto={m.texto} eu={eu} minha={minha} />
          )}

          {robo && m.link && !m.apagada && (
            <Link
              href={m.link}
              className="mt-2 inline-flex items-center gap-1 rounded-lg bg-brand px-2.5 py-1 text-xs font-semibold text-brand-foreground shadow-sm transition hover:opacity-90"
            >
              {rotuloLink(m.link)} <ArrowRight className="size-3" />
            </Link>
          )}

          <span className={cn("ml-2 inline-flex translate-y-0.5 items-center gap-1 align-bottom text-[10.5px] whitespace-nowrap select-none", minha ? "text-white/75" : "text-muted-foreground")}>
            {m.editada && !m.apagada && <span>editada ·</span>}
            {estado === "pendente" ? <Clock3 className="size-3" aria-label="enviando" /> : hora(m.criada_em)}
            {minha && !estado && (lida ? <CheckCheck className="size-3.5" aria-label="lida" /> : <Check className="size-3.5" aria-label="enviada" />)}
          </span>
        </div>

        {estado === "erro" && (
          <span className="mt-1 flex items-center gap-2 text-xs text-danger-ink">
            <AlertCircle className="size-3.5" /> Não enviada.
            <button type="button" onClick={onTentarDeNovo} className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline">
              <RotateCcw className="size-3" /> Tentar de novo
            </button>
            <button type="button" onClick={onDescartar} className="text-muted-foreground hover:underline">
              Descartar
            </button>
          </span>
        )}
      </div>

      {acoes && (
        <div
          className={cn(
            "absolute -top-3 z-10 flex items-center gap-0.5 rounded-lg border bg-popover p-0.5 opacity-0 shadow-md transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100",
            minha ? "right-6" : "left-12",
          )}
        >
          {!robo && onResponder && (
            <Acao rotulo="Responder" onClick={onResponder}>
              <CornerUpLeft className="size-3.5" />
            </Acao>
          )}
          {minha && onEditar && (
            <Acao
              rotulo="Editar"
              onClick={() => {
                setRascunho(m.texto);
                setEditando(true);
              }}
            >
              <Pencil className="size-3.5" />
            </Acao>
          )}
          {minha && onApagar && (
            <Acao rotulo="Apagar" onClick={onApagar} perigo>
              <Trash2 className="size-3.5" />
            </Acao>
          )}
        </div>
      )}
    </div>
  );
}

function Acao({ rotulo, onClick, children, perigo }: { rotulo: string; onClick: () => void; children: React.ReactNode; perigo?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            aria-label={rotulo}
            className={cn("grid size-7 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground", perigo && "hover:bg-danger/10 hover:text-danger-ink")}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{rotulo}</TooltipContent>
    </Tooltip>
  );
}
