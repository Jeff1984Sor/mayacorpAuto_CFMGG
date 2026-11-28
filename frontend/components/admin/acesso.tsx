"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { usePlanos } from "@/components/admin/cliente-dialog";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { FormDialog } from "@/components/mayacorp/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ClienteSaaS, DarAcessoIn } from "@/lib/admin";
import { api } from "@/lib/api";
import { moeda } from "@/lib/format";

const hoje = () => new Date().toLocaleDateString("sv-SE");

/** Consultas da ficha que só existem para quem tem ambiente (chaves ["admin", <uma destas>, ...]). */
const DO_AMBIENTE = ["uso", "usuarios", "pagamento", "ia"];

/** Cliente só de cobrança passa a usar o MayaJus (ambiente novo, ou o de antes se ele já teve acesso). */
function DarAcessoDialog({
  open,
  onClose,
  cli,
}: {
  open: boolean;
  onClose: () => void;
  cli: ClienteSaaS;
}) {
  const qc = useQueryClient();
  const planos = usePlanos();
  const volta = cli.ambiente_guardado;
  const vazio = (): DarAcessoIn & { dominio: string } => ({
    admin_nome: cli.responsavel ?? "",
    admin_email: cli.email_financeiro ?? "",
    plano_id: cli.plano_id,
    ciclo: cli.ciclo,
    inicio_contrato: hoje(),
    dias_teste: volta ? null : 15,
    dominios: [],
    dominio: "",
  });
  const [f, setF] = useState(vazio);
  /* eslint-disable react-hooks/set-state-in-effect -- carrega o formulário ao abrir */
  useEffect(() => {
    if (open) setF(vazio());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const plano = planos.data?.find((p) => p.id === f.plano_id);
  const salvar = useMutation({
    mutationFn: () => {
      const { dominio, ...corpo } = f;
      return api.post<ClienteSaaS>(`/admin/clientes/${cli.id}/dar-acesso`, {
        ...corpo,
        admin_email: f.admin_email?.trim() || null,
        dominios: dominio.trim() ? [dominio.trim()] : [],
      });
    },
    onSuccess: (c) => {
      const convite = c.convite;
      toast.success(
        c.ambiente_de_antes
          ? `${c.nome} voltou a ter acesso, com o ambiente de antes.`
          : `Ambiente de ${c.nome} criado.`,
        {
          duration: 20000,
          description: c.boas_vindas_para
            ? `Boas-vindas enviadas para ${c.boas_vindas_para}. O link vale por 7 dias.`
            : "Os usuários voltam a entrar com a senha que já tinham.",
          action: convite
            ? {
                label: "Copiar link",
                onClick: () => navigator.clipboard.writeText(convite),
              }
            : undefined,
        },
      );
      qc.invalidateQueries({ queryKey: ["admin"] });
      onClose();
    },
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => !o && onClose()}
      titulo={`Dar acesso ao sistema para ${cli.nome}`}
      descricao={
        volta
          ? "O ambiente que este cliente já teve continua guardado: ele volta como estava, com os mesmos usuários, senhas e dados. A mensalidade do plano volta a ser cobrada."
          : "O cliente passa a usar o MayaJus: ganha o ambiente próprio, plano, teste grátis e as boas-vindas por e-mail. As cobranças recorrentes dele continuam valendo."
      }
      largura="lg"
      salvando={salvar.isPending}
      rotuloSalvar={volta ? "Devolver o acesso" : "Criar ambiente"}
      onSubmit={(e) => {
        e.preventDefault();
        if (!volta && !f.admin_email?.trim())
          return toast.error("Informe o e-mail que recebe as boas-vindas.");
        salvar.mutate();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Plano"
          htmlFor="ac-plano"
          dica={
            plano
              ? `${moeda(f.ciclo === "anual" ? plano.preco_anual : plano.preco_mensal)} por ${f.ciclo === "anual" ? "ano" : "mês"}`
              : "Sem plano, a mensalidade não é gerada."
          }
        >
          <NativeSelect
            id="ac-plano"
            value={f.plano_id ?? ""}
            onChange={(e) =>
              setF({
                ...f,
                plano_id: e.target.value ? Number(e.target.value) : null,
              })
            }
          >
            <option value="">Sem plano ainda</option>
            {planos.data
              ?.filter((p) => p.ativo || p.id === f.plano_id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
          </NativeSelect>
        </Field>
        <Field label="Cobrança do plano" htmlFor="ac-ciclo">
          <NativeSelect
            id="ac-ciclo"
            value={f.ciclo}
            onChange={(e) =>
              setF({ ...f, ciclo: e.target.value as DarAcessoIn["ciclo"] })
            }
          >
            <option value="mensal">Mensal</option>
            <option value="anual">Anual (2 meses grátis)</option>
          </NativeSelect>
        </Field>
        <Field label="Início do contrato" htmlFor="ac-inicio">
          <Input
            id="ac-inicio"
            type="date"
            value={f.inicio_contrato ?? ""}
            onChange={(e) =>
              setF({ ...f, inicio_contrato: e.target.value || null })
            }
          />
        </Field>
        <Field
          label="Teste grátis"
          htmlFor="ac-dias"
          dica="Dias; deixe vazio para começar já ativo."
        >
          <Input
            id="ac-dias"
            type="number"
            min={1}
            max={90}
            value={f.dias_teste ?? ""}
            onChange={(e) =>
              setF({
                ...f,
                dias_teste: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </Field>
        {!volta && (
          <>
            <p className="text-[13px] font-medium text-foreground/80 sm:col-span-2">
              Boas-vindas e acesso
            </p>
            <Field label="Nome de quem recebe" htmlFor="ac-nome">
              <Input
                id="ac-nome"
                value={f.admin_nome}
                onChange={(e) => setF({ ...f, admin_nome: e.target.value })}
              />
            </Field>
            <Field
              label="E-mail das boas-vindas"
              obrigatorio
              htmlFor="ac-email"
              dica="Recebe o link para criar o usuário master."
            >
              <Input
                id="ac-email"
                type="email"
                value={f.admin_email ?? ""}
                onChange={(e) => setF({ ...f, admin_email: e.target.value })}
              />
            </Field>
            <Field
              label="Domínio próprio"
              htmlFor="ac-dominio"
              className="sm:col-span-2"
              dica="Opcional. Ex.: sistema.escritorio.com.br"
            >
              <Input
                id="ac-dominio"
                value={f.dominio}
                onChange={(e) => setF({ ...f, dominio: e.target.value })}
                className="max-w-sm font-mono"
              />
            </Field>
          </>
        )}
      </div>
    </FormDialog>
  );
}

/** Botão da ficha que muda o cliente de lado: "Dar acesso ao sistema" (sem acesso) ou "Tirar o acesso" (escritório). */
export function BotaoAcesso({ cli }: { cli: ClienteSaaS }) {
  const qc = useQueryClient();
  const [aberto, setAberto] = useState(false);
  const tirar = useMutation({
    mutationFn: () =>
      api.post<ClienteSaaS>(`/admin/clientes/${cli.id}/tirar-acesso`),
    onSuccess: (c) => {
      toast.success(`${c.nome} ficou só na cobrança, sem acesso ao sistema.`);
      setAberto(false);
      // a ficha já vira "sem acesso" e as abas do ambiente saem da tela; o que elas consultavam (uso, usuários,
      // forma de pagamento, IA) não existe mais para este cliente, então não é consultado de novo
      qc.setQueryData(["admin", "cliente", String(c.id)], c);
      qc.invalidateQueries({
        queryKey: ["admin"],
        predicate: (q) => !q.queryKey.some((k) => DO_AMBIENTE.includes(k as string)),
      });
    },
  });
  if (cli.tipo === "externo")
    return (
      <>
        <Button size="sm" onClick={() => setAberto(true)}>
          <KeyRound /> Dar acesso ao sistema
        </Button>
        <DarAcessoDialog
          open={aberto}
          onClose={() => setAberto(false)}
          cli={cli}
        />
      </>
    );
  if (cli.banco_principal) return null; // o escritório do banco principal não pode ficar sem acesso
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
        <LockKeyhole /> Tirar o acesso
      </Button>
      <ConfirmDialog
        open={aberto}
        onOpenChange={setAberto}
        titulo={`Tirar o acesso de ${cli.nome} e manter só a cobrança?`}
        descricao={
          <span className="block space-y-2">
            <span className="block">
              Ninguém do escritório consegue mais entrar no MayaJus e a
              mensalidade do plano para de ser gerada (o cartão recorrente, se
              houver, é cancelado no Mercado Pago).
            </span>
            <span className="block">
              Nada é apagado: o ambiente, os usuários e os dados ficam guardados
              e voltam como estavam se você devolver o acesso. As cobranças
              recorrentes e avulsas continuam valendo, e as cobranças já geradas
              seguem em aberto.
            </span>
          </span>
        }
        confirmar="Tirar o acesso"
        destrutivo
        carregando={tirar.isPending}
        onConfirm={() => tirar.mutate()}
      />
    </>
  );
}
