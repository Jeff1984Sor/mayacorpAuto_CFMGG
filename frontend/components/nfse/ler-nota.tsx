"use client";

import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Building2, FileCode2, FileScan, Landmark, Loader2, ReceiptText, Sparkles, Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { cep as fmtCep, documento } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Resultado de POST /nfse/emissoras/ler-nota. */
export interface NotaLida {
  fonte: "xml" | "pdf" | "imagem";
  empresa: Record<string, string>;
  fiscal: {
    cod_servico_padrao?: string;
    aliquota_iss?: string;
    iss_retido: boolean;
    regime?: string;
    serie_rps?: string;
    prox_rps?: number;
  };
  parametros: Record<string, string>;
  nota: Record<string, string>;
  avisos: string[];
}

export type Secao = "empresa" | "fiscal" | "parametros";

const ROTULOS: Record<string, string> = {
  razao_social: "Razão social", nome_fantasia: "Nome fantasia", cnpj: "CNPJ", ccm: "Inscrição municipal (CCM)",
  logradouro: "Logradouro", numero: "Número", complemento: "Complemento", bairro: "Bairro", cidade: "Cidade", uf: "UF",
  cep: "CEP", email: "E-mail", telefone: "Telefone",
  cod_servico_padrao: "Código do serviço", aliquota_iss: "Alíquota de ISS", iss_retido: "ISS retido", regime: "Regime",
  serie_rps: "Série do RPS", prox_rps: "Próximo nº de RPS",
  nbs: "NBS", class_trib: "cClassTrib", cst_ibscbs: "CST IBS/CBS", ind_operacao: "cIndOp", finalidade: "Finalidade (finNFSe)",
  ind_final: "Consumidor final",
};
const REGIMES: Record<string, string> = { simples: "Simples Nacional", presumido: "Lucro Presumido", real: "Lucro Real", mei: "MEI" };

function exibir(campo: string, v: unknown): string {
  if (v === true) return "Sim";
  if (v === false) return "Não";
  const s = String(v);
  if (campo === "cnpj") return documento(s);
  if (campo === "cep") return fmtCep(s);
  if (campo === "aliquota_iss") return `${(Number(s) * 100).toFixed(2).replace(".", ",")}%`;
  if (campo === "regime") return REGIMES[s] ?? s;
  return s;
}

/**
 * "Ler nota fiscal": a pessoa anexa uma NFS-e que a empresa já emitiu e o sistema devolve o cadastro, a
 * configuração da emissão e os parâmetros IBS/CBS. XML é lido de forma exata (sem IA); PDF e foto passam pela IA.
 */
export function LerNotaFiscal({ aplicar }: { aplicar: (nota: NotaLida, secoes: Set<Secao>) => void }) {
  const [aberto, setAberto] = useState(false);
  const [lida, setLida] = useState<NotaLida | null>(null);
  const [secoes, setSecoes] = useState<Set<Secao>>(new Set(["empresa", "fiscal", "parametros"]));

  const ler = useMutation({
    mutationFn: (arquivo: File) => {
      const fd = new FormData();
      fd.append("arquivo", arquivo);
      return api.post<NotaLida>("/nfse/emissoras/ler-nota", fd);
    },
    onSuccess: (r) => {
      setLida(r);
      setSecoes(new Set((["empresa", "fiscal", "parametros"] as Secao[]).filter((s) => Object.keys(r[s]).length)));
    },
  });

  const dz = useDropzone({
    multiple: false,
    accept: { "text/xml": [".xml"], "application/xml": [".xml"], "application/pdf": [".pdf"], "image/*": [".png", ".jpg", ".jpeg", ".webp"] },
    onDrop: (f) => f[0] && ler.mutate(f[0]),
    onDropRejected: () => toast.error("Envie a nota em XML (recomendado), PDF ou foto."),
  });

  const fechar = (v: boolean) => {
    setAberto(v);
    if (!v) {
      setLida(null);
      ler.reset();
    }
  };

  const alternar = (s: Secao) =>
    setSecoes((atual) => {
      const novo = new Set(atual);
      if (novo.has(s)) novo.delete(s);
      else novo.add(s);
      return novo;
    });

  const SECOES: { id: Secao; titulo: string; icone: typeof Building2; dica: string }[] = [
    { id: "empresa", titulo: "Cadastro da empresa", icone: Building2, dica: "Preenche os campos do formulário." },
    { id: "fiscal", titulo: "Configuração da emissão", icone: ReceiptText, dica: "Serviço, alíquota, regime e numeração do RPS." },
    { id: "parametros", titulo: "Parâmetros IBS/CBS (layout 2)", icone: Landmark, dica: "Viram o padrão da emissora ao salvar." },
  ];

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setAberto(true)} className="gap-1.5">
        <FileScan className="size-4" />
        Ler nota fiscal
      </Button>
      <Dialog open={aberto} onOpenChange={fechar}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileScan className="size-5 text-brand" /> Configurar a partir de uma nota fiscal
            </DialogTitle>
            <DialogDescription>
              Anexe uma NFS-e que esta empresa já emitiu. O sistema lê o cadastro, o serviço, a alíquota, a numeração do RPS e os
              parâmetros de IBS/CBS. Você escolhe o que aplicar.
            </DialogDescription>
          </DialogHeader>

          <AnimatePresence mode="wait">
            {!lida ? (
              <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div
                  {...dz.getRootProps()}
                  className={cn(
                    "grid cursor-pointer place-items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition",
                    dz.isDragActive ? "border-brand bg-brand/5" : "border-border hover:border-brand/50 hover:bg-muted/40",
                  )}
                >
                  <input {...dz.getInputProps()} />
                  {ler.isPending ? (
                    <>
                      <Loader2 className="size-8 animate-spin text-brand" />
                      <p className="text-sm font-medium">Lendo a nota…</p>
                    </>
                  ) : (
                    <>
                      <div className="grid size-12 place-items-center rounded-xl bg-brand/10">
                        <Upload className="size-6 text-brand" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">Arraste a nota aqui ou clique para escolher</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          <FileCode2 className="mr-1 inline size-3.5" />
                          <b>XML</b> (baixado do portal da Prefeitura) é lido com exatidão, sem IA ·{" "}
                          <Sparkles className="mr-1 inline size-3.5" />
                          PDF ou foto usam a IA
                        </p>
                      </div>
                    </>
                  )}
                </div>
              </motion.div>
            ) : (
              <motion.div key="resultado" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-xs font-medium",
                      lida.fonte === "xml" ? "bg-success/12 text-success-ink" : "bg-brand/12 text-brand",
                    )}
                  >
                    {lida.fonte === "xml" ? "Lido do XML · exato" : "Lido pela IA · confira"}
                  </span>
                  {lida.nota.numero && (
                    <span className="text-muted-foreground">
                      NFS-e nº <span className="num">{lida.nota.numero}</span>
                      {lida.nota.tomador ? ` · para ${lida.nota.tomador}` : ""}
                    </span>
                  )}
                </div>

                <div className="max-h-[48vh] space-y-2 overflow-y-auto pr-1">
                  {SECOES.map(({ id, titulo, icone: Icone, dica }) => {
                    const dados = lida[id] as Record<string, unknown>;
                    const campos = Object.entries(dados).filter(([, v]) => v !== null && v !== undefined && v !== "");
                    if (!campos.length) return null;
                    const marcado = secoes.has(id);
                    return (
                      <label
                        key={id}
                        className={cn(
                          "block cursor-pointer rounded-xl border p-3 transition",
                          marcado ? "border-brand/40 bg-brand/[0.04]" : "opacity-60",
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <Checkbox checked={marcado} onCheckedChange={() => alternar(id)} className="mt-0.5" />
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 text-sm font-medium">
                              <Icone className="size-4 text-brand" /> {titulo}
                            </p>
                            <p className="text-xs text-muted-foreground">{dica}</p>
                            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                              {campos.map(([k, v]) => (
                                <div key={k} className="flex justify-between gap-2 border-b border-dashed py-0.5">
                                  <dt className="text-muted-foreground">{ROTULOS[k] ?? k}</dt>
                                  <dd className="num truncate text-right font-medium">{exibir(k, v)}</dd>
                                </div>
                              ))}
                            </dl>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {lida.avisos.length > 0 && (
                  <ul className="space-y-1 rounded-lg border border-warning/30 bg-warning/8 p-3 text-xs text-warning-ink">
                    {lida.avisos.map((a) => (
                      <li key={a} className="flex gap-1.5">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {a}
                      </li>
                    ))}
                  </ul>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <DialogFooter>
            {lida ? (
              <>
                <Button variant="ghost" onClick={() => setLida(null)}>
                  Ler outra nota
                </Button>
                <Button
                  disabled={!secoes.size}
                  onClick={() => {
                    aplicar(lida, secoes);
                    fechar(false);
                  }}
                >
                  Aplicar no cadastro
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => fechar(false)}>
                Cancelar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
