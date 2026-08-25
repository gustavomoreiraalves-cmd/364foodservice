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

// "Terça-feira, 25 de agosto de 2026" — usada na tela de login. O Intl devolve
// o dia da semana em minúscula em pt-BR; aqui ele entra capitalizado porque a
// frase começa nele. A data vem por parâmetro para o valor ser testável e para
// quem chama decidir o momento (na tela, o relógio do navegador do usuário).
export function dataPorExtenso(data) {
  if (!(data instanceof Date) || Number.isNaN(data.getTime())) return '';
  const texto = data.toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
