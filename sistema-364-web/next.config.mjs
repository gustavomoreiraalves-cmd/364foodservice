import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('./package.json');

// Executa um comando git e devolve string vazia se der qualquer problema.
// Na Vercel isto nem chega a rodar (as variáveis VERCEL_* respondem antes), mas
// o build também precisa funcionar fora de um repositório git — num clone .zip,
// por exemplo — sem quebrar.
function git(args) {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const commit = (process.env.VERCEL_GIT_COMMIT_SHA || git('rev-parse HEAD')).slice(0, 7);
const branch = process.env.VERCEL_GIT_COMMIT_REF || git('rev-parse --abbrev-ref HEAD');
const ambiente = process.env.VERCEL_ENV || 'local';

// A data é formatada aqui, no build, e não no componente: formatar no cliente
// faria o HTML do servidor e o do cliente divergirem (fuso e locale do
// navegador), que é erro de hidratação do React. O fuso é fixado porque a
// Vercel builda em UTC e a data precisa fazer sentido para quem está no Brasil.
const buildEm = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  timeZone: 'America/Sao_Paulo',
}).format(new Date()).replace(',', '');

// O bloco `env` congela estes valores no bundle. O Next substitui a expressão
// `process.env.NEXT_PUBLIC_APP_*` escrita por extenso — desestruturar ou montar
// o nome da variável em tempo de execução não funciona (ver VersaoBadge.js).
const nextConfig = {
  // Permite buildar sem derrubar o `next dev`, que também escreve em .next e
  // corrompe a pasta se os dois rodarem juntos: NEXT_DIST_DIR=.next-build npm run build.
  // Sem a variável nada muda — a Vercel continua usando o .next padrão.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  env: {
    NEXT_PUBLIC_APP_VERSAO: version,
    NEXT_PUBLIC_APP_COMMIT: commit,
    NEXT_PUBLIC_APP_BRANCH: branch,
    NEXT_PUBLIC_APP_AMBIENTE: ambiente,
    NEXT_PUBLIC_APP_BUILD_EM: buildEm,
  },
};

export default nextConfig;
