import { useRef, useState } from "react";
import { toast } from "sonner";

import { ApiError, api } from "@/lib/api";
import { cnpjValido } from "@/lib/validacao";

export interface CnpjDados {
  cnpj: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  situacao: string | null;
  ativa: boolean;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
  telefone: string | null;
  email: string | null;
}

/** Consulta pública do CNPJ (Receita Federal, via nossa API) para preencher o cadastro sozinho. */
export function useCnpj() {
  const [carregando, setCarregando] = useState(false);
  const ultimo = useRef<string | null>(null);

  const buscar = async (valor: string): Promise<CnpjDados | null> => {
    const d = valor.replace(/\D/g, "");
    if (d.length !== 14 || !cnpjValido(d) || d === ultimo.current) return null;
    ultimo.current = d; // não consulta de novo o mesmo número a cada tecla/blur
    setCarregando(true);
    try {
      const dados = await api<CnpjDados>(`/cadastros/cnpj/${d}`);
      if (!dados.ativa && dados.situacao) {
        toast.warning(`Atenção: este CNPJ está ${dados.situacao} na Receita Federal.`);
      }
      return dados;
    } catch (e) {
      ultimo.current = null;
      if (e instanceof ApiError) toast.warning(e.message);
      return null;
    } finally {
      setCarregando(false);
    }
  };
  return { buscar, carregando };
}

/** Preenche só os campos vazios (nunca sobrescreve o que a pessoa digitou). Devolve os campos alterados. */
export function preencherVazios(
  valores: Record<string, unknown>,
  dados: Record<string, string | null | undefined>,
  definir: (campo: string, valor: string) => void,
): string[] {
  const mudou: string[] = [];
  for (const [campo, valor] of Object.entries(dados)) {
    if (!valor) continue;
    const atual = valores[campo];
    if (atual === undefined || atual === null || String(atual).trim() === "") {
      definir(campo, valor);
      mudou.push(campo);
    }
  }
  return mudou;
}
