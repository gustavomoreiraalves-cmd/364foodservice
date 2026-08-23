// Utilitários de CNPJ sem dependência de React ou Supabase: servem tanto às
// telas quanto às rotas de API e aos testes.

export function somenteDigitos(v) {
  return String(v || '').replace(/\D/g, '');
}

// Máscara progressiva: funciona enquanto o usuário digita.
export function formatarCnpj(v) {
  const d = somenteDigitos(v).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

export function cnpjValido(digitos) {
  const d = somenteDigitos(digitos);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base, pesos) => {
    const soma = base.split('').reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, ...p1];
  const dv1 = calc(d.slice(0, 12), p1);
  const dv2 = calc(d.slice(0, 12) + dv1, p2);
  return d.endsWith(`${dv1}${dv2}`);
}
