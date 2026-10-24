import type { TokenOut } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api").replace(/\/$/, "");

const ACCESS = "maya.access";
const REFRESH = "maya.refresh";

export const tokens = {
  get access() {
    return typeof window === "undefined" ? null : localStorage.getItem(ACCESS);
  },
  get refresh() {
    return typeof window === "undefined" ? null : localStorage.getItem(REFRESH);
  },
  set(t: Pick<TokenOut, "access_token" | "refresh_token">) {
    localStorage.setItem(ACCESS, t.access_token);
    localStorage.setItem(REFRESH, t.refresh_token);
  },
  clear() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
  },
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

type PydanticErro = { loc?: (string | number)[]; msg?: string };

function mensagemDeErro(status: number, body: unknown): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return (detail as PydanticErro[])
        .map((d) => {
          const campo = d.loc?.filter((l) => l !== "body").join(".");
          return campo ? `${campo}: ${d.msg}` : d.msg;
        })
        .join(" · ");
    }
  }
  if (status === 0) return "Não foi possível falar com o servidor. Verifique sua conexão.";
  if (status >= 500) return "O servidor teve um problema. Tente novamente em instantes.";
  return `Erro ${status}`;
}

let refreshing: Promise<boolean> | null = null;

export async function tentarRefresh(): Promise<boolean> {
  const rt = tokens.refresh;
  if (!rt) return false;
  refreshing ??= fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: rt }),
  })
    .then(async (r) => {
      if (!r.ok) return false;
      tokens.set((await r.json()) as TokenOut);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function irParaLogin() {
  tokens.clear();
  if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
    const volta = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?volta=${volta}`;
  }
}

export interface RequestOpts extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** arrays viram parâmetros repetidos (?a=1&a=2) */
  query?: Record<string, string | number | boolean | null | undefined | (string | number)[]>;
  auth?: boolean;
}

function montarUrl(path: string, query?: RequestOpts["query"]) {
  const url = new URL(API_URL + path);
  Object.entries(query ?? {}).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
    else if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  return url.toString();
}

async function rawFetch(path: string, opts: RequestOpts = {}, retry = true): Promise<Response> {
  const { body, query, auth = true, headers, ...rest } = opts;
  const h = new Headers(headers);
  let payload: BodyInit | undefined;
  if (body instanceof FormData || body instanceof Blob) payload = body;
  else if (body !== undefined) {
    h.set("Content-Type", "application/json");
    payload = JSON.stringify(body);
  }
  if (auth && tokens.access) h.set("Authorization", `Bearer ${tokens.access}`);

  let res: Response;
  try {
    res = await fetch(montarUrl(path, query), { ...rest, headers: h, body: payload });
  } catch {
    throw new ApiError(0, mensagemDeErro(0, null));
  }

  if (res.status === 401 && auth && retry) {
    if (await tentarRefresh()) return rawFetch(path, opts, false);
    irParaLogin();
  }
  if (!res.ok) {
    let b: unknown = null;
    try {
      b = await res.json();
    } catch {
      /* corpo vazio */
    }
    throw new ApiError(res.status, mensagemDeErro(res.status, b), b);
  }
  return res;
}

export async function api<T = unknown>(path: string, opts: RequestOpts = {}): Promise<T> {
  const res = await rawFetch(path, opts);
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  return (ct.includes("json") ? res.json() : res.text()) as Promise<T>;
}

api.get = <T>(path: string, query?: RequestOpts["query"]) => api<T>(path, { query });
api.post = <T>(path: string, body?: unknown, opts?: RequestOpts) => api<T>(path, { ...opts, method: "POST", body });
api.put = <T>(path: string, body?: unknown) => api<T>(path, { method: "PUT", body });
api.patch = <T>(path: string, body?: unknown) => api<T>(path, { method: "PATCH", body });
api.del = <T>(path: string) => api<T>(path, { method: "DELETE" });

function nomeDoCabecalho(res: Response, fallback: string) {
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
  return m ? decodeURIComponent(m[1] ?? m[2]) : fallback;
}

/** Busca um arquivo autenticado e devolve blob + nome. */
export async function baixarBlob(path: string, opts: RequestOpts = {}, fallback = "arquivo") {
  const res = await rawFetch(path, opts);
  return { blob: await res.blob(), nome: nomeDoCabecalho(res, fallback) };
}

/** Faz download autenticado (fetch com Bearer → blob → objectURL). */
export async function baixar(path: string, opts: RequestOpts = {}, fallback = "arquivo") {
  const { blob, nome } = await baixarBlob(path, opts, fallback);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Abre um arquivo autenticado (ex.: PDF) em nova aba. */
export async function abrirArquivo(path: string) {
  const janela = window.open("", "_blank");
  const { blob } = await baixarBlob(path);
  const url = URL.createObjectURL(blob);
  if (janela) janela.location.href = url;
  else window.open(url, "_blank");
}

export function sseUrl(path: string) {
  return montarUrl(path, { token: tokens.access ?? "" });
}
