// Comunicador: tipos do contrato (backend/app/comunicador/routes.py) e utilitários de texto.

export type StatusPresenca = "online" | "ocupado" | "ausente" | "offline";

export interface UsuarioChat {
  id: number;
  nome: string;
  login: string | null;
  perfil: string;
  foto_url: string | null;
  status: StatusPresenca;
}

export interface Msg {
  id: number;
  conversa_id: number;
  autor_id: number | null;
  autor_nome: string;
  robo: boolean;
  texto: string;
  apagada: boolean;
  editada: boolean;
  link: string | null;
  resposta_a: { id: number; autor_nome: string; texto: string } | null;
  criada_em: string;
}

export interface Conversa {
  id: number;
  tipo: "direta" | "grupo" | "robo";
  titulo: string;
  participantes: number[];
  outro_id: number | null;
  nao_lidas: number;
  lida_por_todos_ate: number;
  ultima: Msg | null;
  ultima_msg_em: string | null;
}

export interface PaginaMsgs {
  itens: Msg[];
  tem_mais: boolean;
}

export interface Mencao {
  id: number;
  autor_nome: string;
  trecho: string;
  url: string;
  origem_tipo: string | null;
  criada_em: string;
  lida: boolean;
  resolvida: boolean;
}

export interface Resumo {
  nao_lidas: number;
  mencoes: number;
}

export type EventoWS =
  | { tipo: "ola"; online: Record<string, StatusPresenca> }
  | { tipo: "presenca"; usuario_id: number; status: StatusPresenca }
  | { tipo: "mensagem.nova"; mensagem: Msg }
  | { tipo: "mensagem.atualizada"; mensagem: Msg }
  | { tipo: "lida"; conversa_id: number; usuario_id: number; ate_id: number }
  | { tipo: "digitando"; conversa_id: number; usuario_id: number }
  | { tipo: "mencao.nova"; mencao: Mencao }
  | { tipo: "pong" };

export const ROTULO_STATUS: Record<StatusPresenca, string> = {
  online: "Online",
  ocupado: "Ocupado",
  ausente: "Ausente",
  offline: "Offline",
};

/** Cor da bolinha de presença (status: sempre acompanhada do rótulo no painel de pessoas). */
export const COR_STATUS: Record<StatusPresenca, string> = {
  online: "bg-success",
  ocupado: "bg-danger",
  ausente: "bg-warning",
  offline: "bg-muted-foreground/40",
};

// ---------------------------------------------------------------- menções
export const RE_MENCAO = /@\[([^\]]{1,80})\]\((\d+)\)/g;

export type Pedaco = { tipo: "texto"; v: string } | { tipo: "mencao"; nome: string; id: number } | { tipo: "url"; v: string };

/** Quebra o texto em texto puro, menções @[Nome](id) e links http(s). */
export function pedacos(texto: string): Pedaco[] {
  const out: Pedaco[] = [];
  const re = /@\[([^\]]{1,80})\]\((\d+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let ultimo = 0;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    if (m.index > ultimo) out.push({ tipo: "texto", v: texto.slice(ultimo, m.index) });
    if (m[1]) out.push({ tipo: "mencao", nome: m[1], id: Number(m[2]) });
    else out.push({ tipo: "url", v: m[3] });
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) out.push({ tipo: "texto", v: texto.slice(ultimo) });
  return out;
}

/** Texto sem a marcação de menção (para prévias e toasts). */
export const textoSimples = (t: string) => t.replace(RE_MENCAO, "@$1");

/** Botão do link do robô: "Abrir lote →" etc. */
export function rotuloLink(url: string) {
  if (url.includes("/nfse/lotes")) return "Abrir lote";
  if (url.includes("/nfse/notas")) return "Abrir nota";
  if (url.includes("/nfse/faturas")) return "Abrir fatura";
  if (url.includes("/nfse/recebimentos")) return "Abrir extrato";
  if (url.includes("/cadastros/clientes")) return "Abrir cliente";
  if (url.includes("/configuracoes/certificado")) return "Ver certificado";
  return "Abrir";
}

// ---------------------------------------------------------------- datas
const parse = (s: string) => new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
export const dataMsg = parse;
export const diaChave = (s: string) => parse(s).toLocaleDateString("sv-SE");

export function rotuloDia(s: string) {
  const d = parse(s);
  const hoje = new Date();
  const ontem = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  const mesmoAno = d.getFullYear() === hoje.getFullYear();
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", ...(mesmoAno ? {} : { year: "numeric" }) });
}

export const hora = (s: string) => parse(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Hora na lista de conversas: hoje = HH:MM; ontem = "ontem"; antes = dd/mm. */
export function horaLista(s: string | null) {
  if (!s) return "";
  const d = parse(s);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return hora(s);
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return "ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// ---------------------------------------------------------------- som
let ctxAudio: AudioContext | null = null;
/** "Plim" curto e discreto (duas notas suaves), sem arquivo de áudio. */
export function tocarSom() {
  try {
    ctxAudio ??= new AudioContext();
    const a = ctxAudio;
    const t = a.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.07, t + i * 0.09 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.22);
      o.connect(g).connect(a.destination);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.25);
    });
  } catch {
    /* navegador sem áudio ou sem interação ainda */
  }
}
