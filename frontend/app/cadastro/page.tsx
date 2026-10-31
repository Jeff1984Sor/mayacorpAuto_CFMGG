"use client";

import { Check, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { MayaCorpAssinatura, MayaJusLogo } from "@/components/mayacorp/brand";
import { Field } from "@/components/mayacorp/form";
import { Segmented } from "@/components/mayacorp/data-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { PlanoOut } from "@/lib/admin";
import { api } from "@/lib/api";
import { moeda, toNum } from "@/lib/format";
import { cn } from "@/lib/utils";

const RECURSOS: Record<string, string> = {
  gestao: "Gestão de processos e financeiro",
  automacoes: "Automações padrão",
  contador: "Integração com contador",
};

/**
 * Cadastro público (para o site da MayaCorp): vira uma solicitação no admin.
 * ?plano=Pro já deixa o plano marcado · ?embed=1 tira o cabeçalho (para usar dentro de um iframe).
 */
export default function CadastroPage() {
  const [planos, setPlanos] = useState<PlanoOut[]>([]);
  const [ciclo, setCiclo] = useState<"mensal" | "anual">("mensal");
  const [embed, setEmbed] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [f, setF] = useState({
    plano_id: null as number | null,
    nome: "",
    documento: "",
    responsavel: "",
    email: "",
    telefone: "",
    usuarios: "",
    indicacao: "",
    mensagem: "",
    aceite: false,
    site: "",
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) =>
    setF((o) => ({ ...o, [k]: v }));

  /* eslint-disable react-hooks/set-state-in-effect -- lê os planos e os parâmetros do link uma vez */
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    setEmbed(qs.get("embed") === "1");
    if (qs.get("ciclo") === "anual") setCiclo("anual");
    api
      .get<PlanoOut[]>("/public/planos")
      .then((ps) => {
        setPlanos(ps);
        const pedido = qs.get("plano")?.toLowerCase();
        const p =
          ps.find((x) => x.nome.toLowerCase() === pedido) ??
          ps.find((x) => x.nome === "Escritório") ??
          ps[0];
        if (p) setF((o) => ({ ...o, plano_id: p.id }));
      })
      .catch(() =>
        toast.error(
          "Não foi possível carregar os planos. Recarregue a página.",
        ),
      );
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!f.aceite) return toast.error("Aceite os termos para continuar.");
    setEnviando(true);
    try {
      await api.post(
        "/public/cadastro",
        {
          ...f,
          ciclo,
          usuarios: f.usuarios ? Number(f.usuarios) : null,
          documento: f.documento || null,
        },
        { auth: false },
      );
      setEnviado(true);
      window.parent?.postMessage({ mayajus: "cadastro-enviado" }, "*"); // o site pode reagir (ex.: evento de conversão)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="min-h-dvh bg-background">
      {!embed && (
        <header className="border-b bg-dark-maya text-white">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
            <MayaJusLogo claro />
            <span className="hidden text-sm text-white/70 sm:block">
              Gestão jurídica com NFS-e e financeiro
            </span>
          </div>
        </header>
      )}
      <main className="mx-auto max-w-5xl px-4 py-8">
        {enviado ? (
          <div className="card-surface mx-auto max-w-lg space-y-4 p-8 text-center">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-success/10">
              <CheckCircle2 className="size-7 text-success" />
            </div>
            <h1 className="text-2xl font-semibold">Cadastro recebido!</h1>
            <p className="text-sm text-muted-foreground">
              Em breve você recebe no e-mail <b>{f.email}</b> o link para criar
              o seu acesso e começar o teste grátis.
            </p>
          </div>
        ) : (
          <form onSubmit={enviar} className="space-y-8">
            <div className="text-center">
              <h1 className="text-3xl font-semibold tracking-tight">
                Comece a usar o MayaJus
              </h1>
              <p className="mt-2 text-muted-foreground">
                Escolha o plano, preencha os dados e comece com teste grátis.
              </p>
            </div>

            <section>
              <div className="mb-4 flex justify-center">
                <Segmented
                  value={ciclo}
                  onChange={setCiclo}
                  opcoes={[
                    { value: "mensal", label: "Mensal" },
                    { value: "anual", label: "Anual (2 meses grátis)" },
                  ]}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {planos.map((p) => {
                  const sel = f.plano_id === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => set("plano_id", p.id)}
                      className={cn(
                        "card-surface flex flex-col gap-2 p-5 text-left transition-colors hover:border-brand/60",
                        sel && "border-brand ring-2 ring-brand",
                      )}
                    >
                      <span className="flex items-center justify-between font-semibold">
                        {p.nome}{" "}
                        {sel && <CheckCircle2 className="size-5 text-brand" />}
                      </span>
                      <span className="font-mono text-xl">
                        {moeda(
                          ciclo === "anual"
                            ? toNum(p.preco_anual)
                            : p.preco_mensal,
                        )}
                        <span className="font-sans text-xs text-muted-foreground">
                          /{ciclo === "anual" ? "ano" : "mês"}
                        </span>
                      </span>
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        <li>
                          {p.usuarios
                            ? `${p.usuarios} usuário(s)`
                            : "Usuários ilimitados"}
                        </li>
                        <li>
                          {p.notas_mes != null
                            ? `${p.notas_mes} notas fiscais/mês`
                            : "Notas ilimitadas"}
                        </li>
                        {p.recursos.map((r) => (
                          <li key={r} className="flex items-center gap-1">
                            <Check className="size-3 text-success" />{" "}
                            {RECURSOS[r] ?? r}
                          </li>
                        ))}
                      </ul>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="card-surface grid gap-4 p-6 sm:grid-cols-2">
              <Field label="Nome do escritório" obrigatorio htmlFor="cad-nome">
                <Input
                  id="cad-nome"
                  required
                  minLength={2}
                  value={f.nome}
                  onChange={(e) => set("nome", e.target.value)}
                />
              </Field>
              <Field label="CNPJ ou CPF" htmlFor="cad-doc">
                <Input
                  id="cad-doc"
                  value={f.documento}
                  onChange={(e) => set("documento", e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field label="Seu nome" obrigatorio htmlFor="cad-resp">
                <Input
                  id="cad-resp"
                  required
                  minLength={3}
                  value={f.responsavel}
                  onChange={(e) => set("responsavel", e.target.value)}
                  autoComplete="name"
                />
              </Field>
              <Field
                label="E-mail"
                obrigatorio
                htmlFor="cad-email"
                dica="Recebe o link de acesso."
              >
                <Input
                  id="cad-email"
                  type="email"
                  required
                  value={f.email}
                  onChange={(e) => set("email", e.target.value)}
                  autoComplete="email"
                />
              </Field>
              <Field label="Telefone / WhatsApp" obrigatorio htmlFor="cad-tel">
                <Input
                  id="cad-tel"
                  type="tel"
                  required
                  minLength={8}
                  value={f.telefone}
                  onChange={(e) => set("telefone", e.target.value)}
                  autoComplete="tel"
                />
              </Field>
              <Field
                label="Como prefere pagar?"
                obrigatorio
                className="sm:col-span-2"
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["mensal", "anual"] as const).map((c) => {
                    const p = planos.find((x) => x.id === f.plano_id);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCiclo(c)}
                        className={cn(
                          "rounded-xl border p-3 text-left text-sm transition-colors hover:border-brand/60",
                          ciclo === c && "border-brand ring-2 ring-brand",
                        )}
                      >
                        <span className="font-medium">
                          {c === "mensal" ? "Mensal" : "Anual (2 meses grátis)"}
                        </span>
                        {p && (
                          <span className="block font-mono text-xs text-muted-foreground">
                            {c === "mensal"
                              ? `${moeda(p.preco_mensal)} por mês`
                              : `${moeda(p.preco_anual)} por ano`}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Quantas pessoas vão usar?" htmlFor="cad-usu">
                <Input
                  id="cad-usu"
                  type="number"
                  min={1}
                  value={f.usuarios}
                  onChange={(e) => set("usuarios", e.target.value)}
                />
              </Field>
              <Field
                label="Quem indicou? (opcional)"
                htmlFor="cad-ind"
                className="sm:col-span-2"
              >
                <Input
                  id="cad-ind"
                  value={f.indicacao}
                  onChange={(e) => set("indicacao", e.target.value)}
                  placeholder="Nome do escritório que indicou"
                />
              </Field>
              <Field
                label="Mensagem (opcional)"
                htmlFor="cad-msg"
                className="sm:col-span-2"
              >
                <Textarea
                  id="cad-msg"
                  rows={3}
                  value={f.mensagem}
                  onChange={(e) => set("mensagem", e.target.value)}
                />
              </Field>
              {/* isca para robôs: invisível para pessoas */}
              <input
                type="text"
                name="site"
                tabIndex={-1}
                autoComplete="off"
                value={f.site}
                onChange={(e) => set("site", e.target.value)}
                className="absolute -left-[9999px] h-0 w-0 opacity-0"
                aria-hidden
              />
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <Checkbox
                  checked={f.aceite}
                  onCheckedChange={(v) => set("aceite", !!v)}
                  className="mt-0.5"
                />
                <span>
                  Concordo em receber o contato da MayaCorp e autorizo o uso
                  destes dados para criar o meu ambiente no MayaJus, conforme a
                  LGPD.
                </span>
              </label>
              <div className="sm:col-span-2">
                <Button
                  type="submit"
                  disabled={enviando || !f.plano_id}
                  className="h-11 w-full sm:w-auto sm:px-10"
                >
                  {enviando && <Loader2 className="animate-spin" />}
                  Quero começar
                </Button>
              </div>
            </section>
          </form>
        )}
        {!embed && (
          <MayaCorpAssinatura className="mt-10 justify-center" versao={false} />
        )}
      </main>
    </div>
  );
}
