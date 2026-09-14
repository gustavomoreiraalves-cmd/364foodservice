'use client';

// Lista de cadastro com cabeçalho de colunas, no padrão da tela de Produtos:
// a lista ocupa a tela e a ficha abre por cima.
//
// Cabeçalho e linha desenham a partir da MESMA definição de colunas — foi assim
// que o desalinhamento entre rótulo e valor deixou de ser possível. Larguras são
// fixas, nunca mínimas: com `min-width`, um valor mais largo que o rótulo empurra
// a coluna seguinte e o desvio se acumula da esquerda para a direita.

function estiloDaColuna(col) {
  if (col.principal) return { flex: '1 1 0', minWidth: col.minimo || 160 };
  return { flex: 'none', width: col.largura || 110 };
}

export default function ListaCadastro({
  colunas, registros, selecionado, onAbrir, vazio, rotulo = 'Registros',
  ordenacao, onOrdenar,
}) {
  if (!registros.length) {
    return <p className="muted" style={{ padding: '18px 0' }}>{vazio}</p>;
  }

  return (
    <div className="registro-lista" role="listbox" aria-label={rotulo}>
      <div className="registro-cabecalho">
        {colunas.map(col => {
          const estilo = { ...estiloDaColuna(col), textAlign: col.alinhamento || 'left' };
          // Só coluna com `id` tem como que `onOrdenar` diga ao pai qual campo
          // ordenar (o mesmo `id` que `ordenarRegistros` usa pra achar `valor()`).
          if (!col.id || !onOrdenar) {
            return <span key={col.titulo} style={estilo} aria-hidden="true">{col.titulo}</span>;
          }
          const ativa = ordenacao?.campo === col.id;
          const seta = ativa ? (ordenacao.direcao === 'asc' ? '▲' : '▼') : '';
          return (
            <button key={col.titulo} type="button" className="registro-cabecalho-ordenar"
                    style={estilo} onClick={() => onOrdenar(col.id)}
                    aria-label={`Ordenar por ${col.titulo}` + (ativa ? (ordenacao.direcao === 'asc' ? ', crescente' : ', decrescente') : '')}>
              {col.titulo}{seta && <span aria-hidden="true"> {seta}</span>}
            </button>
          );
        })}
      </div>

      {registros.map(r => (
        <button type="button" key={r.id} role="option"
                aria-selected={selecionado === r.id}
                className={'registro' + (r.ativo === false ? ' inativo' : '')}
                onClick={() => onAbrir(r)}>
          {colunas.map(col => {
            const conteudo = col.render(r);
            return (
              <span key={col.titulo}
                    className={col.mono ? 'mono' : undefined}
                    style={{
                      ...estiloDaColuna(col),
                      textAlign: col.alinhamento || 'left',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={col.titulo + ': ' + (col.textoPuro ? col.textoPuro(r) : '')}>
                {conteudo ?? <span className="muted">—</span>}
              </span>
            );
          })}
        </button>
      ))}
    </div>
  );
}
