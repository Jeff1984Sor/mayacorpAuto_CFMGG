import {
  ArrowLeftRight,
  BadgeDollarSign,
  BarChart3,
  Calculator,
  CalendarClock,
  ChartLine,
  Download,
  FilePlus2,
  FolderTree,
  ListOrdered,
  PiggyBank,
  Plus,
  TrendingDown,
  Wallet,
  FileSearch,
  FileSignature,
  KanbanSquare,
  ListChecks,
  Building2,
  FileCheck2,
  FileUp,
  Fingerprint,
  Gauge,
  HandCoins,
  Home,
  KeyRound,
  Landmark,
  Layers,
  LayoutDashboard,
  Mail,
  MessagesSquare,
  Palette,
  Percent,
  ReceiptText,
  ScrollText,
  Sparkles,
  Truck,
  Users,
  UsersRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import type { Perfil } from "@/lib/types";

export interface NavItem {
  label: string;
  href: string;
  icone: LucideIcon;
  perfis?: Perfil[];
  emBreve?: boolean;
  /** Contador ao vivo exibido no item (ex.: mensagens não lidas). */
  badge?: "comunicador" | "revisoes";
  atalho?: string;
  exato?: boolean;
}

export interface NavGrupo {
  titulo: string;
  itens: NavItem[];
}

const TODOS: Perfil[] = ["admin", "operador", "visualizador"];
const OPERA: Perfil[] = ["admin", "operador"];
const ADMIN: Perfil[] = ["admin"];

export const NAV: NavGrupo[] = [
  {
    titulo: "Geral",
    itens: [
      { label: "Início", href: "/", icone: Home, perfis: TODOS, exato: true },
      { label: "Comunicador", href: "/comunicador", icone: MessagesSquare, perfis: TODOS, atalho: "G M", badge: "comunicador" },
    ],
  },
  {
    titulo: "Cadastros",
    itens: [
      { label: "Clientes", href: "/cadastros/clientes", icone: UsersRound, perfis: TODOS, atalho: "G C" },
      { label: "Empresas emissoras", href: "/cadastros/emissoras", icone: Building2, perfis: TODOS },
    ],
  },
  {
    titulo: "Faturamento",
    itens: [
      { label: "Dashboard", href: "/dashboard", icone: LayoutDashboard, perfis: TODOS, atalho: "G D" },
      { label: "Itens a faturar", href: "/faturamento/itens", icone: ListChecks, perfis: TODOS, atalho: "G I" },
      { label: "Revisões", href: "/faturamento/revisoes", icone: FileSearch, perfis: TODOS, badge: "revisoes" },
      { label: "Fluxo de Faturamento", href: "/faturamento/fluxo", icone: KanbanSquare, perfis: TODOS },
      { label: "Contratos", href: "/faturamento/contratos", icone: FileSignature, perfis: TODOS },
      { label: "Faturas", href: "/nfse/faturas", icone: ReceiptText, perfis: TODOS, atalho: "G F" },
      { label: "Relatório de Faturamento", href: "/faturamento/relatorio", icone: BarChart3, perfis: TODOS },
      { label: "Projeção de Impostos", href: "/faturamento/impostos", icone: Calculator, perfis: TODOS },
    ],
  },
  {
    titulo: "Conta Bancária",
    itens: [
      { label: "Contas", href: "/financeiro/contas", icone: Wallet, perfis: TODOS },
      { label: "Nova conta", href: "/financeiro/nova-conta", icone: Plus, perfis: ADMIN },
      { label: "Previsão de Caixa", href: "/financeiro/previsao-caixa", icone: ChartLine, perfis: TODOS },
      { label: "Fluxo de Caixa", href: "/financeiro/fluxo-caixa", icone: ArrowLeftRight, perfis: TODOS },
      { label: "DRE", href: "/financeiro/dre", icone: ListOrdered, perfis: TODOS },
      { label: "Projeção de Despesas", href: "/financeiro/projecao-despesas", icone: TrendingDown, perfis: TODOS },
    ],
  },
  {
    titulo: "Contas a Pagar",
    itens: [
      { label: "Lançamentos", href: "/financeiro/pagar", icone: CalendarClock, perfis: TODOS, exato: true },
      { label: "Nova conta", href: "/financeiro/pagar/nova", icone: FilePlus2, perfis: OPERA },
      { label: "Categorias e Subcategorias", href: "/financeiro/categorias", icone: FolderTree, perfis: TODOS },
      { label: "Fornecedores", href: "/financeiro/fornecedores", icone: Truck, perfis: TODOS },
      { label: "Baixar modelo (.xlsx)", href: "/financeiro/pagar/modelo", icone: Download, perfis: TODOS },
    ],
  },
  {
    titulo: "NFS-e · RPA 01",
    itens: [
      { label: "Painel", href: "/nfse", icone: Gauge, perfis: TODOS, exato: true, atalho: "G P" },
      { label: "Nova emissão", href: "/nfse/nova-emissao", icone: FileUp, perfis: OPERA, atalho: "N" },
      { label: "Lotes", href: "/nfse/lotes", icone: Layers, perfis: TODOS, atalho: "G L" },
      { label: "Notas emitidas", href: "/nfse/notas", icone: FileCheck2, perfis: TODOS, atalho: "G N" },
      { label: "Recebimentos", href: "/nfse/recebimentos", icone: HandCoins, perfis: TODOS, atalho: "G R" },
    ],
  },
  {
    titulo: "Próximos robôs",
    itens: [{ label: "Porto Seguro", href: "#", icone: Truck, perfis: TODOS, emBreve: true }],
  },
  {
    titulo: "Configurações",
    itens: [
      { label: "Identidade", href: "/configuracoes/identidade", icone: Palette, perfis: ADMIN },
      { label: "Certificado digital", href: "/configuracoes/certificado", icone: KeyRound, perfis: ADMIN },
      { label: "Profissionais", href: "/configuracoes/usuarios", icone: Users, perfis: ADMIN },
      { label: "Inteligência Artificial", href: "/configuracoes/ia", icone: Sparkles, perfis: ADMIN },
      { label: "Automações", href: "/configuracoes/automacoes", icone: Workflow, perfis: ADMIN },
      { label: "Prefeitura", href: "/configuracoes/prefeitura", icone: Landmark, perfis: ADMIN },
      { label: "Faturamento", href: "/configuracoes/faturamento", icone: BadgeDollarSign, perfis: ADMIN },
      { label: "Financeiro", href: "/configuracoes/financeiro", icone: PiggyBank, perfis: ADMIN },
      { label: "Parâmetros fiscais", href: "/configuracoes/parametros-fiscais", icone: Percent, perfis: ADMIN },
      { label: "Notificações e e-mail", href: "/configuracoes/notificacoes", icone: Mail, perfis: ADMIN },
      { label: "Auditoria", href: "/auditoria", icone: ScrollText, perfis: ADMIN },
    ],
  },
];

export const ICONE_AUTOMACAO: Record<string, LucideIcon> = {
  nfse: FileCheck2,
  porto: Truck,
  fingerprint: Fingerprint,
};

export function navPara(perfil: Perfil | undefined): NavGrupo[] {
  if (!perfil) return [];
  return NAV.map((g) => ({ ...g, itens: g.itens.filter((i) => !i.perfis || i.perfis.includes(perfil)) })).filter(
    (g) => g.itens.length > 0,
  );
}

export function ativo(pathname: string, item: NavItem) {
  if (item.href === "#") return false;
  return item.exato ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
