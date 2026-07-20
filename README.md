# 364 Foodservices — Sistema de Gestão (Web)

Stack: **Next.js** (frontend) + **Supabase** (banco de dados Postgres + login) + **Vercel** (hospedagem gratuita).

Este projeto é o ponto de partida para o Claude Code continuar construindo. O módulo
**Fornecedores** já funciona de ponta a ponta e serve de modelo — veja `ROADMAP.md`
para a lista do que falta.

## Passo 1 — Criar o projeto no Supabase (gratuito)

1. Crie uma conta em https://supabase.com e clique em "New Project".
2. Anote a senha do banco que você definir (guarde num lugar seguro).
3. Depois que o projeto for criado, vá em **SQL Editor** → **New query**, cole todo
   o conteúdo de `supabase/schema.sql` deste projeto, e clique em **Run**.
   Isso cria todas as tabelas, as views de estoque e a segurança (RLS).
4. Vá em **Project Settings → API** e copie:
   - **Project URL**
   - **anon public key**

## Passo 2 — Configurar o projeto localmente

```bash
cd sistema-364-web
npm install
cp .env.local.example .env.local
```

Abra `.env.local` e cole a URL e a chave que você copiou do Supabase.

```bash
npm run dev
```

Abra http://localhost:3000 — a tela de Fornecedores já deve funcionar, gravando
direto no seu banco Supabase.

## Passo 3 — Publicar online (Vercel, gratuito)

1. Crie um repositório no GitHub e suba este projeto (`git init`, `git add .`,
   `git commit -m "primeira versão"`, `git push`).
2. Crie uma conta em https://vercel.com, clique em **Add New → Project**, e
   selecione esse repositório.
3. Em **Environment Variables**, adicione as duas mesmas variáveis do `.env.local`
   (`NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
4. Clique em **Deploy**. Em ~1 minuto você tem uma URL pública, tipo
   `sistema-364.vercel.app`.

## Passo 4 — Ligar ao seu domínio / site Wix

- **Opção simples:** No Wix, adicione um botão "Acessar sistema" apontando para a
  URL da Vercel (ou configure um domínio próprio, tipo `sistema.364foodservices.com.br`,
  nas configurações de domínio da Vercel).
- **Opção embutida:** No Wix, use o elemento *Embed → Embed a Widget/HTML* e cole a
  URL publicada — ela vai aparecer dentro de uma página do seu site Wix.

## Passo 5 — Continuar construindo com o Claude Code

Abra esta pasta no Claude Code e peça para seguir o `ROADMAP.md`, módulo por
módulo, usando `app/fornecedores/page.js` como padrão de estrutura.

## Aviso sobre o plano gratuito do Supabase

Projetos gratuitos do Supabase pausam automaticamente após 7 dias sem nenhuma
requisição. Isso não deve ser problema em uso diário normal da empresa — só vale
lembrar caso o sistema fique parado por mais de uma semana (ex: período de férias
coletivas), porque aí é preciso reativar manualmente no painel do Supabase.
