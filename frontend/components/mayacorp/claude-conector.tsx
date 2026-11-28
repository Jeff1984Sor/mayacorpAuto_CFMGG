"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plug, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { relativo } from "@/lib/format";

interface Conexao {
  id: number;
  cliente: string;
  destino: string;
  escopo: "leitura" | "escrita";
  criado_em: string;
  ultimo_uso: string | null;
  usuario: string;
  minha: boolean;
}

interface Resposta {
  url: string;
  conexoes: Conexao[];
}

function copiar(texto: string, aviso: string) {
  navigator.clipboard.writeText(texto).then(() => toast.success(aviso));
}

/** Minha conta › Claude: o endereço do conector MCP, como conectar e as conexões ativas (com encerrar). */
export function ClaudeConector() {
  const qc = useQueryClient();
  const [encerrar, setEncerrar] = useState<Conexao | null>(null);
  const { data } = useQuery({ queryKey: ["mcp-conexoes"], queryFn: () => api.get<Resposta>("/mcp/conexoes") });
  const revogar = useMutation({
    mutationFn: (id: number) => api.del(`/mcp/conexoes/${id}`),
    onSuccess: () => {
      toast.success("Conexão encerrada");
      setEncerrar(null);
      qc.invalidateQueries({ queryKey: ["mcp-conexoes"] });
    },
  });
  if (!data) return null;
  const comando = `claude mcp add --transport http mayajus ${data.url}`;

  return (
    <div className="card-surface space-y-4 p-5">
      <div>
        <h3 className="flex items-center gap-2 font-semibold">
          <Plug className="size-4 text-info-ink" /> Claude
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Converse com o Claude sobre os dados do escritório: ele consulta casos, tarefas, horas, faturas e financeiro,
          monta relatórios e, se você liberar, lança e altera. Sempre com as permissões do seu perfil.
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1.5 pr-1.5 pl-3">
        <Mono className="min-w-0 flex-1 truncate text-sm">{data.url}</Mono>
        <Button size="sm" variant="outline" onClick={() => copiar(data.url, "Endereço copiado")}>
          <Copy /> Copiar
        </Button>
      </div>

      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          No Claude (claude.ai ou o aplicativo), abra <b className="text-foreground">Configurações › Conectores</b> e
          escolha <b className="text-foreground">Adicionar conector personalizado</b>.
        </li>
        <li>Cole o endereço acima e clique em Conectar.</li>
        <li>Entre com o seu usuário daqui e escolha se o Claude só consulta ou também altera.</li>
      </ol>
      <p className="text-sm text-muted-foreground">
        No Claude Code:{" "}
        <button
          type="button"
          className="rounded bg-muted px-1.5 py-0.5 text-left font-mono text-xs break-all text-foreground hover:bg-muted/70"
          title="Copiar o comando"
          onClick={() => copiar(comando, "Comando copiado")}
        >
          {comando}
        </button>
      </p>

      {data.conexoes.length > 0 && (
        <div className="space-y-2 border-t pt-4">
          <h4 className="text-sm font-medium">Conexões ativas</h4>
          <ul className="divide-y rounded-lg border">
            {data.conexoes.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {c.cliente}
                    {!c.minha && <span className="font-normal text-muted-foreground"> · {c.usuario}</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.escopo === "escrita" ? "Consulta e altera" : "Só consulta"} · {c.destino} ·{" "}
                    {c.ultimo_uso ? `usado ${relativo(c.ultimo_uso)}` : "ainda não usado"}
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="text-danger-ink" onClick={() => setEncerrar(c)}>
                  <Unplug /> Encerrar
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={!!encerrar}
        onOpenChange={(o) => !o && setEncerrar(null)}
        titulo="Encerrar esta conexão?"
        descricao={
          encerrar
            ? `${encerrar.cliente} deixa de acessar o sistema${encerrar.minha ? "" : ` como ${encerrar.usuario}`} na hora. Para voltar, é só conectar de novo.`
            : undefined
        }
        confirmar="Encerrar"
        destrutivo
        carregando={revogar.isPending}
        onConfirm={() => encerrar && revogar.mutate(encerrar.id)}
      />
    </div>
  );
}
