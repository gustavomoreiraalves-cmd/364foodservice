'use client';
import { pontosDaSerie, variacao } from '../lib/sparkline';

// Minigráfico ao lado do valor de um KPI: mostra o caminho até aqui sem tomar
// o lugar do número. Sem biblioteca — é um polyline e nada mais.
export default function Sparkline({ serie, largura = 76, altura = 24, titulo }) {
  const pontos = pontosDaSerie(serie, { largura, altura });
  if (pontos.length < 2) return null;

  const caminho = pontos.map(p => `${p.x},${p.y}`).join(' ');
  const ultimo = pontos[pontos.length - 1];
  const pct = variacao(serie);

  return (
    <svg className="spark" width={largura} height={altura}
         viewBox={`0 0 ${largura} ${altura}`} fill="none" aria-hidden={titulo ? undefined : 'true'}
         role={titulo ? 'img' : undefined} aria-label={titulo}
         style={{ overflow: 'visible' }}>
      {titulo && <title>{titulo}</title>}
      <polyline points={caminho} stroke="currentColor" strokeWidth="1.5"
                strokeLinecap="round" strokeLinejoin="round" />
      {/* O ponto final marca onde a série está agora, que é o que se procura. */}
      <circle cx={ultimo.x} cy={ultimo.y} r="2.5" fill="currentColor" />
      {pct !== null && <desc>{pct > 0 ? '+' : ''}{pct}% no período</desc>}
    </svg>
  );
}
