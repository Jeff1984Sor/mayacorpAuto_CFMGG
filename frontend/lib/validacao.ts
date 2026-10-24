const dig = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

function dv(base: string, pesos: number[]) {
  const r = base.split("").reduce((a, d, i) => a + Number(d) * pesos[i], 0) % 11;
  return r < 2 ? 0 : 11 - r;
}

export function cpfValido(v: string | null | undefined) {
  const c = dig(v);
  if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  const d1 = dv(c.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = dv(c.slice(0, 9) + d1, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return c.endsWith(`${d1}${d2}`);
}

export function cnpjValido(v: string | null | undefined) {
  const c = dig(v);
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = dv(c.slice(0, 12), p1);
  const d2 = dv(c.slice(0, 12) + d1, [6, ...p1]);
  return c.endsWith(`${d1}${d2}`);
}

export const docValido = (v: string | null | undefined) => (dig(v).length === 11 ? cpfValido(v) : cnpjValido(v));
export { dig as soDigitos };
