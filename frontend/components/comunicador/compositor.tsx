"use client";

import { CornerUpLeft, Lock, SendHorizontal, Smile, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { UserAvatar } from "@/components/mayacorp/user-avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { type Msg, textoSimples, type UsuarioChat } from "@/lib/comunicador";
import { cn } from "@/lib/utils";

const EMOJIS = ["👍", "🙏", "✅", "👀", "🎉", "😀", "😂", "🙂", "😉", "🤔", "😅", "😮", "❤️", "🔥", "👏", "💪", "📎", "📌", "⚠️", "❗", "⏰", "💰", "🧾", "📄"];
const RE_ARROBA = /(^|\s)@([^\s@[\]()]{0,30})$/;
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function Compositor({
  bloqueado,
  candidatos,
  resposta,
  onCancelarResposta,
  onEnviar,
  onDigitando,
  rascunhoKey,
}: {
  bloqueado?: boolean;
  candidatos: UsuarioChat[];
  resposta: Msg | null;
  onCancelarResposta: () => void;
  onEnviar: (texto: string) => void;
  onDigitando: () => void;
  rascunhoKey: string;
}) {
  const [texto, setTexto] = useState("");
  const [mencao, setMencao] = useState<{ termo: string; inicio: number } | null>(null);
  const [sel, setSel] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);

  // rascunho por conversa (sobrevive à troca de conversa / recarregar)
  useEffect(() => {
    let r = "";
    try {
      r = sessionStorage.getItem(rascunhoKey) ?? "";
    } catch {
      /* storage indisponível */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carrega o rascunho da conversa aberta
    setTexto(r);
    setMencao(null);
    requestAnimationFrame(() => ta.current?.focus());
  }, [rascunhoKey]);
  useEffect(() => {
    try {
      if (texto) sessionStorage.setItem(rascunhoKey, texto);
      else sessionStorage.removeItem(rascunhoKey);
    } catch {
      /* storage indisponível */
    }
  }, [texto, rascunhoKey]);

  useEffect(() => {
    if (resposta) ta.current?.focus();
  }, [resposta]);

  // autoexpansão (até ~8 linhas)
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [texto]);

  const opcoes = useMemo(() => {
    if (!mencao) return [];
    const t = semAcento(mencao.termo);
    return candidatos.filter((u) => !t || semAcento(u.nome).includes(t) || (u.login ?? "").includes(t)).slice(0, 6);
  }, [mencao, candidatos]);

  const detectar = (valor: string, caret: number) => {
    const antes = valor.slice(0, caret);
    const m = RE_ARROBA.exec(antes);
    if (m) {
      setMencao({ termo: m[2], inicio: caret - m[2].length - 1 });
      setSel(0);
    } else setMencao(null);
  };

  const inserirMencao = (u: UsuarioChat) => {
    if (!mencao || !ta.current) return;
    const caret = ta.current.selectionStart;
    const token = `@[${u.nome}](${u.id}) `;
    const novo = texto.slice(0, mencao.inicio) + token + texto.slice(caret);
    setTexto(novo);
    setMencao(null);
    const pos = mencao.inicio + token.length;
    requestAnimationFrame(() => {
      ta.current?.focus();
      ta.current?.setSelectionRange(pos, pos);
    });
  };

  const inserirEmoji = (e: string) => {
    const el = ta.current;
    const ini = el?.selectionStart ?? texto.length;
    const fim = el?.selectionEnd ?? texto.length;
    const novo = texto.slice(0, ini) + e + texto.slice(fim);
    setTexto(novo);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(ini + e.length, ini + e.length);
    });
  };

  const enviar = () => {
    const t = texto.trim();
    if (!t || bloqueado) return;
    onEnviar(t);
    setTexto("");
    setMencao(null);
  };

  if (bloqueado)
    return (
      <div className="flex items-center justify-center gap-2 border-t bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <Lock className="size-4" /> Canal só de avisos automáticos dos robôs.
      </div>
    );

  return (
    <div className="relative border-t bg-card/60 p-3 backdrop-blur">
      {resposta && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border-l-4 border-brand bg-brand/6 px-3 py-2 text-xs">
          <CornerUpLeft className="mt-0.5 size-3.5 shrink-0 text-info-ink" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-info-ink">Respondendo a {resposta.autor_nome}</p>
            <p className="truncate text-muted-foreground">{resposta.apagada ? "Mensagem apagada" : textoSimples(resposta.texto)}</p>
          </div>
          <button type="button" onClick={onCancelarResposta} className="rounded p-0.5 text-muted-foreground hover:bg-muted" aria-label="Cancelar resposta">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {mencao && opcoes.length > 0 && (
        <ul
          role="listbox"
          aria-label="Mencionar pessoa"
          className="absolute bottom-full left-3 z-20 mb-2 w-72 overflow-hidden rounded-xl border bg-popover p-1 shadow-xl"
        >
          {opcoes.map((u, i) => (
            <li key={u.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === sel}
                onMouseDown={(e) => {
                  e.preventDefault();
                  inserirMencao(u);
                }}
                onMouseEnter={() => setSel(i)}
                className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm", i === sel && "bg-brand/10")}
              >
                <UserAvatar nome={u.nome} fotoUrl={u.foto_url} className="size-6" textoClassName="text-[9px]" />
                <span className="min-w-0 flex-1 truncate">{u.nome}</span>
                {u.login && <span className="font-mono text-[11px] text-muted-foreground">@{u.login}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2 rounded-2xl border bg-background px-2 py-1.5 transition focus-within:border-brand/50 focus-within:ring-3 focus-within:ring-brand/15">
        <Popover>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Inserir emoji"
              />
            }
          >
            <Smile className="size-[18px]" />
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-64 p-2">
            <div className="grid grid-cols-8 gap-0.5">
              {EMOJIS.map((e) => (
                <button key={e} type="button" onClick={() => inserirEmoji(e)} className="grid size-7 place-items-center rounded-md text-lg transition hover:scale-110 hover:bg-muted" aria-label={`Emoji ${e}`}>
                  {e}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        <textarea
          ref={ta}
          rows={1}
          value={texto}
          placeholder="Escreva uma mensagem…"
          aria-label="Mensagem"
          onChange={(e) => {
            setTexto(e.target.value);
            detectar(e.target.value, e.target.selectionStart);
            if (e.target.value.trim()) onDigitando();
          }}
          onClick={(e) => detectar(texto, e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (mencao && opcoes.length) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => (s + 1) % opcoes.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => (s - 1 + opcoes.length) % opcoes.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                inserirMencao(opcoes[sel]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMencao(null);
                return;
              }
            }
            if (e.key === "Escape" && resposta) onCancelarResposta();
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              enviar();
            }
          }}
          className="max-h-[200px] min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={enviar}
          disabled={!texto.trim()}
          className="mb-0.5 grid size-8 shrink-0 place-items-center rounded-lg brand-gradient text-white shadow-md shadow-brand/30 transition hover:opacity-90 disabled:opacity-35 disabled:shadow-none"
          aria-label="Enviar mensagem"
        >
          <SendHorizontal className="size-4" />
        </button>
      </div>
      <p className="mt-1 hidden px-2 text-[11px] text-muted-foreground sm:block">
        <kbd className="font-mono">Enter</kbd> envia · <kbd className="font-mono">Shift+Enter</kbd> quebra linha · <kbd className="font-mono">@</kbd> menciona
      </p>
    </div>
  );
}
