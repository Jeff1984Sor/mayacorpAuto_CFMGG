"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { AtSign, Check, Loader2, Search, Send } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { UserAvatar } from "@/components/mayacorp/user-avatar";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { COR_STATUS, type UsuarioChat } from "@/lib/comunicador";
import { cn } from "@/lib/utils";

import { qk, useComunicador } from "./provider";

type Origem = "lote" | "nfse" | "fatura" | "extrato" | "cliente";

/** "Chamar alguém": avisa uma pessoa da equipe sobre este registro (vira menção + mensagem direta). */
export function ChamarAlguem({ origemTipo, origemId, contexto }: { origemTipo: Origem; origemId: number; contexto: string }) {
  const pathname = usePathname();
  const { online } = useComunicador();
  const [aberto, setAberto] = useState(false);
  const [q, setQ] = useState("");
  const [pessoa, setPessoa] = useState<UsuarioChat | null>(null);
  const [texto, setTexto] = useState("");

  const usuarios = useQuery({
    queryKey: qk.usuarios,
    queryFn: () => api.get<UsuarioChat[]>("/comunicador/usuarios"),
    enabled: aberto,
    staleTime: 60_000,
  });
  const lista = (usuarios.data ?? []).filter((u) => !q.trim() || u.nome.toLowerCase().includes(q.trim().toLowerCase()));

  const limpar = () => {
    setPessoa(null);
    setTexto("");
    setQ("");
  };
  const chamar = useMutation({
    mutationFn: () =>
      api.post("/comunicador/chamar", {
        usuario_id: pessoa!.id,
        texto: texto.trim() || `Pode dar uma olhada em ${contexto}?`,
        origem_tipo: origemTipo,
        origem_id: origemId,
        url: pathname + window.location.search,
      }),
    onSuccess: () => {
      toast.success("Chamado enviado", { description: `${pessoa?.nome} vai receber um aviso com o link.` });
      limpar();
      setAberto(false);
    },
  });

  return (
    <Popover
      open={aberto}
      onOpenChange={(o) => {
        setAberto(o);
        if (!o) limpar();
      }}
    >
      <PopoverTrigger render={<Button variant="outline" title="Chamar alguém da equipe para olhar isto" />}>
        <AtSign /> Chamar alguém
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,360px)] gap-0 p-0">
        <div className="border-b p-3">
          <p className="font-semibold">Chamar alguém</p>
          <p className="text-xs text-muted-foreground">A pessoa recebe uma menção com o link de {contexto}.</p>
        </div>
        <div className="p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar pessoa"
              className="h-8 w-full rounded-lg border bg-background pr-2 pl-8 text-sm outline-none focus:border-ring"
              autoFocus
              aria-label="Buscar pessoa"
            />
          </div>
        </div>
        <ul className="max-h-48 overflow-y-auto px-1 pb-1" role="listbox" aria-label="Pessoas">
          {usuarios.isPending && (
            <li className="flex justify-center p-4">
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            </li>
          )}
          {usuarios.data && lista.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">Ninguém encontrado.</li>}
          {lista.map((u) => {
            const on = pessoa?.id === u.id;
            const st = online[u.id] ?? u.status;
            return (
              <li key={u.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => setPessoa(u)}
                  className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted", on && "bg-brand/10")}
                >
                  <UserAvatar nome={u.nome} fotoUrl={u.foto_url} className="size-7" textoClassName="text-[10px]" />
                  <span className="min-w-0 flex-1 truncate">{u.nome}</span>
                  <span className={cn("size-2 rounded-full", COR_STATUS[st])} aria-label={st} />
                  {on && <Check className="size-4 text-info-ink" />}
                </button>
              </li>
            );
          })}
        </ul>
        <form
          className="space-y-2 border-t p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (pessoa) chamar.mutate();
          }}
        >
          <Textarea
            rows={3}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={`Pode dar uma olhada em ${contexto}?`}
            className="resize-none text-sm"
            aria-label="Mensagem"
          />
          <Button type="submit" className="w-full" disabled={!pessoa || chamar.isPending}>
            {chamar.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            {pessoa ? `Chamar ${pessoa.nome.split(" ")[0]}` : "Escolha uma pessoa"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
