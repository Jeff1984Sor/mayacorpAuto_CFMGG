"use client";

import { CheckCircle2, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";

import { ClientLogo, MayaCorpAssinatura } from "@/components/mayacorp/brand";
import { FaixaAmbiente } from "@/components/mayacorp/shell";
import { useBrand } from "@/lib/brand";

const DESTAQUES = [
  { i: CheckCircle2, t: "Pré-validação linha a linha", d: "Erros aparecem antes de ir para a Prefeitura." },
  { i: ShieldCheck, t: "Seguro por padrão", d: "Certificado criptografado e auditoria completa." },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { nome_exibicao } = useBrand();
  return (
    <div className="grid min-h-dvh pt-(--faixa) lg:grid-cols-[1.05fr_1fr]">
      <FaixaAmbiente />
      {/* painel da marca */}
      <aside className="relative hidden overflow-hidden bg-dark-maya text-white lg:flex lg:flex-col">
        <div className="grid-bg absolute inset-0 opacity-60" />
        <div className="absolute -top-32 -left-32 size-[28rem] rounded-full bg-brand/35 blur-[110px]" />
        <div className="absolute -right-24 bottom-0 size-[24rem] rounded-full bg-navy/80 blur-[100px]" />
        <div className="relative flex flex-1 flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <ClientLogo compacto className="size-11" />
            <div>
              <p className="font-semibold">{nome_exibicao}</p>
              <p className="text-xs text-white/60">Automações</p>
            </div>
          </div>

          <div className="max-w-lg">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs backdrop-blur"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-success" />
              RPA 01 · NFS-e layout 2 com IBS e CBS
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.08 }}
              className="text-4xl leading-[1.1] font-semibold tracking-tight xl:text-5xl"
            >
              Seus robôs trabalhando,{" "}
              <span className="bg-linear-to-r from-brand to-white bg-clip-text text-transparent">você no controle.</span>
            </motion.h1>
            <div className="mt-10 space-y-4">
              {DESTAQUES.map((d, k) => (
                <motion.div
                  key={d.t}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.25 + k * 0.1 }}
                  className="flex gap-3"
                >
                  <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/8 ring-1 ring-white/10">
                    <d.i className="size-4 text-brand" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{d.t}</p>
                    <p className="text-sm text-white/55">{d.d}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* espaçador: mantém o texto centralizado na coluna */}
          <div />
        </div>
      </aside>

      {/* formulário */}
      <main className="relative flex flex-col">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-linear-to-b from-brand/8 to-transparent lg:hidden" />
        <div className="relative flex flex-1 items-center justify-center px-5 py-12">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <footer className="relative flex justify-center pb-6 text-muted-foreground">
          <MayaCorpAssinatura />
        </footer>
      </main>
    </div>
  );
}
