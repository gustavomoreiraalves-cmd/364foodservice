'use client';

// Controles de paginação reutilizados por toda lista (pedidos, produtos,
// notas, clientes). A mecânica de fatiar as linhas vive em
// lib/listaCadastro.js#paginar — este componente só desenha o resultado dela.

const TAMANHOS_PADRAO = [10, 25, 50, 100];

export default function Paginacao({
  paginaAtual, totalPaginas, tamanhoPagina, onMudarPagina, onMudarTamanho,
  tamanhos = TAMANHOS_PADRAO,
}) {
  return (
    <div className="paginacao">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="btn secondary small" disabled={paginaAtual <= 1}
                onClick={() => onMudarPagina(Math.max(1, paginaAtual - 1))}>Anterior</button>
        <span className="muted">Página {paginaAtual} de {totalPaginas}</span>
        <button type="button" className="btn secondary small" disabled={paginaAtual >= totalPaginas}
                onClick={() => onMudarPagina(Math.min(totalPaginas, paginaAtual + 1))}>Próxima</button>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0 }}>
        Por página
        <select value={tamanhoPagina} onChange={e => onMudarTamanho(Number(e.target.value))}>
          {tamanhos.map(n => <option key={n} value={n}>{n}</option>)}
          <option value={0}>Todos</option>
        </select>
      </label>
    </div>
  );
}
