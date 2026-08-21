'use client';

// Barra fina usada dentro da tabela de ranking: mostra a fatia da empresa na
// receita do grupo sem ocupar uma coluna de gráfico inteira.
export default function BarraParticipacao({ pct }) {
  const largura = Math.min(100, Math.max(0, Number(pct) || 0));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--char3)', borderRadius: 3, minWidth: 40 }}>
        <div style={{ width: `${largura}%`, height: '100%', background: 'var(--amber)', borderRadius: 3 }} />
      </div>
      <span className="num" style={{ fontSize: 11.5, color: 'var(--paper-dim)', minWidth: 44 }}>
        {largura.toFixed(1)}%
      </span>
    </div>
  );
}
