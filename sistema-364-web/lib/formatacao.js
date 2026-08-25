// Utilitários de formatação de texto reaproveitáveis por qualquer cadastro
// (clientes, fornecedores, colaboradores) — sem dependência de React nem
// Supabase, então dá pra testar isolado.

// Progressiva: usa 4 dígitos por grupo (fixo) até chegar em 11 dígitos, aí
// vira 5 (celular). Igual a lib/cnpj.js: pontuação só entra quando já existe
// um dígito depois dela, então um número incompleto nunca fica com traço solto.
export function formatarTelefone(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  const ddd = d.slice(0, 2);
  const resto = d.slice(2);
  const tamanhoGrupo = d.length === 11 ? 5 : 4;
  if (resto.length <= tamanhoGrupo) return `(${ddd}) ${resto}`;
  return `(${ddd}) ${resto.slice(0, tamanhoGrupo)}-${resto.slice(tamanhoGrupo)}`;
}

const PREPOSICOES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'as', 'os', 'com', 'para']);

// Deixa "supermercado manar ltda" como "Supermercado Manar Ltda", mas mantém
// preposições em minúsculo (exceto na primeira palavra) e preserva siglas
// que já vieram maiúsculas do jeito que a pessoa digitou (EIRELI, ME...).
export function capitalizarNome(v) {
  const texto = String(v ?? '');
  if (!texto.trim()) return texto;
  let primeira = true;
  return texto.split(/(\s+)/).map(parte => {
    if (parte === '' || /^\s+$/.test(parte)) return parte;
    const ehPrimeira = primeira;
    primeira = false;
    if (parte.length > 1 && parte === parte.toUpperCase() && /[A-Z]/.test(parte)) return parte;
    const minuscula = parte.toLowerCase();
    if (!ehPrimeira && PREPOSICOES.has(minuscula)) return minuscula;
    return minuscula.charAt(0).toUpperCase() + minuscula.slice(1);
  }).join('');
}
