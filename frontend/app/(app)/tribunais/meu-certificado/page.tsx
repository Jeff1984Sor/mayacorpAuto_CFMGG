"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  Bell,
  FileKey2,
  History,
  KeyRound,
  Loader2,
  Plus,
  Save,
  ScrollText,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { toast } from "sonner";

import { Mono } from "@/components/mayacorp/brand";
import { ConfirmDialog } from "@/components/mayacorp/confirm-dialog";
import { EmptyState } from "@/components/mayacorp/empty-state";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { PageHeader } from "@/components/mayacorp/page-header";
import { SenhaInput } from "@/components/mayacorp/senha-input";
import { Pill, StatusBadge } from "@/components/mayacorp/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { data, dataHora, tamanhoArquivo } from "@/lib/format";
import {
  chaveProtocolos,
  type CertificadoAdvogado,
  type Escopo,
  type EuOut,
  type EventoAviso,
  mascararCpf,
  type OabCadastrada,
  ROTULO_EVENTO,
  UFS,
  type UsoCertificado,
  useEu,
} from "@/lib/tribunais-protocolo";
import { cn } from "@/lib/utils";
import { TabelaUso, tomValidade } from "@/components/tribunais-protocolo/uso-certificado";

const ESCOPOS: { k: Escopo; l: string; d: string }[] = [
  { k: "consulta", l: "Consultar processos", d: "Ler capa, partes e andamentos nos tribunais." },
  { k: "download", l: "Baixar documentos", d: "Baixar as peças e decisões dos autos." },
  { k: "protocolo", l: "Protocolar petições", d: "Assinar e enviar petições — sempre com a sua aprovação, uma a uma." },
];

function CartaoCertificado({ c, onRemover }: { c: CertificadoAdvogado; onRemover: () => void }) {
  const t = tomValidade(c.dias_para_vencer);
  const cor = { success: "bg-success", info: "bg-brand", warning: "bg-warning", danger: "bg-danger" }[t];
  return (
    <div className="card-surface overflow-hidden">
      <div className={cn("h-1.5", cor)} />
      <div className="flex flex-col gap-5 p-6 sm:flex-row sm:items-start">
        <div className={cn("grid size-24 shrink-0 place-items-center rounded-2xl text-center ring-1 ring-inset", {
          success: "bg-success/10 text-success-ink ring-success/25",
          info: "bg-brand/10 text-info-ink ring-brand/30",
          warning: "bg-warning/12 text-warning-ink ring-warning/30",
          danger: "bg-danger/10 text-danger-ink ring-danger/25",
        }[t])}>
          <div>
            <p className="text-3xl font-semibold num">{Math.max(0, c.dias_para_vencer)}</p>
            <p className="text-[11px]">{c.dias_para_vencer < 0 ? "vencido" : c.dias_para_vencer === 1 ? "dia" : "dias"}</p>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status="ativo" label={`e-CPF ${c.tipo}`} />
            {c.revogado === true ? (
              <StatusBadge tom="danger" label="Revogado pela AC" />
            ) : c.revogado === false ? (
              <StatusBadge tom="success" label="Não revogado" />
            ) : (
              <StatusBadge tom="warning" label="Revogação não verificada" />
            )}
            {c.dias_para_vencer <= 30 && <StatusBadge tom={t} label={c.dias_para_vencer < 0 ? "Vencido" : "Vence em breve"} />}
          </div>
          <h3 className="mt-2 truncate text-xl font-semibold">{c.titular_nome}</h3>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">CPF</dt>
              <dd>
                <Mono>{mascararCpf(c.titular_cpf)}</Mono>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Validade</dt>
              <dd>
                <Mono>
                  {data(c.valido_de)} → {data(c.valido_ate)}
                </Mono>
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Autoridade certificadora</dt>
              <dd className="truncate">{c.emissor_ac ?? "—"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">Autorizado para</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {c.escopo_autorizado.map((e) => (
                  <Pill key={e} tom="brand" className="normal-case">
                    {ESCOPOS.find((x) => x.k === e)?.l ?? e}
                  </Pill>
                ))}
              </dd>
            </div>
          </dl>
          {(c.revogacao_msg || c.revogacao_verificada_em) && (
            <p className="mt-3 text-xs text-muted-foreground">
              {c.revogacao_verificada_em && `Revogação conferida ${dataHora(c.revogacao_verificada_em)}. `}
              {c.revogacao_msg}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t bg-muted/30 p-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          Guardado criptografado em {dataHora(c.criado_em)}. Ninguém consegue baixar o arquivo nem ver a senha.
          {c.thumbprint_sha256 && (
            <span className="ml-1 font-mono" title={c.thumbprint_sha256}>
              · {c.thumbprint_sha256.slice(0, 16)}…
            </span>
          )}
        </span>
        <Button variant="outline" size="sm" onClick={onRemover} className="text-danger-ink">
          <Trash2 /> Remover certificado
        </Button>
      </div>
    </div>
  );
}

function EnviarCertificado({ eu, onEnviado }: { eu: EuOut; onEnviado: (r: EuOut) => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [senha, setSenha] = useState("");
  const [escopos, setEscopos] = useState<Escopo[]>(["consulta", "download", "protocolo"]);
  const [aceite, setAceite] = useState(false);
  const dz = useDropzone({
    multiple: false,
    accept: { "application/x-pkcs12": [".pfx", ".p12"] },
    onDrop: (f) => f[0] && setArquivo(f[0]),
    onDropRejected: () => toast.error("Envie o certificado A1 (.pfx ou .p12)."),
  });
  const enviar = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("arquivo", arquivo!);
      fd.append("senha", senha);
      fd.append("escopos", escopos.join(","));
      fd.append("aceite_termo", "true");
      fd.append("versao_termo", eu.termo_vigente.versao);
      return api.post<EuOut>("/tribunais/eu/certificado", fd);
    },
    onSuccess: (r) => {
      toast.success("Certificado guardado com segurança");
      setArquivo(null);
      setSenha("");
      setAceite(false);
      onEnviado(r);
    },
  });
  const pronto = !!arquivo && !!senha && escopos.length > 0 && aceite;
  return (
    <div className="card-surface p-5">
      <h3 className="flex items-center gap-2 font-semibold">
        <UploadCloud className="size-4 text-info-ink" /> {eu.certificado ? "Trocar o certificado" : "Enviar meu e-CPF (A1)"}
      </h3>
      <p className="mb-4 text-sm text-muted-foreground">
        O certificado precisa ser seu (o CPF dele é conferido com o seu cadastro). Arquivo e senha ficam criptografados e nunca mais são exibidos.
      </p>
      <div
        {...dz.getRootProps()}
        className={cn(
          "grid cursor-pointer place-items-center rounded-xl border-2 border-dashed p-6 text-center text-sm transition-colors",
          dz.isDragActive ? "border-brand bg-brand/5" : "hover:border-brand/50",
        )}
      >
        <input {...dz.getInputProps()} />
        {arquivo ? (
          <div className="flex items-center gap-3">
            <FileKey2 className="size-8 text-info-ink" />
            <div className="text-left">
              <p className="font-medium">{arquivo.name}</p>
              <p className="text-xs text-muted-foreground">{tamanhoArquivo(arquivo.size)}</p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                setArquivo(null);
              }}
              aria-label="Remover"
            >
              <X />
            </Button>
          </div>
        ) : (
          <span className="flex flex-col items-center gap-1.5 text-muted-foreground">
            <KeyRound className="size-6" />
            Arraste o .pfx / .p12 ou clique para escolher
          </span>
        )}
      </div>
      <Field label="Senha do certificado" className="mt-3">
        <SenhaInput value={senha} onChange={setSenha} autoComplete="new-password" />
      </Field>

      <div className="mt-4">
        <p className="mb-1.5 text-[13px] text-foreground/80">O sistema pode usar o certificado para</p>
        <div className="space-y-1.5">
          {ESCOPOS.map((e) => (
            <label key={e.k} className="flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm">
              <Checkbox
                checked={escopos.includes(e.k)}
                onCheckedChange={(v) => setEscopos((s) => (v ? [...s, e.k] : s.filter((x) => x !== e.k)))}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{e.l}</span>
                <span className="block text-xs text-muted-foreground">{e.d}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-1.5 flex items-center gap-1.5 text-[13px] text-foreground/80">
          <ScrollText className="size-4" /> Termo de consentimento (LGPD) · versão <Mono>{eu.termo_vigente.versao}</Mono>
        </p>
        <div className="max-h-56 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap">{eu.termo_vigente.texto}</div>
        <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox checked={aceite} onCheckedChange={(v) => setAceite(!!v)} className="mt-0.5" />
          Li o termo e autorizo o uso do meu certificado para as finalidades marcadas acima.
        </label>
      </div>

      <Button className="mt-4 w-full" disabled={!pronto || enviar.isPending} onClick={() => enviar.mutate()}>
        {enviar.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Ler e guardar o certificado
      </Button>
    </div>
  );
}

function OabsEditor({ eu, onSalvo }: { eu: EuOut; onSalvo: (r: EuOut) => void }) {
  const inicial = (): OabCadastrada[] =>
    eu.oabs_cadastradas.length
      ? eu.oabs_cadastradas
      : eu.oabs.map((o) => ({ ...o, letra_complementar: null, situacao: "regular" as const }));
  const [lista, setLista] = useState<OabCadastrada[]>(inicial);
  const set = (i: number, p: Partial<OabCadastrada>) => setLista((l) => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const salvar = useMutation({
    mutationFn: () =>
      api.put<EuOut>(
        "/tribunais/eu/oabs",
        lista
          .filter((o) => o.numero.trim())
          .map((o) => ({ numero: o.numero.trim(), uf: o.uf, tipo: o.tipo, letra_complementar: o.letra_complementar || null, situacao: o.situacao || null })),
      ),
    onSuccess: (r) => {
      toast.success("Inscrições na OAB salvas");
      onSalvo(r);
    },
  });
  return (
    <div className="card-surface p-5">
      <h3 className="flex items-center gap-2 font-semibold">
        <BadgeCheck className="size-4 text-info-ink" /> Minhas inscrições na OAB
      </h3>
      <p className="mb-3 text-sm text-muted-foreground">A busca de processos e intimações usa todas elas. A principal vai na assinatura das petições.</p>
      <div className="space-y-2">
        {lista.length === 0 && <p className="rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground">Nenhuma OAB cadastrada.</p>}
        {lista.map((o, i) => (
          <div key={i} className="grid grid-cols-[1fr_72px] gap-2 rounded-xl border p-2.5 sm:grid-cols-[1fr_72px_56px]">
            <Input value={o.numero} onChange={(e) => set(i, { numero: e.target.value.replace(/\D/g, "") })} placeholder="Número" className="font-mono" aria-label="Número da OAB" />
            <NativeSelect value={o.uf} onChange={(e) => set(i, { uf: e.target.value })} aria-label="UF">
              {UFS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </NativeSelect>
            <Input
              value={o.letra_complementar ?? ""}
              onChange={(e) => set(i, { letra_complementar: e.target.value.toUpperCase().slice(0, 2) || null })}
              placeholder="Letra"
              className="font-mono"
              aria-label="Letra complementar"
            />
            <NativeSelect value={o.tipo} onChange={(e) => set(i, { tipo: e.target.value as OabCadastrada["tipo"] })} aria-label="Tipo">
              <option value="principal">Principal</option>
              <option value="suplementar">Suplementar</option>
              <option value="estagiario">Estagiário</option>
            </NativeSelect>
            <NativeSelect
              value={o.situacao ?? ""}
              onChange={(e) => set(i, { situacao: (e.target.value || null) as OabCadastrada["situacao"] })}
              aria-label="Situação"
            >
              <option value="regular">Regular</option>
              <option value="suspensa">Suspensa</option>
              <option value="cancelada">Cancelada</option>
            </NativeSelect>
            <Button variant="ghost" size="icon-sm" className="self-center justify-self-end" onClick={() => setLista((l) => l.filter((_, j) => j !== i))} aria-label="Remover">
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setLista((l) => [...l, { numero: "", uf: "SP", tipo: l.length ? "suplementar" : "principal", letra_complementar: null, situacao: "regular" }])}
        >
          <Plus /> Inscrição
        </Button>
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
          {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar
        </Button>
      </div>
    </div>
  );
}

const EVENTOS = Object.keys(ROTULO_EVENTO) as EventoAviso[];

function Preferencias({ eu, onSalvo }: { eu: EuOut; onSalvo: (r: EuOut) => void }) {
  const [prefs, setPrefs] = useState(() =>
    EVENTOS.map((ev) => ({
      evento: ev,
      receber: ev === "protocolo_falha" ? true : (eu.preferencias[ev]?.receber ?? true),
      email_alternativo: eu.preferencias[ev]?.email_alternativo ?? "",
    })),
  );
  const salvar = useMutation({
    mutationFn: () => api.put<EuOut>("/tribunais/eu/preferencias", prefs.map((p) => ({ ...p, email_alternativo: p.email_alternativo.trim() || null }))),
    onSuccess: (r) => {
      toast.success("Preferências de aviso salvas");
      onSalvo(r);
    },
  });
  return (
    <div className="card-surface p-5">
      <h3 className="flex items-center gap-2 font-semibold">
        <Bell className="size-4 text-info-ink" /> Avisos que eu recebo
      </h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Avisos dos protocolos em que você é o responsável, o titular ou quem enviou. Sem e-mail alternativo, vai para <strong>{eu.email}</strong>.
      </p>
      <ul className="divide-y rounded-xl border">
        {prefs.map((p, i) => (
          <li key={p.evento} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="text-sm font-medium">{ROTULO_EVENTO[p.evento].titulo}</p>
              <p className="text-xs text-muted-foreground">
                {p.evento === "protocolo_falha" ? "Não dá para desligar: uma falha pode custar um prazo." : ROTULO_EVENTO[p.evento].texto}
              </p>
            </div>
            <Switch
              checked={p.receber}
              disabled={p.evento === "protocolo_falha"}
              onCheckedChange={(v) => setPrefs((l) => l.map((x, j) => (j === i ? { ...x, receber: v } : x)))}
            />
            {p.receber && (
              <Input
                type="email"
                value={p.email_alternativo}
                onChange={(e) => setPrefs((l) => l.map((x, j) => (j === i ? { ...x, email_alternativo: e.target.value } : x)))}
                placeholder="E-mail alternativo (opcional)"
                className="sm:col-span-2"
              />
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={() => salvar.mutate()} disabled={salvar.isPending}>
          {salvar.isPending ? <Loader2 className="animate-spin" /> : <Save />} Salvar avisos
        </Button>
      </div>
    </div>
  );
}

export default function MeuCertificadoPage() {
  const qc = useQueryClient();
  const q = useEu();
  const uso = useQuery({ queryKey: [chaveProtocolos, "meu-uso"], queryFn: () => api.get<UsoCertificado[]>("/tribunais/eu/uso-certificado") });
  const [remover, setRemover] = useState(false);
  const [revogar, setRevogar] = useState(false);
  const atualizar = (r: EuOut) => qc.setQueryData([chaveProtocolos, "eu"], r);

  const removerMut = useMutation({
    mutationFn: () => api.del<EuOut>("/tribunais/eu/certificado"),
    onSuccess: (r) => {
      atualizar(r);
      setRemover(false);
      toast.success("Certificado apagado do cofre");
    },
  });
  const revogarMut = useMutation({
    mutationFn: () => api.post<EuOut>("/tribunais/eu/termo/revogar"),
    onSuccess: (r) => {
      atualizar(r);
      setRevogar(false);
      toast.success("Consentimento revogado. O certificado foi apagado.");
    },
  });

  const eu = q.data;
  return (
    <div>
      <PageHeader titulo="Meu certificado e OAB" icone={BadgeCheck} migalhas={[{ label: "Tribunais", href: "/tribunais" }, { label: "Meu certificado e OAB" }]} />
      {!eu ? (
        <Skeleton className="h-96 rounded-2xl" />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
            <div className="space-y-6">
              {eu.certificado ? (
                <CartaoCertificado c={eu.certificado} onRemover={() => setRemover(true)} />
              ) : (
                <div className="card-surface">
                  <EmptyState
                    icone={KeyRound}
                    titulo="Nenhum certificado guardado"
                    descricao="Com o seu e-CPF A1 o sistema consulta processos com sigilo, baixa documentos e protocola petições que você aprovar."
                  />
                </div>
              )}
              <OabsEditor key={JSON.stringify(eu.oabs_cadastradas)} eu={eu} onSalvo={atualizar} />
              <Preferencias key={JSON.stringify(eu.preferencias)} eu={eu} onSalvo={atualizar} />
            </div>
            <div className="space-y-4">
              <EnviarCertificado key={eu.termo_vigente.versao} eu={eu} onEnviado={atualizar} />
              <div className="card-surface p-5 text-sm">
                <h4 className="mb-2 flex items-center gap-2 font-semibold">
                  <ScrollText className="size-4 text-info-ink" /> Meu consentimento
                </h4>
                {eu.termo ? (
                  <>
                    <p className="text-muted-foreground">
                      Aceito em <Mono>{dataHora(eu.termo.aceito_em)}</Mono> (versão <Mono>{eu.termo.versao}</Mono>) para:{" "}
                      {eu.termo.escopos.map((e) => ESCOPOS.find((x) => x.k === e)?.l.toLowerCase() ?? e).join(", ")}.
                    </p>
                    {eu.termo.versao !== eu.termo_vigente.versao && (
                      <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning-ink">
                        O termo foi atualizado (versão {eu.termo_vigente.versao}). Reenvie o certificado para aceitar a versão nova.
                      </p>
                    )}
                    <Button variant="outline" size="sm" className="mt-3 text-danger-ink" onClick={() => setRevogar(true)}>
                      <ShieldOff /> Revogar consentimento
                    </Button>
                  </>
                ) : (
                  <p className="text-muted-foreground">Você ainda não aceitou o termo. O aceite acontece ao enviar o certificado.</p>
                )}
              </div>
              <div className="rounded-2xl border bg-card p-5 text-sm">
                <h4 className="mb-2 font-semibold">Vencimento</h4>
                <p className="text-muted-foreground">
                  Você recebe e-mail <strong className="text-foreground">30, 15 e 7 dias</strong> antes de o certificado vencer. Sem certificado válido, a
                  consulta com sigilo e o protocolo param.
                </p>
              </div>
            </div>
          </div>

          <div className="card-surface overflow-hidden">
            <div className="border-b p-4">
              <h3 className="flex items-center gap-2 font-semibold">
                <History className="size-4 text-info-ink" /> Histórico de uso do meu certificado
              </h3>
            </div>
            <TabelaUso itens={uso.data ?? []} carregando={uso.isPending} />
          </div>
        </div>
      )}

      <ConfirmDialog
        open={remover}
        onOpenChange={setRemover}
        titulo="Remover o certificado?"
        descricao="O arquivo e a senha são apagados do cofre na hora. Consultas com sigilo e protocolos que dependem dele param até você enviar outro."
        confirmar="Remover"
        destrutivo
        carregando={removerMut.isPending}
        onConfirm={() => removerMut.mutate()}
      />
      <ConfirmDialog
        open={revogar}
        onOpenChange={setRevogar}
        titulo="Revogar o consentimento?"
        descricao="Revogar o termo apaga o seu certificado do cofre imediatamente. Para voltar a usar, será preciso enviar o certificado e aceitar o termo de novo."
        confirmar="Revogar e apagar"
        destrutivo
        carregando={revogarMut.isPending}
        onConfirm={() => revogarMut.mutate()}
      />
    </div>
  );
}
