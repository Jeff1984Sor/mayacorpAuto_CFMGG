import { toast } from "sonner";

import { api, baixar, baixarBlob } from "./api";

/**
 * Demonstração do "salvar no Drive do cliente": grava as faturas numa pasta do computador, uma pasta por caso
 * (NH - <caso>.pdf, ND - <caso>.pdf, Anexos/…). No Chrome/Edge grava direto na pasta escolhida (abre em Downloads e
 * o navegador lembra a escolha); nos outros navegadores baixa um .zip com as mesmas pastas.
 */

interface Pasta {
  nome: string;
  arquivos: { caminho: string; url: string }[];
}

type Dir = FileSystemDirectoryHandle & {
  queryPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: "readwrite" }) => Promise<PermissionState>;
};
type ComPicker = Window & { showDirectoryPicker?: (o: Record<string, unknown>) => Promise<Dir> };

const BANCO = "mayajus-pastas";
const CHAVE = "faturas";

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
    return null; // aba anônima ou armazenamento bloqueado: pergunta a pasta de novo
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

export const gravaEmPasta = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

async function gravar(raiz: Dir, pastas: Pasta[]) {
  let n = 0;
  for (const p of pastas) {
    const caso = await raiz.getDirectoryHandle(p.nome, { create: true });
    for (const a of p.arquivos) {
      const partes = a.caminho.split("/");
      let dir: FileSystemDirectoryHandle = caso;
      for (const sub of partes.slice(0, -1)) dir = await dir.getDirectoryHandle(sub, { create: true });
      const { blob } = await baixarBlob(a.url);
      const arq = await dir.getFileHandle(partes[partes.length - 1], { create: true });
      const w = await arq.createWritable();
      await w.write(blob);
      await w.close();
      n++;
    }
  }
  return n;
}

/** Grava as faturas na pasta. `escolher` = abrir o seletor (precisa vir de um clique). */
export async function salvarFaturasNaPasta(ids: number[], escolher = true): Promise<boolean> {
  const pastas = await api.get<Pasta[]>("/nfse/pasta-faturas", { ids });
  if (!gravaEmPasta()) {
    await baixar("/nfse/pasta-faturas.zip", { query: { ids } }, "Faturas.zip");
    toast.success("Pastas baixadas em .zip", { description: "Seu navegador não grava direto em pastas: extraia o .zip em Downloads." });
    return true;
  }
  let raiz = await pastaGuardada();
  let ok = raiz && (await raiz.queryPermission?.({ mode: "readwrite" })) === "granted";
  if (!ok && raiz && escolher) ok = (await raiz.requestPermission?.({ mode: "readwrite" })) === "granted";
  if (!ok) {
    if (!escolher) return false;
    try {
      raiz = await (window as ComPicker).showDirectoryPicker!({ id: "mayajus-faturas", mode: "readwrite", startIn: "downloads" });
    } catch {
      return false; // fechou o seletor
    }
    await guardarPasta(raiz);
  }
  const n = await gravar(raiz!, pastas);
  toast.success(`${n} arquivo(s) salvo(s) na pasta ${raiz!.name}`, {
    description: pastas.map((p) => `📁 ${p.nome}`).join("  ·  "),
    duration: 8000,
  });
  return true;
}

/** Depois de criar faturas: se a opção estiver ligada, grava sozinho (pasta já liberada) ou oferece o botão. */
export async function aposCriarFaturas(ids: number[]) {
  if (!ids.length) return;
  try {
    const cfg = await api.get<{ fatura_salvar_pasta: boolean }>("/config/automacoes");
    if (!cfg.fatura_salvar_pasta) return;
    if (await salvarFaturasNaPasta(ids, false)) return;
    toast("Salvar os arquivos no computador?", {
      description: "Uma pasta por caso, com NH, ND e os anexos das despesas.",
      duration: 20000,
      action: { label: "Escolher pasta", onClick: () => void salvarFaturasNaPasta(ids).catch((e) => toast.error(String(e))) },
    });
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Não foi possível salvar na pasta.");
  }
}
