import {
  ArrowLeftRight,
  BadgeDollarSign,
  BarChart3,
  Briefcase,
  Clock,
  ListTodo,
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
  Inbox,
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
  ShieldCheck,
  Workflow,
  Scale,
  Gavel,
  ScanSearch,
  Stamp,
  BadgeCheck,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icone: LucideIcon;
  /** Permissão do perfil de acesso exigida ("recurso.acao"); sem ela, basta estar logado. */
  permissao?: string;
  emBreve?: boolean;
  /** Contador ao vivo exibido no item (ex.: mensagens não lidas). */
  badge?: "comunicador" | "revisoes" | "tarefas";
  atalho?: string;
  /** Só para a equipe MayaCorp (ex.: chave da IA). */
  equipe?: boolean;
  /** Só no admin MayaCorp (clientes, planos, contratos). */
  painel?: boolean;
  /** Some no admin MayaCorp: item de advocacia, ou o equivalente fica no grupo MayaCorp (um menu só). */
  foraDoPainel?: boolean;
  exato?: boolean;
}

export interface NavGrupo {
  titulo: string;
  itens: NavItem[];
}

export const NAV: NavGrupo[] = [
  {
    titulo: "MayaCorp",
    itens: [
      { label: "Clientes", href: "/admin/clientes", icone: Building2, painel: true },
      { label: "Solicitações", href: "/admin/solicitacoes", icone: Inbox, painel: true },
      { label: "Contratos", href: "/admin/contratos", icone: ScrollText, painel: true },
      { label: "Cobranças", href: "/admin/cobrancas", icone: HandCoins, painel: true },
      { label: "Planos e indicação", href: "/admin/planos", icone: BadgeDollarSign, painel: true },
    ],
  },
  {
    titulo: "Geral",
    itens: [
      { label: "Início", href: "/", icone: Home, exato: true },
      { label: "Comunicador", href: "/comunicador", icone: MessagesSquare, permissao: "comunicador.usar", atalho: "G M", badge: "comunicador" },
    ],
  },
  {
    titulo: "Cadastros",
    itens: [
      { label: "Clientes", href: "/cadastros/clientes", icone: UsersRound, permissao: "clientes.ver", atalho: "G C", foraDoPainel: true },
      { label: "Contratos", href: "/faturamento/contratos", icone: FileSignature, permissao: "contratos.ver", foraDoPainel: true },
      { label: "Casos", href: "/faturamento/casos", icone: Briefcase, permissao: "casos.ver", foraDoPainel: true },
      { label: "Tarefas", href: "/faturamento/tarefas", icone: ListTodo, permissao: "tarefas.ver", badge: "tarefas", foraDoPainel: true },
      { label: "Timesheet", href: "/faturamento/timesheet", icone: Clock, permissao: "timesheet.ver", foraDoPainel: true },
    ],
  },
  {
    titulo: "Faturamento",
    itens: [
      { label: "Dashboard", href: "/dashboard", icone: LayoutDashboard, permissao: "dashboard.ver", atalho: "G D" },
      { label: "Itens a faturar", href: "/faturamento/itens", icone: ListChecks, permissao: "itens_faturar.ver", atalho: "G I" },
      { label: "Revisões", href: "/faturamento/revisoes", icone: FileSearch, permissao: "revisoes.ver", badge: "revisoes" },
      { label: "Fluxo de Faturamento", href: "/faturamento/fluxo", icone: KanbanSquare, permissao: "faturas.ver" },
      { label: "Faturas", href: "/nfse/faturas", icone: ReceiptText, permissao: "faturas.ver", atalho: "G F" },
      { label: "Relatório de Faturamento", href: "/faturamento/relatorio", icone: BarChart3, permissao: "relatorio_faturamento.ver" },
      { label: "Projeção de Impostos", href: "/faturamento/impostos", icone: Calculator, permissao: "impostos.ver" },
    ],
  },
  {
    titulo: "Conta Bancária",
    itens: [
      { label: "Contas", href: "/financeiro/contas", icone: Wallet, permissao: "contas_bancarias.ver" },
      { label: "Nova conta", href: "/financeiro/nova-conta", icone: Plus, permissao: "contas_bancarias.editar" },
      { label: "Previsão de Caixa", href: "/financeiro/previsao-caixa", icone: ChartLine, permissao: "relatorios_fin.ver" },
      { label: "Fluxo de Caixa", href: "/financeiro/fluxo-caixa", icone: ArrowLeftRight, permissao: "relatorios_fin.ver" },
      { label: "DRE", href: "/financeiro/dre", icone: ListOrdered, permissao: "relatorios_fin.ver" },
      { label: "Projeção de Despesas", href: "/financeiro/projecao-despesas", icone: TrendingDown, permissao: "relatorios_fin.ver" },
    ],
  },
  {
    titulo: "Contas a Pagar",
    itens: [
      { label: "Lançamentos", href: "/financeiro/pagar", icone: CalendarClock, permissao: "contas_pagar.ver", exato: true },
      { label: "Nova conta", href: "/financeiro/pagar/nova", icone: FilePlus2, permissao: "contas_pagar.editar" },
      { label: "Categorias e Subcategorias", href: "/financeiro/categorias", icone: FolderTree, permissao: "categorias_fin.ver" },
      { label: "Fornecedores", href: "/financeiro/fornecedores", icone: Truck, permissao: "fornecedores.ver" },
      { label: "Baixar modelo (.xlsx)", href: "/financeiro/pagar/modelo", icone: Download, permissao: "contas_pagar.editar" },
    ],
  },
  {
    titulo: "NFS-e · RPA 01",
    itens: [
      { label: "Painel", href: "/nfse", icone: Gauge, permissao: "nfse_notas.ver", exato: true, atalho: "G P" },
      { label: "Nova emissão em lote", href: "/nfse/nova-emissao", icone: FileUp, permissao: "nfse_emissao.emitir", atalho: "N" },
      { label: "Lotes", href: "/nfse/lotes", icone: Layers, permissao: "nfse_emissao.ver", atalho: "G L" },
      { label: "Notas emitidas", href: "/nfse/notas", icone: FileCheck2, permissao: "nfse_notas.ver", atalho: "G N" },
      { label: "Recebimentos", href: "/nfse/recebimentos", icone: HandCoins, permissao: "nfse_recebimentos.ver", atalho: "G R" },
    ],
  },
  {
    titulo: "Tribunais",
    itens: [
      { label: "Painel", href: "/tribunais", icone: Scale, permissao: "trib_processos.ver", exato: true, atalho: "G T", foraDoPainel: true },
      { label: "Processos", href: "/tribunais/processos", icone: Gavel, permissao: "trib_processos.ver", foraDoPainel: true },
      { label: "Buscar pela OAB", href: "/tribunais/varredura", icone: ScanSearch, permissao: "trib_processos.importar", foraDoPainel: true },
      { label: "Protocolos", href: "/tribunais/protocolos", icone: Stamp, permissao: "trib_protocolos.ver", foraDoPainel: true },
      { label: "Meu certificado e OAB", href: "/tribunais/meu-certificado", icone: BadgeCheck, foraDoPainel: true },
    ],
  },
  {
    titulo: "Próximos robôs",
    itens: [{ label: "Porto Seguro", href: "#", icone: Truck, emBreve: true, foraDoPainel: true }],
  },
  {
    titulo: "Configurações",
    itens: [
      { label: "Identidade", href: "/configuracoes/identidade", icone: Palette, permissao: "cfg_identidade.ver" },
      { label: "Empresas emissoras", href: "/cadastros/emissoras", icone: Building2, permissao: "cfg_emissoras.ver" },
      { label: "Certificado digital", href: "/configuracoes/certificado", icone: KeyRound, permissao: "cfg_certificado.ver" },
      { label: "Profissionais", href: "/configuracoes/usuarios", icone: Users, permissao: "cfg_profissionais.ver" },
      { label: "Perfis de acesso", href: "/configuracoes/perfis", icone: ShieldCheck, permissao: "cfg_perfis.ver" },
      { label: "Inteligência Artificial", href: "/configuracoes/ia", icone: Sparkles, equipe: true },
      { label: "Automações", href: "/configuracoes/automacoes", icone: Workflow, permissao: "cfg_automacoes.ver" },
      { label: "Prefeitura", href: "/configuracoes/prefeitura", icone: Landmark, permissao: "cfg_prefeitura.ver" },
      { label: "Faturamento", href: "/configuracoes/faturamento", icone: BadgeDollarSign, permissao: "cfg_faturamento.ver" },
      { label: "Financeiro", href: "/configuracoes/financeiro", icone: PiggyBank, permissao: "cfg_financeiro.ver" },
      { label: "Parâmetros fiscais", href: "/configuracoes/parametros-fiscais", icone: Percent, permissao: "cfg_parametros.ver" },
      { label: "Notificações e e-mail", href: "/configuracoes/notificacoes", icone: Mail, permissao: "cfg_notificacoes.ver" },
      { label: "Tribunais", href: "/configuracoes/tribunais", icone: Scale, permissao: "cfg_tribunais.ver" },
      { label: "Auditoria", href: "/auditoria", icone: ScrollText, permissao: "auditoria.ver" },
    ],
  },
];

export const ICONE_AUTOMACAO: Record<string, LucideIcon> = {
  nfse: FileCheck2,
  porto: Truck,
  tribunais: Scale,
  fingerprint: Fingerprint,
};

export function navPara(
  pode: ((permissao: string) => boolean) | undefined,
  equipeMayaCorp = false,
  painelMayaCorp = false,
): NavGrupo[] {
  if (!pode) return [];
  return NAV.map((g) => ({
    ...g,
    itens: g.itens.filter(
      (i) => (!i.permissao || pode(i.permissao)) && (!i.equipe || equipeMayaCorp) && (!i.painel || painelMayaCorp) && !(i.foraDoPainel && painelMayaCorp),
    ),
  })).filter((g) => g.itens.length > 0);
}

/** Item do menu que cobre o endereço (o mais específico), para o bloqueio de página. */
export function itemDaRota(pathname: string): NavItem | undefined {
  let melhor: NavItem | undefined;
  for (const g of NAV)
    for (const i of g.itens)
      if (i.href !== "#" && i.href !== "/" && (pathname === i.href || pathname.startsWith(`${i.href}/`)))
        if (!melhor || i.href.length > melhor.href.length) melhor = i;
  return melhor;
}

export function ativo(pathname: string, item: NavItem) {
  if (item.href === "#") return false;
  return item.exato ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
