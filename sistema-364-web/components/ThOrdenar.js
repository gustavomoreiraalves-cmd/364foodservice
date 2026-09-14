'use client';

// Cabeçalho de coluna clicável para tabelas <table> cruas (pedidos, situação
// fiscal de produtos) — mesma ideia do cabeçalho de ListaCadastro.js, mas para
// quem ainda usa <table>/<th> em vez do componente de lista de cadastro.

export default function ThOrdenar({ titulo, campo, ordenacao, onOrdenar, alinhamento }) {
  const ativa = ordenacao.campo === campo;
  const seta = ativa ? (ordenacao.direcao === 'asc' ? '▲' : '▼') : '';
  return (
    <th style={alinhamento ? { textAlign: alinhamento } : undefined}>
      <button type="button" className="th-ordenar" onClick={() => onOrdenar(campo)}
              aria-label={`Ordenar por ${titulo}` + (ativa ? (ordenacao.direcao === 'asc' ? ', crescente' : ', decrescente') : '')}>
        {titulo}{seta && <span aria-hidden="true"> {seta}</span>}
      </button>
    </th>
  );
}
