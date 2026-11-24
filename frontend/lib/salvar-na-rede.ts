import { toast } from "sonner";

import { api, baixarBlob } from "./api";

/**
 * Botão "Salvar na Rede": grava a NH/ND e a NF de cada fatura direto na pasta do caso, dentro de uma pasta da rede
 * escolhida uma vez (o navegador lembra). A pasta do caso vem do modelo do cliente (ex.: o nº do sinistro): se já
 * existir na rede uma pasta com esse número no nome, os arquivos vão para ela; senão, a pasta é criada.
 * Só Chrome e Edge gravam direto em pastas.
 */

interface PastaRede {
  nome: string;
  /** o cliente tem modelo de pasta: vale procurar uma pasta existente que contenha esse nome */
  casada: boolean;
  arquivos: { nome: string; url: string }[];
}

type Dir = FileSystemDirectoryHandle & {
  queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  entries?: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};
type ComPicker = Window & { showDirectoryPicker?: (o: Record<string, unknown>) => Promise<Dir> };

const BANCO = "mayajus-rede";
const CHAVE = "raiz";

function abrirBanco(): Promise<IDBDatabase> {
  return new Promise((ok, erro) => {
    const r = indexedDB.open(BANCO, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("handles");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => erro(r.error);
  });
}

async function pastaGuardada(): Promise<Dir | null> {
  try {
    const db = await abrirBanco();
    return await new Promise((ok) => {
      const r = db.transaction("handles").objectStore("handles").get(CHAVE);
      r.onsuccess = () => ok((r.result as Dir) ?? null);
      r.onerror = () => ok(null);
    });
  } catch {
    return null;
  }
}

async function guardarPasta(dir: Dir) {
  try {
    const db = await abrirBanco();
    db.transaction("handles", "readwrite").objectStore("handles").put(dir, CHAVE);
  } catch {
    /* sem armazenamento: só não lembra a pasta */
  }
}

export const podeSalvarNaRede = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

/** só letras e números, minúsculo: "1038248/2026", "1038248-2026" e "1038248 2026" ficam iguais */
const chave = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

async function escolherRaiz(trocar: boolean): Promise<Dir | null> {
  let raiz = trocar ? null : await pastaGuardada();
  let ok = !!raiz && (await raiz.queryPermission?.({ mode: "readwrite" })) === "granted";
  if (!ok && raiz) ok = (await raiz.requestPermission?.({ mode: "readwrite" })) === "granted";
  if (ok) return raiz;
  try {
    raiz = await (window as ComPicker).showDirectoryPicker!({ id: "mayajus-rede", mode: "readwrite" });
  } catch {
    return null; // fechou o seletor
  }
  await guardarPasta(raiz);
  return raiz;
}

/** Grava os arquivos das faturas na rede. Precisa vir de um clique (o navegador exige para abrir a pasta). */
export async function salvarNaRede(ids: number[], trocarPasta = false): Promise<void> {
  if (!podeSalvarNaRede()) {
    toast.error("Este navegador não grava direto em pastas. Use o Chrome ou o Edge para o Salvar na Rede.");
    return;
  }
  const raiz = await escolherRaiz(trocarPasta);
  if (!raiz) return;
  const pastas = await api.get<PastaRede[]>("/nfse/rede-faturas", { ids });
  if (!pastas.length) {
    toast.info("Nenhuma fatura para salvar (faturas canceladas ficam de fora).");
    return;
  }
  // pastas que já existem na rede, para casar pelo número (ex.: "1038248-2026 - Fulano x Beltrano")
  const existentes: { nome: string; chave: string }[] = [];
  if (raiz.entries) {
    for await (const [nome, h] of raiz.entries()) if (h.kind === "directory") existentes.push({ nome, chave: chave(nome) });
  }
  let arquivos = 0;
  let criadas = 0;
  const falhas: string[] = [];
  for (const p of pastas) {
    const alvo = chave(p.nome);
    const achada = existentes.find((e) => e.chave === alvo) ?? (p.casada && alvo.length >= 5 ? existentes.find((e) => e.chave.includes(alvo)) : undefined);
    try {
      const dir = await raiz.getDirectoryHandle(achada?.nome ?? p.nome, { create: true });
      if (!achada) {
        criadas++;
        existentes.push({ nome: p.nome, chave: alvo });
      }
      for (const a of p.arquivos) {
        const { blob } = await baixarBlob(a.url);
        const arq = await dir.getFileHandle(a.nome, { create: true });
        const w = await arq.createWritable();
        await w.write(blob);
        await w.close();
        arquivos++;
      }
    } catch (e) {
      falhas.push(`${p.nome}: ${e instanceof Error ? e.message : "não foi possível gravar"}`);
    }
  }
  if (arquivos)
    toast.success(`${arquivos} arquivo(s) salvo(s) em ${raiz.name}`, {
      description: `${pastas.length - falhas.length} pasta(s)${criadas ? `, ${criadas} criada(s) agora` : ", todas já existiam"}.`,
      duration: 9000,
      action: { label: "Trocar pasta", onClick: () => void salvarNaRede(ids, true).catch((e) => toast.error(String(e))) },
    });
  falhas.slice(0, 5).forEach((f) => toast.error(f));
}
