import { montarVersao } from '../lib/versao.js';

// Selo de build no rodapé da sidebar: diz em qual ambiente e em qual commit a
// tela aberta está rodando. Serve para conferir se a produção já recebeu a
// última entrega e para o suporte saber qual build o usuário está usando.
//
// Os `process.env` aparecem escritos por extenso de propósito: o Next troca a
// expressão literal pelo valor durante o build (ver next.config.mjs). Ler
// process.env por variável devolveria undefined no navegador.
export default function VersaoBadge() {
  const info = montarVersao({
    versao: process.env.NEXT_PUBLIC_APP_VERSAO,
    commit: process.env.NEXT_PUBLIC_APP_COMMIT,
    branch: process.env.NEXT_PUBLIC_APP_BRANCH,
    ambiente: process.env.NEXT_PUBLIC_APP_AMBIENTE,
    buildEm: process.env.NEXT_PUBLIC_APP_BUILD_EM,
  });

  return (
    <div className="versao-badge" title={info.titulo}>
      <div className="versao-linha">
        {info.versao}
        {' · '}
        <span className={info.ehProducao ? undefined : 'versao-ambiente-alerta'}>{info.ambiente}</span>
        {info.branch ? <>{' · '}{info.branch}</> : null}
      </div>
      <div className="versao-linha">{info.commit} · {info.buildEm}</div>
    </div>
  );
}
