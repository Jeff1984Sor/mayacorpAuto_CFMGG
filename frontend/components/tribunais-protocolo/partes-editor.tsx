"use client";

import { Building2, ChevronDown, ChevronUp, Loader2, MapPin, Plus, Scale, Trash2, User, UserPlus, UsersRound } from "lucide-react";
import { useState } from "react";

import { CidadeInput } from "@/components/mayacorp/cidade-input";
import { SearchInput } from "@/components/mayacorp/data-table";
import { Field, NativeSelect } from "@/components/mayacorp/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useCep } from "@/hooks/use-cep";
import { useDebounce } from "@/hooks/use-debounce";
import { documento } from "@/lib/format";
import {
  type AdvogadoParteIn,
  enderecoVazio,
  type EnderecoParte,
  type ParteIn,
  type PessoaIn,
  pessoaDoCliente,
  pessoaVazia,
  type Polo,
  ROTULO_POLO,
  UFS,
  useClientesBusca,
} from "@/lib/tribunais-protocolo";
import { cpfValido, cnpjValido } from "@/lib/validacao";
import { cn } from "@/lib/utils";

const POLOS_INICIAL: Polo[] = ["ativo", "passivo", "terceiro"];

function EnderecoForm({ e, onChange, onRemover }: { e: EnderecoParte; onChange: (e: EnderecoParte) => void; onRemover?: () => void }) {
  const cep = useCep();
  const set = (p: Partial<EnderecoParte>) => onChange({ ...e, ...p });
  return (
    <div className="grid gap-3 rounded-xl border bg-background/50 p-3 sm:grid-cols-6">
      <Field label="CEP" className="sm:col-span-2">
        <div className="relative">
          <Input
            value={e.cep ?? ""}
            className="font-mono"
            onChange={(ev) => set({ cep: ev.target.value })}
            onBlur={async () => {
              const r = await cep.buscar(e.cep ?? "");
              if (r)
                onChange({
                  ...e,
                  logradouro: e.logradouro || r.logradouro,
                  bairro: e.bairro || r.bairro,
                  cidade: r.localidade,
                  uf: r.uf,
                  codigo_ibge: r.ibge,
                });
            }}
          />
          {cep.carregando && <Loader2 className="absolute top-1/2 right-2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
      </Field>
      <Field label="Logradouro" className="sm:col-span-4">
        <Input value={e.logradouro ?? ""} onChange={(ev) => set({ logradouro: ev.target.value })} maxLength={150} />
      </Field>
      <Field label="Número">
        <Input value={e.numero ?? ""} onChange={(ev) => set({ numero: ev.target.value })} maxLength={10} />
      </Field>
      <Field label="Complemento" className="sm:col-span-2">
        <Input value={e.complemento ?? ""} onChange={(ev) => set({ complemento: ev.target.value })} maxLength={60} />
      </Field>
      <Field label="Bairro" className="sm:col-span-3">
        <Input value={e.bairro ?? ""} onChange={(ev) => set({ bairro: ev.target.value })} maxLength={80} />
      </Field>
      <Field label="UF">
        <NativeSelect value={e.uf ?? ""} onChange={(ev) => set({ uf: ev.target.value || null })}>
          <option value="">—</option>
          {UFS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Cidade" className="sm:col-span-3">
        <CidadeInput uf={e.uf} value={e.cidade ?? ""} onChange={(ev) => set({ cidade: ev.target.value })} maxLength={80} />
      </Field>
      <Field label="Tipo" className="sm:col-span-2">
        <NativeSelect value={e.tipo ?? ""} onChange={(ev) => set({ tipo: (ev.target.value || null) as EnderecoParte["tipo"] })}>
          <option value="residencial">Residencial</option>
          <option value="comercial">Comercial</option>
          <option value="citacao">Para citação</option>
        </NativeSelect>
      </Field>
      {onRemover && (
        <div className="flex items-end">
          <Button type="button" variant="ghost" size="sm" onClick={onRemover} className="text-danger-ink">
            <Trash2 /> Remover
          </Button>
        </div>
      )}
    </div>
  );
}

function ParteCard({
  parte,
  indice,
  onChange,
  onRemover,
  advogadoPadrao,
}: {
  parte: ParteIn;
  indice: number;
  onChange: (p: ParteIn) => void;
  onRemover: () => void;
  advogadoPadrao: AdvogadoParteIn | null;
}) {
  const [aberto, setAberto] = useState(!parte.pessoa.nome);
  const pe = parte.pessoa;
  const setP = (p: Partial<PessoaIn>) => onChange({ ...parte, pessoa: { ...pe, ...p } });
  const fisica = pe.tipo_pessoa === "fisica";
  const doc = fisica ? pe.cpf : pe.cnpj;
  const docOk = !doc || (fisica ? cpfValido(doc) : cnpjValido(doc));
  const setAdv = (i: number, a: Partial<AdvogadoParteIn>) =>
    onChange({ ...parte, advogados: parte.advogados.map((x, j) => (j === i ? { ...x, ...a } : x)) });

  return (
    <div className="rounded-xl border bg-card">
      <button type="button" onClick={() => setAberto((x) => !x)} className="flex w-full items-center gap-3 p-3 text-left">
        <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
          {fisica ? <User className="size-4" /> : <Building2 className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{pe.nome || `Parte ${indice + 1} (sem nome)`}</p>
          <p className="text-[11px] text-muted-foreground">
            {ROTULO_POLO[parte.polo]}
            {doc && (
              <>
                {" · "}
                <span className="num">{documento(doc)}</span>
              </>
            )}
            {parte.advogados.length > 0 && ` · ${parte.advogados.length} advogado(s)`}
            {parte.cliente_id && " · do cadastro de clientes"}
          </p>
        </div>
        {aberto ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>
      {aberto && (
        <div className="space-y-4 border-t p-4">
          <div className="grid gap-3 sm:grid-cols-6">
            <Field label="Polo" className="sm:col-span-2">
              <NativeSelect
                value={parte.polo}
                onChange={(e) => {
                  const polo = e.target.value as Polo;
                  const advs =
                    polo === "ativo" && advogadoPadrao && !parte.advogados.some((a) => a.oab_numero === advogadoPadrao.oab_numero)
                      ? [...parte.advogados, advogadoPadrao]
                      : parte.advogados;
                  onChange({ ...parte, polo, advogados: advs });
                }}
              >
                {(Object.keys(ROTULO_POLO) as Polo[]).map((k) => (
                  <option key={k} value={k}>
                    {ROTULO_POLO[k]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Pessoa" className="sm:col-span-2">
              <NativeSelect value={pe.tipo_pessoa} onChange={(e) => setP({ tipo_pessoa: e.target.value as PessoaIn["tipo_pessoa"] })}>
                <option value="fisica">Pessoa física</option>
                <option value="juridica">Pessoa jurídica</option>
                <option value="autoridade">Autoridade</option>
                <option value="orgao_representacao">Órgão de representação</option>
              </NativeSelect>
            </Field>
            <Field label="Participação" className="sm:col-span-2" dica="Ex.: autor, réu, requerente.">
              <Input value={parte.tipo_participacao ?? ""} onChange={(e) => onChange({ ...parte, tipo_participacao: e.target.value })} />
            </Field>
            <Field label={fisica ? "Nome completo" : "Razão social / nome"} className="sm:col-span-4" obrigatorio>
              <Input value={pe.nome} onChange={(e) => setP({ nome: e.target.value })} maxLength={300} />
            </Field>
            <Field label={fisica ? "CPF" : "CNPJ"} className="sm:col-span-2" erro={docOk ? undefined : `${fisica ? "CPF" : "CNPJ"} inválido`}>
              <Input
                value={doc ?? ""}
                className="font-mono"
                onChange={(e) => (fisica ? setP({ cpf: e.target.value.replace(/\D/g, "") || null }) : setP({ cnpj: e.target.value.replace(/\D/g, "") || null }))}
                maxLength={18}
              />
            </Field>
            {!doc && (
              <Field label="Sem documento: justificativa" className="sm:col-span-6" dica="CPC 319 §1º: informe por que não há CPF/CNPJ.">
                <Input value={pe.justificativa_sem_documento ?? ""} onChange={(e) => setP({ justificativa_sem_documento: e.target.value })} maxLength={300} />
              </Field>
            )}
            {fisica ? (
              <>
                <Field label="Estado civil" className="sm:col-span-2">
                  <NativeSelect value={pe.estado_civil ?? ""} onChange={(e) => setP({ estado_civil: (e.target.value || null) as PessoaIn["estado_civil"] })}>
                    <option value="">—</option>
                    <option value="solteiro">Solteiro(a)</option>
                    <option value="casado">Casado(a)</option>
                    <option value="divorciado">Divorciado(a)</option>
                    <option value="separado">Separado(a)</option>
                    <option value="viuvo">Viúvo(a)</option>
                    <option value="nao_informado">Não informado</option>
                  </NativeSelect>
                </Field>
                <Field label="Profissão" className="sm:col-span-2">
                  <Input value={pe.profissao ?? ""} onChange={(e) => setP({ profissao: e.target.value })} />
                </Field>
                <Field label="Nacionalidade" className="sm:col-span-2">
                  <Input value={pe.nacionalidade ?? ""} onChange={(e) => setP({ nacionalidade: e.target.value })} />
                </Field>
                <Field label="Data de nascimento" className="sm:col-span-2">
                  <Input type="date" value={pe.data_nascimento ?? ""} onChange={(e) => setP({ data_nascimento: e.target.value || null })} />
                </Field>
                <Field label="Sexo" className="sm:col-span-2">
                  <NativeSelect value={pe.sexo ?? ""} onChange={(e) => setP({ sexo: (e.target.value || null) as PessoaIn["sexo"] })}>
                    <option value="">—</option>
                    <option value="F">Feminino</option>
                    <option value="M">Masculino</option>
                    <option value="N">Não informado</option>
                  </NativeSelect>
                </Field>
                <Field label="Nome da mãe" className="sm:col-span-2">
                  <Input value={pe.nome_mae ?? ""} onChange={(e) => setP({ nome_mae: e.target.value })} />
                </Field>
              </>
            ) : (
              <Field label="Nome fantasia" className="sm:col-span-3">
                <Input value={pe.nome_fantasia ?? ""} onChange={(e) => setP({ nome_fantasia: e.target.value })} />
              </Field>
            )}
            <Field label="E-mail" className="sm:col-span-3">
              <Input type="email" value={pe.email ?? ""} onChange={(e) => setP({ email: e.target.value })} />
            </Field>
            <Field label="Telefones" className="sm:col-span-3" dica="Separe por vírgula.">
              <Input
                value={pe.telefones.join(", ")}
                onChange={(e) => setP({ telefones: e.target.value.split(",").map((t) => t.trimStart()) })}
                className="font-mono"
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="inline-flex items-center gap-2">
              <Checkbox checked={parte.assistencia_judiciaria} onCheckedChange={(v) => onChange({ ...parte, assistencia_judiciaria: !!v })} />
              Pede assistência judiciária (gratuidade)
            </label>
            <label className="inline-flex items-center gap-2">
              <Checkbox checked={pe.ente_publico} onCheckedChange={(v) => setP({ ente_publico: !!v })} />
              Ente público
            </label>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <MapPin className="size-4 text-muted-foreground" /> Endereços
              </p>
              <Button type="button" variant="ghost" size="sm" onClick={() => setP({ enderecos: [...pe.enderecos, enderecoVazio()] })}>
                <Plus /> Endereço
              </Button>
            </div>
            <div className="space-y-2">
              {pe.enderecos.length === 0 && <p className="text-xs text-muted-foreground">Endereço completo é obrigatório na inicial.</p>}
              {pe.enderecos.map((e, i) => (
                <EnderecoForm
                  key={i}
                  e={e}
                  onChange={(n) => setP({ enderecos: pe.enderecos.map((x, j) => (j === i ? n : x)) })}
                  onRemover={pe.enderecos.length > 1 ? () => setP({ enderecos: pe.enderecos.filter((_, j) => j !== i) }) : undefined}
                />
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Scale className="size-4 text-muted-foreground" /> Advogados desta parte
              </p>
              <div className="flex gap-1">
                {advogadoPadrao && !parte.advogados.some((a) => a.oab_numero === advogadoPadrao.oab_numero) && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...parte, advogados: [...parte.advogados, advogadoPadrao] })}>
                    <UserPlus /> Incluir {advogadoPadrao.nome.split(" ")[0]}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onChange({
                      ...parte,
                      advogados: [
                        ...parte.advogados,
                        { nome: "", cpf: null, oab_numero: "", oab_uf: "SP", tipo_representante: "advogado", recebe_intimacao: true },
                      ],
                    })
                  }
                >
                  <Plus /> Outro advogado
                </Button>
              </div>
            </div>
            {parte.advogados.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {parte.polo === "ativo" ? "O advogado que assina precisa estar numa parte do polo ativo." : "Sem advogado (normal para o réu)."}
              </p>
            ) : (
              <ul className="space-y-2">
                {parte.advogados.map((a, i) => (
                  <li key={i} className="grid items-end gap-2 rounded-xl border bg-background/50 p-3 sm:grid-cols-[1fr_120px_90px_auto_auto]">
                    <Field label="Nome">
                      <Input value={a.nome} onChange={(e) => setAdv(i, { nome: e.target.value })} />
                    </Field>
                    <Field label="OAB nº">
                      <Input value={a.oab_numero} onChange={(e) => setAdv(i, { oab_numero: e.target.value.replace(/\D/g, "") })} className="font-mono" />
                    </Field>
                    <Field label="UF">
                      <NativeSelect value={a.oab_uf} onChange={(e) => setAdv(i, { oab_uf: e.target.value })}>
                        {UFS.map((u) => (
                          <option key={u}>{u}</option>
                        ))}
                      </NativeSelect>
                    </Field>
                    <label className="inline-flex h-9 items-center gap-2 text-xs">
                      <Checkbox checked={a.recebe_intimacao} onCheckedChange={(v) => setAdv(i, { recebe_intimacao: !!v })} /> Recebe intimação
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Remover advogado"
                      onClick={() => onChange({ ...parte, advogados: parte.advogados.filter((_, j) => j !== i) })}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end border-t pt-3">
            <Button type="button" variant="ghost" size="sm" className="text-danger-ink" onClick={onRemover}>
              <Trash2 /> Remover parte
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ClienteDialog({ open, onOpenChange, onEscolher }: { open: boolean; onOpenChange: (o: boolean) => void; onEscolher: (c: Parameters<typeof pessoaDoCliente>[0]) => void }) {
  const [busca, setBusca] = useState("");
  const q = useClientesBusca(useDebounce(busca, 300), open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Trazer do cadastro de clientes</DialogTitle>
          <DialogDescription>Nome, documento, e-mail, telefones e endereços entram na parte. Confira e complete depois.</DialogDescription>
        </DialogHeader>
        <SearchInput value={busca} onChange={setBusca} placeholder="Nome ou CPF/CNPJ" className="sm:w-full" />
        <ul className="max-h-80 divide-y overflow-y-auto rounded-xl border">
          {q.isPending ? (
            <li className="p-3">
              <Skeleton className="h-8" />
            </li>
          ) : (q.data?.itens ?? []).length === 0 ? (
            <li className="p-4 text-center text-sm text-muted-foreground">Nenhum cliente encontrado.</li>
          ) : (
            q.data!.itens.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onEscolher(c)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent/50">
                  {c.tipo === "PJ" ? <Building2 className="size-4 text-muted-foreground" /> : <User className="size-4 text-muted-foreground" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{c.nome}</span>
                    <span className="text-[11px] text-muted-foreground">
                      <span className="num">{documento(c.cpf_cnpj)}</span>
                      {c.cidade && ` · ${c.cidade}/${c.uf}`}
                    </span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function PartesEditor({
  partes,
  onChange,
  advogadoPadrao,
  semReu,
}: {
  partes: ParteIn[];
  onChange: (p: ParteIn[]) => void;
  advogadoPadrao: AdvogadoParteIn | null;
  semReu: boolean;
}) {
  const [cliente, setCliente] = useState<Polo | null>(null);
  const nova = (polo: Polo, pessoa: PessoaIn = pessoaVazia(), cliente_id: number | null = null): ParteIn => ({
    polo,
    tipo_participacao: polo === "ativo" ? "Autor" : polo === "passivo" ? "Réu" : null,
    pessoa,
    assistencia_judiciaria: false,
    advogados: polo === "ativo" && advogadoPadrao ? [advogadoPadrao] : [],
    cliente_id,
  });

  return (
    <div className="space-y-6">
      {POLOS_INICIAL.map((polo) => {
        const doPolo = partes.map((p, i) => ({ p, i })).filter((x) => (polo === "terceiro" ? !["ativo", "passivo"].includes(x.p.polo) : x.p.polo === polo));
        return (
          <section key={polo}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <UsersRound className="size-4 text-muted-foreground" />
                {polo === "terceiro" ? "Outros participantes" : ROTULO_POLO[polo]}
                <span className="text-xs font-normal text-muted-foreground">{doPolo.length}</span>
              </h3>
              <div className="flex gap-1">
                <Button type="button" variant="outline" size="sm" onClick={() => setCliente(polo)}>
                  <UsersRound /> Trazer do cadastro de clientes
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => onChange([...partes, nova(polo)])}>
                  <Plus /> Nova parte
                </Button>
              </div>
            </div>
            {doPolo.length === 0 ? (
              <p
                className={cn(
                  "rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground",
                  polo !== "terceiro" && !(polo === "passivo" && semReu) && "border-warning/50",
                )}
              >
                {polo === "ativo"
                  ? "Inclua ao menos uma parte no polo ativo (normalmente o cliente)."
                  : polo === "passivo"
                    ? semReu
                      ? "Procedimento sem réu: o polo passivo pode ficar vazio."
                      : "Inclua ao menos uma parte no polo passivo."
                    : "Opcional."}
              </p>
            ) : (
              <div className="space-y-2">
                {doPolo.map(({ p, i }) => (
                  <ParteCard
                    key={i}
                    parte={p}
                    indice={i}
                    advogadoPadrao={advogadoPadrao}
                    onChange={(n) => onChange(partes.map((x, j) => (j === i ? n : x)))}
                    onRemover={() => onChange(partes.filter((_, j) => j !== i))}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
      <ClienteDialog
        open={!!cliente}
        onOpenChange={(o) => !o && setCliente(null)}
        onEscolher={(c) => {
          onChange([...partes, nova(cliente ?? "ativo", pessoaDoCliente(c), c.id)]);
          setCliente(null);
        }}
      />
    </div>
  );
}
