'use client';
import { dominioSerie } from '../../lib/consolidado';

const W = 720, H = 240;      // viewBox; o SVG escala para a largura do painel
const L = 10, R = 10, T = 14, B = 30;

// Doze meses de receita e custo em barras, com o lucro líquido como linha por
// cima. Sem biblioteca: o projeto não tem nenhuma e não vale carregar uma
// para três formas.
export default function SerieMensal({ dados }) {
  if (!dados?.length) {
    return <p className="muted" style={{ fontSize: 12.5 }}>Sem movimento no período.</p>;
  }

  const custoDe = d => d.cmv + d.despesaCompetencia;
  const { min, max } = dominioSerie(dados);
  const alturaPlot = H - T - B;
  const y = v => T + alturaPlot * (1 - (v - min) / (max - min));
  const base = y(0);
  const faixa = (W - L - R) / dados.length;
  const barra = faixa * 0.30;

  const linhaLucro = dados
    .map((d, i) => `${(L + faixa * (i + 0.5)).toFixed(1)},${y(d.lucroLiquido).toFixed(1)}`)
    .join(' ');

  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
           aria-label="Receita, custo e lucro líquido do grupo por mês">
        <line x1={L} y1={base} x2={W - R} y2={base} stroke="var(--border)" strokeWidth="1" />
        {dados.map((d, i) => {
          const centro = L + faixa * (i + 0.5);
          const topoReceita = y(d.receitaCompetencia);
          const topoCusto = y(custoDe(d));
          return (
            <g key={d.mes}>
              <rect x={centro - barra - 1} y={topoReceita} width={barra}
                    height={Math.max(base - topoReceita, 0)} fill="var(--amber)" />
              <rect x={centro + 1} y={topoCusto} width={barra}
                    height={Math.max(base - topoCusto, 0)} fill="var(--smoke)" />
              <text x={centro} y={H - 10} textAnchor="middle" fontSize="9"
                    fill="var(--paper-dim)">
                {`${d.mes.slice(5)}/${d.mes.slice(2, 4)}`}
              </text>
            </g>
          );
        })}
        <polyline points={linhaLucro} fill="none" stroke="var(--amber-bright)" strokeWidth="2" />
      </svg>
      <div style={{ display: 'flex', gap: 16, fontSize: 11.5, color: 'var(--paper-dim)', marginTop: 6 }}>
        <span><b style={{ color: 'var(--amber)' }}>▬</b> Receita</span>
        <span><b style={{ color: 'var(--smoke)' }}>▬</b> CMV + despesas</span>
        <span><b style={{ color: 'var(--amber-bright)' }}>▬</b> Lucro líquido</span>
      </div>
    </>
  );
}
