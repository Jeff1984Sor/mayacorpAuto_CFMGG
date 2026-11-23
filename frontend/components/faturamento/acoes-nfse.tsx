"use client";

import { Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";

import { abrirArquivo, baixar } from "@/lib/api";

/** Dois atalhos da nota fiscal de uma fatura: Visualizar (na Prefeitura; nota de teste abre o PDF) e Baixar (PDF). */
export function AcoesNfse({ nfseId, numero, link }: { nfseId: number; numero?: number | null; link?: string | null }) {
  const pdf = `/nfse/notas/${nfseId}/pdf`;
  const falhou = () => toast.error("Não consegui abrir o PDF da nota.");
  const estilo =
    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-info-ink transition hover:bg-brand/10";
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1" onClick={(e) => e.stopPropagation()}>
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" className={estilo} title="Abrir a nota no site da Prefeitura">
          <ExternalLink className="size-3" /> Visualizar NFS-e
        </a>
      ) : (
        <button type="button" className={estilo} onClick={() => abrirArquivo(pdf).catch(falhou)} title="Abrir o PDF da nota">
          <ExternalLink className="size-3" /> Visualizar NFS-e
        </button>
      )}
      <button
        type="button"
        className={estilo}
        onClick={() => baixar(pdf, {}, `NFSe_${numero ?? nfseId}.pdf`).catch(falhou)}
        title="Baixar o PDF da nota"
      >
        <Download className="size-3" /> Baixar NFS-e
      </button>
    </span>
  );
}
