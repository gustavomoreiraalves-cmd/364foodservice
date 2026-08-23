'use client';

const W = 720, H = 220, L = 10, R = 10, T = 12, B = 28;

// Barras por dia, mesa embaixo e delivery em cima. Mesmo estilo do
// SerieMensal: SVG próprio, sem biblioteca.
export default function SerieDiariaPdv({ dados }) {
  if (!dados?.length) return <p className="muted" style={{ fontSize: 12.5 }}>Sem vendas no período.</p>;
  const max = Math.max(...dados.map(d => d.total), 1);
  const alturaPlot = H - T - B;
  const y = v => T + alturaPlot * (1 - v / max);
  const base = y(0);
  const faixa = (W - L - R) / dados.length;
  const barra = faixa * 0.6;
  const mostrarRotulo = i => dados.length <= 16 || i % Math.ceil(dados.length / 16) === 0;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Vendas por dia, mesa e delivery">
        <line x1={L} y1={base} x2={W - R} y2={base} stroke="var(--border)" strokeWidth="1" />
        {dados.map((d, i) => {
          const x = L + faixa * (i + 0.5) - barra / 2;
          const topoMesa = y(d.mesa + d.outro);
          const topoTotal = y(d.total);
          return (
            <g key={d.dia}>
              <rect x={x} y={topoMesa} width={barra} height={Math.max(base - topoMesa, 0)} fill="var(--amber)" />
              <rect x={x} y={topoTotal} width={barra} height={Math.max(topoMesa - topoTotal, 0)} fill="var(--smoke)" />
              {mostrarRotulo(i) && (
                <text x={x + barra / 2} y={H - 10} textAnchor="middle" fontSize="9" fill="var(--paper-dim)">
                  {d.dia.slice(8, 10)}/{d.dia.slice(5, 7)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div style={{ display: 'flex', gap: 16, fontSize: 11.5, color: 'var(--paper-dim)', marginTop: 6 }}>
        <span><b style={{ color: 'var(--amber)' }}>▬</b> Mesa/comanda</span>
        <span><b style={{ color: 'var(--smoke)' }}>▬</b> Delivery</span>
      </div>
    </>
  );
}
