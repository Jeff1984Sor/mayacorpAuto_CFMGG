"use client";

import {
  BadgeDollarSign,
  Building2,
  Compass,
  FileUp,
  HandCoins,
  Inbox,
  type LucideIcon,
  MessagesSquare,
  PartyPopper,
  ReceiptText,
  ScrollText,
  Search,
  Sparkles,
  UserCog,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { UsuarioMe } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Tour guiado: destaca cada parte da tela (elementos com data-tour="…") e explica num cartão.
 * Abre sozinho no primeiro acesso de cada usuário (preferência "tour_visto") e pelo menu do usuário › Tour guiado.
 * Passo cujo alvo não existe para o usuário (sem permissão, celular, grupo recolhido) é pulado.
 */

interface Passo {
  alvo?: string; // valor de data-tour; sem alvo = cartão no centro
  rota?: string; // tela onde o passo acontece
  icone: LucideIcon;
  titulo: string;
  texto: string;
}

const EVENTO = "mayajus:tour";

export function iniciarTour() {
  window.dispatchEvent(new Event(EVENTO));
}

function passosEscritorio(nome: string): Passo[] {
  return [
    {
      icone: Sparkles,
      titulo: `Boas-vindas, ${nome}!`,
      texto:
        "Em um minuto você conhece o MayaJus: onde ficam os clientes, o faturamento, as notas fiscais e o financeiro do escritório.",
    },
    {
      alvo: "menu",
      icone: Compass,
      titulo: "Tudo começa pelo menu",
      texto:
        "Os módulos ficam agrupados aqui. Clique no nome de um grupo para recolher ou abrir. O MayaJus lembra como você deixou.",
    },
    {
      alvo: "busca",
      icone: Search,
      titulo: "Ache qualquer coisa",
      texto:
        "Notas, clientes, lotes e telas, sem sair de onde está. Atalho: Ctrl + K.",
    },
    {
      alvo: "nav:/cadastros/emissoras",
      icone: Building2,
      titulo: "1º passo: a empresa emissora",
      texto:
        "Cadastre o CNPJ que emite as notas e envie o certificado digital A1. É ele que assina as NFS-e na Prefeitura.",
    },
    {
      alvo: "nav:/configuracoes/usuarios",
      icone: Users,
      titulo: "2º passo: traga a equipe",
      texto:
        "Cadastre os profissionais com cargo e OAB. Quem só lança horas não precisa de login; quem usa o sistema recebe convite por e-mail.",
    },
    {
      alvo: "nav:/cadastros/clientes",
      icone: UsersRound,
      titulo: "Seus clientes",
      texto:
        "Cadastro único, usado em contratos, faturas e notas. Busque pelo CNPJ e os dados vêm da Receita.",
    },
    {
      alvo: "nav:/faturamento/contratos",
      icone: ScrollText,
      titulo: "Contratos e regras de cobrança",
      texto:
        "Valor fixo, recorrente ou por hora. Defina quem paga, inclusive dividido entre clientes, e o sistema monta os itens a faturar.",
    },
    {
      alvo: "nav:/faturamento/revisoes",
      icone: ReceiptText,
      titulo: "Revise antes de faturar",
      texto:
        "As pré-faturas ficam em revisão, com ajuda da IA. Aprovou, vira Nota de Honorários (NH) ou Nota de Despesas (ND).",
    },
    {
      alvo: "nav:/nfse/nova-emissao",
      icone: FileUp,
      titulo: "Notas fiscais em lote",
      texto:
        "Envie o arquivo e o robô emite as NFS-e na Prefeitura, assinadas e conferidas. Comece no modo Teste para ver sem emitir de verdade.",
    },
    {
      alvo: "nav:/financeiro/contas",
      icone: Wallet,
      titulo: "Financeiro em dia",
      texto:
        "Contas bancárias, extrato, contas a pagar, fluxo de caixa e DRE. Fatura paga já entra como crédito na conta.",
    },
    {
      alvo: "comunicador",
      icone: MessagesSquare,
      titulo: "Converse com a equipe",
      texto:
        "Mensagens internas e menções, sem sair do sistema. As novas aparecem aqui embaixo.",
    },
    {
      alvo: "usuario",
      icone: UserCog,
      titulo: "Sua conta",
      texto:
        "Foto, senha, Meu plano e este tour, que você pode rever quando quiser em Tour guiado.",
    },
    {
      icone: PartyPopper,
      titulo: "Tudo pronto!",
      texto:
        "Comece pela empresa emissora e o certificado. Ficou alguma dúvida? Use o assistente de IA ou fale com a MayaCorp.",
    },
  ];
}

function passosAdmin(nome: string): Passo[] {
  return [
    {
      icone: Sparkles,
      titulo: `Boas-vindas ao admin, ${nome}!`,
      texto:
        "Aqui você cuida da carteira de clientes do MayaJus: cadastros, contratos, cobranças e planos.",
    },
    {
      alvo: "nav:/admin/clientes",
      icone: Building2,
      titulo: "Clientes",
      texto:
        "Cada escritório tem o próprio banco. Na ficha ficam plano, uso do mês, usuários, domínios, contratos e cobranças.",
    },
    {
      alvo: "nav:/admin/solicitacoes",
      icone: Inbox,
      titulo: "Solicitações do site",
      texto:
        "Quem se cadastra no formulário aparece aqui, e o aviso chega por e-mail. Aprovou, o ambiente nasce com teste grátis e boas-vindas.",
    },
    {
      alvo: "nav:/admin/contratos",
      icone: ScrollText,
      titulo: "Contratos",
      texto:
        "Modelos com variáveis e os contratos gerados para cada cliente, em PDF, prontos para enviar.",
    },
    {
      alvo: "nav:/admin/cobrancas",
      icone: HandCoins,
      titulo: "Cobranças pelo Mercado Pago",
      texto:
        "As mensalidades saem sozinhas todo dia 1, com link de Pix, cartão ou boleto. A baixa é automática quando o cliente paga.",
    },
    {
      alvo: "nav:/admin/planos",
      icone: BadgeDollarSign,
      titulo: "Planos e indicação",
      texto:
        "Preços, limites, desconto por indicação e a senha do usuário Suporte de cada escritório novo.",
    },
    {
      alvo: "usuario",
      icone: UserCog,
      titulo: "Sempre por aqui",
      texto: "Rever este tour, trocar a senha ou sair.",
    },
    { icone: PartyPopper, titulo: "É isso!", texto: "Bons negócios. 🚀" },
  ];
}

const visivel = (el: Element | null): el is HTMLElement => {
  if (!el) return false;
  const r = (el as HTMLElement).getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

function alvoDe(p: Passo) {
  if (!p.alvo) return null;
  const todos = Array.from(
    document.querySelectorAll(`[data-tour="${p.alvo}"]`),
  );
  return todos.find(visivel) ?? null;
}

type Caixa = { x: number; y: number; w: number; h: number };
const FOLGA = 8;
const LARG = 360;

export function TourGuiado() {
  const { usuario } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);
  const [i, setI] = useState(0);
  const [caixa, setCaixa] = useState<Caixa | null>(null);
  const [tela, setTela] = useState({ w: 0, h: 0 });

  const nome = usuario?.nome.split(" ")[0] ?? "";
  const passos = useMemo(
    () =>
      usuario?.painel_mayacorp ? passosAdmin(nome) : passosEscritorio(nome),
    [usuario?.painel_mayacorp, nome],
  );
  const passo = passos[i];

  const qc = useQueryClient();
  const marcarVisto = useCallback(() => {
    if (usuario?.preferencias?.tour_visto) return;
    qc.setQueryData<UsuarioMe>(["me"], (u) =>
      u ? { ...u, preferencias: { ...u.preferencias, tour_visto: true } } : u,
    );
    api.put<UsuarioMe>("/auth/me/preferencias", { tour_visto: true }).then(
      (u) => qc.setQueryData(["me"], u),
      () => undefined,
    );
  }, [qc, usuario?.preferencias?.tour_visto]);
  const fechar = useCallback(() => {
    setAberto(false);
    marcarVisto();
  }, [marcarVisto]);

  // abre pelo menu e, sozinho, no primeiro acesso (na tela inicial, com o menu visível)
  useEffect(() => {
    const abrir = () => {
      setI(0);
      setAberto(true);
    };
    window.addEventListener(EVENTO, abrir);
    return () => window.removeEventListener(EVENTO, abrir);
  }, []);
  useEffect(() => {
    if (!usuario || usuario.preferencias?.tour_visto || pathname !== "/")
      return;
    const t = setTimeout(iniciarTour, 900);
    return () => clearTimeout(t);
  }, [usuario, pathname]);

  // posiciona o destaque no alvo do passo (pula o passo se o alvo não existe para este usuário)
  const medir = useCallback(() => {
    setTela({ w: window.innerWidth, h: window.innerHeight });
    if (!passo) return;
    const el = alvoDe(passo);
    if (!el) {
      setCaixa(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setCaixa({
      x: r.left - FOLGA,
      y: r.top - FOLGA,
      w: r.width + FOLGA * 2,
      h: r.height + FOLGA * 2,
    });
  }, [passo]);

  const [direcao, setDirecao] = useState(1);
  /* eslint-disable react-hooks/set-state-in-effect -- sincroniza o destaque com o DOM (medidas da tela) */
  useLayoutEffect(() => {
    if (!aberto || !passo) return;
    if (passo.rota && pathname !== passo.rota) {
      router.push(passo.rota);
      return;
    }
    if (passo.alvo) {
      const el = alvoDe(passo);
      if (!el) {
        // sem o alvo (sem permissão, celular): segue no mesmo sentido
        const prox = i + direcao;
        if (prox >= 0 && prox < passos.length) setI(prox);
        else fechar();
        return;
      }
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    medir();
    const t = setTimeout(medir, 350); // depois da rolagem suave
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir, true);
    };
  }, [
    aberto,
    passo,
    i,
    pathname,
    router,
    medir,
    direcao,
    passos.length,
    fechar,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const ir = useCallback(
    (delta: number) => {
      setDirecao(delta);
      const prox = i + delta;
      if (prox >= passos.length) fechar();
      else if (prox >= 0) setI(prox);
    },
    [i, passos.length, fechar],
  );

  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") fechar();
      else if (e.key === "ArrowRight" || e.key === "Enter") ir(1);
      else if (e.key === "ArrowLeft") ir(-1);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberto, ir, fechar]);

  if (!aberto || !passo) return null;

  // cartão ao lado do destaque: à direita (menu), embaixo (topo) ou em cima (rodapé); no centro quando não há alvo
  const largura = Math.min(LARG, tela.w - 32);
  let pos: { left: number; top: number };
  if (!caixa)
    pos = { left: (tela.w - largura) / 2, top: Math.max(24, tela.h / 2 - 150) };
  else if (
    caixa.x + caixa.w + largura + 24 < tela.w &&
    caixa.w < tela.w / 2 &&
    caixa.h < tela.h * 0.6
  )
    pos = {
      left: caixa.x + caixa.w + 16,
      top: Math.min(Math.max(16, caixa.y), tela.h - 280),
    };
  else if (caixa.y + caixa.h + 260 < tela.h)
    pos = {
      left: Math.min(Math.max(16, caixa.x), tela.w - largura - 16),
      top: caixa.y + caixa.h + 14,
    };
  else
    pos = {
      left: Math.min(
        Math.max(16, caixa.x + caixa.w - largura),
        tela.w - largura - 16,
      ),
      top: Math.max(16, caixa.y - 270),
    };
  // no menu (alvo alto, ex.: o menu inteiro), o cartão fica ao lado, centralizado na altura
  if (caixa && caixa.h >= tela.h * 0.6)
    pos = { left: caixa.x + caixa.w + 16, top: tela.h / 2 - 140 };

  const Icone = passo.icone;
  const total = passos.length;

  return (
    <div
      className="fixed inset-0 z-[100]"
      role="dialog"
      aria-modal
      aria-label="Tour guiado"
    >
      {/* véu com o recorte do destaque */}
      <svg className="absolute inset-0 size-full" onClick={fechar}>
        <defs>
          <mask id="tour-recorte">
            <rect width="100%" height="100%" fill="white" />
            {caixa && (
              <motion.rect
                initial={false}
                animate={{
                  x: caixa.x,
                  y: caixa.y,
                  width: caixa.w,
                  height: caixa.h,
                }}
                transition={{ type: "spring", stiffness: 260, damping: 30 }}
                rx="14"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(10,16,35,0.72)"
          mask="url(#tour-recorte)"
        />
      </svg>
      {caixa && (
        <motion.div
          className="pointer-events-none absolute rounded-[14px] ring-2 ring-brand shadow-[0_0_0_6px_rgba(124,143,255,0.18),0_0_40px_rgba(124,143,255,0.55)]"
          initial={false}
          animate={{
            left: caixa.x,
            top: caixa.y,
            width: caixa.w,
            height: caixa.h,
          }}
          transition={{ type: "spring", stiffness: 260, damping: 30 }}
        >
          <span className="absolute -inset-1 animate-ping rounded-[16px] ring-2 ring-brand/40 [animation-duration:2s]" />
        </motion.div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 10, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          style={{ left: pos.left, top: pos.top, width: largura }}
          className="absolute overflow-hidden rounded-2xl border border-white/10 bg-card shadow-2xl shadow-dark-maya/40"
        >
          <div className="relative overflow-hidden bg-dark-maya px-5 pt-5 pb-4 text-white">
            <div className="pointer-events-none absolute -top-16 -right-10 size-40 rounded-full bg-brand/40 blur-3xl" />
            <div className="relative flex items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl brand-gradient shadow-lg shadow-brand/30">
                <Icone className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium tracking-wider text-white/55 uppercase">
                  Passo {i + 1} de {total}
                </p>
                <p className="truncate text-base font-semibold">
                  {passo.titulo}
                </p>
              </div>
            </div>
          </div>
          <div className="space-y-4 p-5">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {passo.texto}
            </p>
            <div className="flex gap-1">
              {passos.map((_, k) => (
                <span
                  key={k}
                  className={cn(
                    "h-1 flex-1 rounded-full transition-colors duration-300",
                    k <= i ? "bg-brand" : "bg-muted",
                  )}
                />
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={fechar}
                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                {i === total - 1 ? "" : "Pular tour"}
              </button>
              <div className="flex gap-2">
                {i > 0 && (
                  <Button size="sm" variant="outline" onClick={() => ir(-1)}>
                    Voltar
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={() => ir(1)}
                  className="brand-gradient text-white"
                >
                  {i === total - 1
                    ? "Começar a usar"
                    : i === 0
                      ? "Vamos lá"
                      : "Próximo"}
                </Button>
              </div>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
