import { useState } from "react";
import { toast } from "sonner";

export interface ViaCep {
  cep: string;
  logradouro: string;
  complemento: string;
  bairro: string;
  localidade: string;
  uf: string;
  ibge: string;
  erro?: boolean;
}

/** Consulta de CEP via ViaCEP (preenchimento automático de endereço). */
export function useCep() {
  const [carregando, setCarregando] = useState(false);
  const buscar = async (cep: string): Promise<ViaCep | null> => {
    const d = cep.replace(/\D/g, "");
    if (d.length !== 8) return null;
    setCarregando(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${d}/json/`);
      const j = (await r.json()) as ViaCep;
      if (j.erro) {
        toast.warning("CEP não encontrado.");
        return null;
      }
      return j;
    } catch {
      return null;
    } finally {
      setCarregando(false);
    }
  };
  return { buscar, carregando };
}
