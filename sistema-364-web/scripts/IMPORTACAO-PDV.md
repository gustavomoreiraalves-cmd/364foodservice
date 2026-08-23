# Importação das vendas do PDV Consumer

O 364 OS lê o painel **Consumer Connect** (connect.consumer.com.br) da 364
Steakhouse e da 364 Foodtruck/Afya e grava pedidos, itens, pagamentos, caixas
e recebimentos nas tabelas `pdv_*`. A tela é **Vendas → Vendas PDV
(Steakhouse/Afya)**.

## Pegar o cookie da sessão

O painel não tem API nem token. O script usa o cookie do seu login:

1. Abra https://connect.consumer.com.br no Chrome e faça login.
2. `⌥⌘I` (DevTools) → aba **Network** → recarregue a página.
3. Clique na primeira requisição (`connect.consumer.com.br`) → **Headers** →
   em *Request Headers* copie o valor inteiro de `Cookie:` (começa com algo
   como `ASP.NET_SessionId=...`).
4. No `.env.local` do projeto: `CONSUMER_CONNECT_COOKIE='cole aqui'` (aspas
   simples).

Quando a sessão do painel expirar o script para com `SESSAO_EXPIRADA`: repita
os passos. Não feche a sessão no navegador ("Sair"), isso invalida o cookie.

## Rodar

```bash
npm run importar-pdv                        # últimos 3 dias, as duas lojas
npm run importar-pdv -- --de 2026-08-01     # carga inicial desde 1º de agosto
npm run importar-pdv -- --dry-run           # só conta, não grava
npm run importar-pdv -- --loja -2147458165  # só a Afya
```

Saída: contadores por loja e `Fim: ok | parcial | erro`. Cada rodada deixa
uma linha em `pdv_importacoes`, que a tela mostra como "Última importação".

## Agendar (cron, 05:00)

```bash
crontab -e
```

```
0 5 * * * cd "/caminho/do/sistema-364-web" && /usr/local/bin/npm run importar-pdv >> "$HOME/Library/Logs/364-importar-pdv.log" 2>&1
```

Use o caminho do `npm` que `which npm` devolver. O Mac precisa estar ligado e
com rede às 05:00 (mesma condição do backup das 12:30).

## Conferência

Compare um dia no painel (Dashboard → Valor Total Recebido, com o período
ajustado para o dia) com a soma de `vw_pdv_vendas_dia` daquele dia. Diferença
esperada: zero para dias com todos os pedidos finalizados.
