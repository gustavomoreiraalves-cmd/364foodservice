# 364 OS — Backup: execução assistida

Cole o bloco abaixo no **Claude Code**, aberto na pasta do projeto. Ele executa tudo
sozinho e para para perguntar só quando precisa de algo que só você tem.

---

## Prompt para o Claude Code

```
Preciso colocar o backup do 364 OS para funcionar. Os scripts ja existem em
scripts/backup-364.sh e scripts/backup-storage.mjs — nao reescreva nenhum dos dois.

Execute nesta ordem, me mostrando o resultado de cada etapa e PARANDO se algo falhar:

1. Verifique se o pg_dump existe e se a versao e 15+.
   Se nao existir ou for antiga: rode "brew install postgresql@17", adicione
   /opt/homebrew/opt/postgresql@17/bin ao PATH no ~/.zshrc e confirme a versao.

2. Valide o arquivo .env.backup SEM me mostrar os valores (eles tem senha).
   Confira apenas: se as chaves SUPABASE_DB_URL e BACKUP_SENHA existem, se a
   SUPABASE_DB_URL comeca com postgresql:// e esta em uma unica linha, e se a
   BACKUP_SENHA nao esta vazia. Me diga so "ok" ou qual chave esta com problema.
   Se BACKUP_SENHA estiver entre aspas duplas, troque as aspas duplas por simples.

3. Rode "bash scripts/backup-364.sh" e me mostre a saida completa.
   Se der erro de autenticacao do Postgres, me avise — a senha do banco esta
   errada e so eu posso resetar isso no painel do Supabase.

4. Confirme o resultado: liste o conteudo de "Meu Drive/364 Backups", me mostre
   o ULTIMO-BACKUP.txt e confirme que a linha "Cifrado" diz "sim".

5. Agende o backup diario as 12:30 via crontab, apontando para o caminho absoluto
   de scripts/backup-364.sh. Preserve as entradas de crontab que ja existirem.
   Depois me lembre de dar Acesso Total ao Disco para /usr/sbin/cron em
   Ajustes > Privacidade e Seguranca.

6. Adicione "backup": "bash scripts/backup-364.sh" na secao scripts do package.json.

Nao me peca nenhuma senha e nao imprima o conteudo de .env.local ou .env.backup.
```

---

## O que o Claude Code NÃO consegue fazer (fica com você)

Quatro coisas exigem você — três por serem credenciais, uma por envolver pagamento.

**1. A senha do banco Supabase.** Se o passo 3 falhar com erro de autenticação:
painel do Supabase → Project Settings → Database → **Reset database password**. Gere uma
senha **só com letras e números** (caracteres como `@`, `/`, `:` e `#` quebram a URI de
conexão) e atualize a `SUPABASE_DB_URL` no `.env.backup`.

**2. A senha de app do Gmail.** Para o comprovante de ponto voltar a ser enviado:

- `myaccount.google.com/security` → ativar verificação em 2 etapas
- `myaccount.google.com/apppasswords` → nome `364 OS Ponto` → Criar
- copiar os 16 caracteres **sem espaços** para o `.env.local`:
  ```
  GMAIL_USER=ponto@seudominio.com.br
  GMAIL_APP_PASSWORD=abcdefghijklmnop
  ```
- cadastrar as **mesmas duas** na Vercel (Settings → Environment Variables → Production)
- **Redeploy** na Vercel (variável de ambiente só vale para deploy novo)

**3. Guardar duas senhas no gerenciador**, fora do Drive:

- `BACKUP_SENHA` — sem ela, os backups cifrados são irrecuperáveis
- `PONTO_BIOMETRIA_CHAVE` — sem ela, todos os cadastros biométricos precisam ser refeitos

**4. Os upgrades de plano** (envolvem cartão):

- Supabase → Settings → Billing → Upgrade to Pro (US$ 25)
- Vercel → Settings → Billing → Upgrade to Pro (US$ 20)

---

## Depois que rodar

Uma vez, sem pressa, teste a restauração num projeto Supabase novo e vazio — backup
nunca restaurado é só um arquivo grande:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in 364-banco-AAAA-MM-DD_HHMM.dump.enc -out restaurado.dump

pg_restore --no-owner --no-privileges --clean --if-exists \
  -d "postgresql://postgres.PROJETO-NOVO:SENHA@...:5432/postgres" restaurado.dump
```

Erros sobre `extension` e sobre roles do próprio Supabase são normais. O que importa é
as tabelas de `public` voltarem com os dados.
