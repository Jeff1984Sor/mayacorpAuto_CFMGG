"use client";

import { Eye } from "lucide-react";
import { useState } from "react";

import { AdvogadosTribunais } from "@/components/tribunais-config/advogados";
import { AvisosProtocolo } from "@/components/tribunais-config/avisos";
import { ConsumoTribunais } from "@/components/tribunais-config/consumo";
import { EscritorioTribunais } from "@/components/tribunais-config/escritorio";
import { PlanosTribunais } from "@/components/tribunais-config/planos";
import { PlataformaTribunais, TabelasLocais } from "@/components/tribunais-config/plataforma";
import { SistemasTribunais } from "@/components/tribunais-config/sistemas";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";

export default function ConfigTribunaisPage() {
  const { pode, usuario } = useAuth();
  const [aba, setAba] = useState("escritorio");
  const podeEditar = pode("cfg_tribunais.editar");
  const equipe = !!usuario?.equipe_mayacorp;

  return (
    <div>
      {!podeEditar && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-info/30 bg-info/8 px-3.5 py-2.5 text-sm text-info-ink">
          <Eye className="size-4 shrink-0" />
          Seu perfil de acesso permite consultar esta configuração, mas não alterá-la.
        </p>
      )}
      <Tabs value={aba} onValueChange={(v) => setAba(String(v))}>
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            <TabsTrigger value="escritorio">Escritório</TabsTrigger>
            <TabsTrigger value="avisos">Avisos de protocolo</TabsTrigger>
            <TabsTrigger value="advogados">Advogados</TabsTrigger>
            <TabsTrigger value="consumo">Consumo</TabsTrigger>
            {equipe && (
              <>
                <TabsTrigger value="plataforma">Plataforma</TabsTrigger>
                <TabsTrigger value="sistemas">Tribunais e sistemas</TabsTrigger>
                <TabsTrigger value="tabelas">Tabelas locais</TabsTrigger>
                <TabsTrigger value="planos">Planos</TabsTrigger>
              </>
            )}
          </TabsList>
        </div>
        <TabsContent value="escritorio" className="pt-4">
          <EscritorioTribunais podeEditar={podeEditar} irConsumo={() => setAba("consumo")} />
        </TabsContent>
        <TabsContent value="avisos" className="pt-4">
          <AvisosProtocolo podeEditar={podeEditar} />
        </TabsContent>
        <TabsContent value="advogados" className="pt-4">
          <AdvogadosTribunais podeEditar={podeEditar} />
        </TabsContent>
        <TabsContent value="consumo" className="pt-4">
          <ConsumoTribunais />
        </TabsContent>
        {equipe && (
          <>
            <TabsContent value="plataforma" className="pt-4">
              <PlataformaTribunais />
            </TabsContent>
            <TabsContent value="sistemas" className="pt-4">
              <SistemasTribunais />
            </TabsContent>
            <TabsContent value="tabelas" className="pt-4">
              <TabelasLocais />
            </TabsContent>
            <TabsContent value="planos" className="pt-4">
              <PlanosTribunais />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}
