// Estrutura da navegação lateral. Separada de MODULOS (lib/auth.js), que continua
// sendo o catálogo de permissões usado nos checkboxes da tela de Acesso.
// Item sem `modulo` é visível para qualquer usuário logado.
// `exato: true` quando o href é prefixo de outras rotas (caso de /producoes).
export const MENU = [
  { tipo: 'link', id: 'dashboard', label: 'Dashboard', href: '/', ic: '◆', exato: true },
  {
    tipo: 'grupo', id: 'cadastros', label: 'Cadastros', ic: '▤', itens: [
      { label: 'Clientes', href: '/clientes', modulo: 'clientes' },
      { label: 'Fornecedores', href: '/fornecedores', modulo: 'fornecedores' },
      { label: 'Produtos', href: '/produtos', modulo: 'produtos' },
      { label: 'Matéria-prima / Insumos', href: '/materias-primas', modulo: 'produtos' },
      { label: 'Empresas (CNPJ)', href: '/empresas', modulo: 'admin' },
    ],
  },
  {
    tipo: 'grupo', id: 'producao', label: 'Produção', ic: '▨', itens: [
      { label: 'Visão Geral', href: '/producoes', modulo: 'producoes', exato: true },
      { label: 'Recebimento', href: '/recebimentos', modulo: 'recebimentos' },
      { label: 'Defumação', href: '/producoes/defumacao', modulo: 'producoes' },
      { label: 'Embalagem', href: '/producoes/embalagem', modulo: 'producoes' },
      { label: 'Produção Completa', href: '/producoes/completa', modulo: 'producoes' },
      { label: 'Produção Interna', href: '/producoes/internas', modulo: 'producoes' },
      { label: 'Estoque', href: '/estoque', modulo: 'estoque' },
      { label: 'Relatório de Validades', href: '/producoes/validades', modulo: 'producoes' },
      { label: 'Histórico de Produção', href: '/producoes/historico', modulo: 'producoes' },
    ],
  },
  {
    tipo: 'grupo', id: 'vendas', label: 'Vendas', ic: '▩', itens: [
      { label: 'Pedidos (Food Services)', href: '/pedidos', modulo: 'pedidos' },
      { label: 'Vendas PDV (Steakhouse/Afya)', href: '/vendas/importacao', modulo: 'pedidos' },
      { label: 'Vendas Buffet', href: '/vendas/buffet', modulo: 'pedidos' },
      { label: 'Vendas Burguer (iFood)', href: '/vendas/burguer', modulo: 'pedidos' },
    ],
  },
  { tipo: 'link', id: 'financeiro', label: 'Financeiro', href: '/financeiro/contas-a-pagar', ic: '◈', modulo: 'financeiro' },
  {
    tipo: 'grupo', id: 'rh', label: 'RH', ic: '◔', itens: [
      { label: 'Painel do gestor', href: '/ponto/painel', modulo: 'ponto' },
      { label: 'Colaboradores', href: '/ponto/colaboradores', modulo: 'ponto' },
      { label: 'Marcações', href: '/ponto/marcacoes', modulo: 'ponto' },
      { label: 'Escalas', href: '/ponto/escalas', modulo: 'ponto' },
      { label: 'Apuração', href: '/ponto/apuracao', modulo: 'ponto' },
      { label: 'Fechamento', href: '/ponto/fechamento', modulo: 'ponto' },
      { label: 'Unidades e empregadores', href: '/ponto/unidades', modulo: 'ponto' },
      { label: 'Dispositivos', href: '/ponto/dispositivos', modulo: 'ponto' },
    ],
  },
  { tipo: 'link', id: 'relatorios', label: 'Relatórios', href: '/relatorios', ic: '▢', modulo: 'relatorios' },
];

function podeVer(modulo, permissoes, isAdmin) {
  if (isAdmin) return true;
  if (!modulo) return true;
  return permissoes.includes(modulo);
}

// Devolve o MENU filtrado pelas permissões. Grupo que ficou sem item some inteiro,
// para não sobrar cabeçalho órfão na sidebar.
export function menuVisivel(permissoes = [], isAdmin = false) {
  const saida = [];
  for (const entrada of MENU) {
    if (entrada.tipo === 'link') {
      if (podeVer(entrada.modulo, permissoes, isAdmin)) saida.push(entrada);
      continue;
    }
    const itens = entrada.itens.filter(i => podeVer(i.modulo, permissoes, isAdmin));
    if (itens.length) saida.push({ ...entrada, itens });
  }
  return saida;
}

export function itemAtivo(item, pathname) {
  return item.exato ? pathname === item.href : pathname.startsWith(item.href);
}

// Qual grupo contém a rota atual. Ganha o href mais longo, para o item mais
// específico vencer quando dois casam por prefixo.
export function grupoDaRota(pathname) {
  let melhor = null;
  for (const grupo of MENU) {
    if (grupo.tipo !== 'grupo') continue;
    for (const item of grupo.itens) {
      if (!itemAtivo(item, pathname)) continue;
      if (!melhor || item.href.length > melhor.href.length) melhor = { href: item.href, id: grupo.id };
    }
  }
  return melhor ? melhor.id : null;
}
