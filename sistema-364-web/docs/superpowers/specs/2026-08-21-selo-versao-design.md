# Selo de versão no rodapé da sidebar

Data: 21/08/2026

## Problema

O mesmo código roda em três lugares — máquina local, preview da Vercel e
produção — e, olhando a tela, não havia como saber em qual deles se está nem se
a produção já recebeu a última entrega. O gatilho foi concreto: a branch
`feat/menu-categorias` acumulou 59 commits que não estão em `origin/main`, a
Vercel publica `main`, e a produção rodava código antigo sem nenhum sinal disso
na interface.

O selo não resolve o deploy atrasado. Resolve a *visibilidade* dele, e serve
também ao suporte: quem relata um bug consegue dizer qual build estava usando.

## Decisões

- **Conteúdo:** versão + ambiente + commit + data do build. Só a versão é
  manual; o resto é automático. O commit é o que garante que dois builds
  diferentes nunca pareçam iguais, mesmo que a versão não seja bumpada.
- **Versão manual** no `package.json`, bumpada quando se quer marcar uma
  entrega. Nada de tag git (exigiria hábito novo e clone completo na Vercel) nem
  de versão por data (não comunica escopo).
- **Visível a todos os usuários**, não só a admin: quem relata bug normalmente
  não é admin. O hash não expõe nada — o repositório é privado.
- **Branch só fora de produção.** Em produção é sempre `main` e ocuparia espaço
  à toa; fica no `title`. Em preview e local é a informação mais útil da linha.

## Arquitetura

| Arquivo | Papel |
|---|---|
| `next.config.mjs` (novo) | Congela versão, commit, branch, ambiente e data no build |
| `lib/versao.js` | Formatação pura dos valores brutos — a única parte com lógica |
| `components/VersaoBadge.js` | Apresentação, dentro do `.sidebar-foot` existente |
| `app/globals.css` | `.versao-badge` |
| `tests/versao.test.mjs` | Cobre `lib/versao.js` |

Origem de cada valor:

| Valor | Vercel | Local |
|---|---|---|
| commit | `VERCEL_GIT_COMMIT_SHA` (7 chars) | `git rev-parse HEAD` |
| branch | `VERCEL_GIT_COMMIT_REF` | `git rev-parse --abbrev-ref HEAD` |
| ambiente | `VERCEL_ENV` | ausente, vira `local` |
| versão | `package.json` | `package.json` |
| data | `new Date()` do build | idem |

As chamadas ao `git` ficam em `try/catch` e só rodam quando as variáveis
`VERCEL_*` estão ausentes, para o build não depender de haver um repositório
git.

A data é formatada **no build**, com fuso fixo em `America/Sao_Paulo`. Formatar
no cliente faria o HTML do servidor divergir do cliente (fuso e locale do
navegador), que é erro de hidratação do React; e a Vercel builda em UTC, então
sem o fuso fixo a hora não faria sentido para quem está no Brasil.

O bloco `env` do `next.config.mjs` substitui a expressão
`process.env.NEXT_PUBLIC_APP_*` escrita por extenso no bundle. Por isso o
componente lê cada variável literalmente, em vez de desestruturar `process.env`.

## Fora de escopo

Resolver a Vercel desatualizada. O merge de `feat/menu-categorias` para `main`
envolve migrações de banco em produção e foi deixado para uma decisão separada.
