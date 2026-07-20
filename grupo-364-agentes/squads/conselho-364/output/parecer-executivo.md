# Parecer Executivo — Estruturação da 364 Foodservices para comercialização
**Data:** 2026-07-18 (v2 — ajustes do usuário aplicados) · **Pauta:** projeto · **Especialistas:** Juvenal Jurídico, Ivone Indústria, Diego Digital, Átila Automação (+ Marina Marca, CMO)

## Decisão recomendada

Lançar a 364 Foodservices em **10/08 (domingo)** posicionada como "os defumados da 364 Steakhouse, agora na sua casa", com **4 frentes**: venda direta (Steakhouse + WhatsApp), **pré-venda de Box de lançamento** (seleção dos produtos) evoluindo para **assinatura mensal** (R$ 129–149), atacado food service em **toda Rondônia** (mínimo R$ 400, 50% antecipado) e **sementes do canal distribuidor** ainda em 2026. A cobertura estadual apoia-se na orientação do veterinário responsável da Secretaria de Agricultura (convênio intermunicipal em andamento; ~1 ano de conforto regulatório) — com a condição de **documentar essa orientação por escrito**. Fiscal permanece no **ERP Consumer** já contratado (NF-e); o **sistema-364-web** assume a gestão de **recebimento, insumos, produção e estoque** — as prioridades definidas pelo usuário — sobre a base já existente (login, fornecedores, clientes, pedidos, relatórios). Divulgação: **boxes para influenciadores locais** + pré-venda controlada.

## Por quê

1. **Regulatório destravado, mas com lição de casa:** a orientação verbal do veterinário da Secretaria amplia o mercado imediato de Ji-Paraná para Rondônia inteira (Porto Velho, Cacoal, Ariquemes, Vilhena). Condição do Jurídico: obter a orientação **por escrito** (e-mail ou ofício) — quem fiscaliza na prática é o órgão de destino, e um papel vale mais que uma conversa se um lote for questionado fora do município. [Confiança: Média até documentar]
2. **Sem custo novo de ERP:** o Consumer já emite NF — a recomendação anterior de contratar Omie **cai**. O investimento vai para onde há lacuna real: o sistema-364-web cobrindo produção, insumos, estoque e recebimentos, que o Consumer de restaurante não cobre para uma indústria.
3. **Influenciadores locais são o atalho certo de 23 dias:** semear boxes em 5–8 influenciadores de Ji-Paraná/região na semana do aquecimento gera prova social local — vantagem que o benchmark @tiojack_bbq não construiu; a mecânica replica o que funciona nas redes grandes (Madero × influenciadores) em escala municipal. [Fonte: Investigação Sherlock]
4. **Pré-venda de Box mede demanda antes do estoque sair:** box de seleção com preço fundador valida SKUs, gera caixa antecipado e alimenta a futura assinatura com os primeiros recorrentes.
5. **Marca guarda-chuva:** avaliação 4,6–5,0 da Steakhouse emprestada ao lançamento ("por 364 Steakhouse" no selo visual das embalagens). [Fonte: perfil da empresa]

## Plano de ação (30 dias críticos)

| Ação | Responsável | Prazo | Indicador |
|---|---|---|---|
| Documentar por escrito a orientação da Secretaria (venda estadual + convênio) | Gustavo | 25/07 | e-mail/ofício arquivado |
| Fichas técnicas dos 8 SKUs no sistema (usuário enviará — custo/kg, rendimento, teto semanal) | Gustavo + líder de produção | 27/07 | 8 fichas registradas |
| Sprint 1 do sistema: recebimento + insumos + produção + estoque operacionais (padrão módulo Fornecedores) | Dev (Claude Code) | 03/08 | módulos gravando no Supabase |
| Selecionar 5–8 influenciadores locais + box-presente com carta e código de rastreio de cupom | Marketing + Gustavo | 30/07 (envio 01–04/08) | ≥ 5 boxes entregues |
| Pré-venda do Box de lançamento: 50 unidades, oferta fundador, controle de pedidos/pagamento/entrega | Marketing + dono do WhatsApp | 28/07–09/08 | ≥ 30 boxes pré-vendidos |
| Catálogo online (página pública + botão WhatsApp) | Dev | 03/08 | página no ar |
| Lançamento: degustação na Steakhouse + bancada + entrega dos primeiros boxes | Gustavo + equipe | 10/08 | vendas do dia registradas |
| Kits degustação B2B: 10 estabelecimentos (Ji-Paraná + 1ª rota regional) | Comercial (designar) | 11–24/08 | ≥ 4 clientes B2B até 30/09 |

## Riscos e mitigação

- **Orientação verbal questionada por fiscal de outro município** → documento escrito até 25/07; enquanto não vier, priorizar Ji-Paraná e capturar leads regionais; manter SIE como plano B no radar (reavaliar em 6 meses).
- **Influenciador com público fora do perfil** → escolher por engajamento local real (comentários de gente da cidade), não por número de seguidores; box com cupom rastreável mede retorno por influenciador.
- **Pré-venda estourar o teto de produção** → 50 boxes máximo; composição do box definida DEPOIS das fichas técnicas (margem e capacidade).
- **Dupla digitação Consumer × sistema** → escopo claro: Consumer = fiscal/PDV; sistema = produção/estoque/comercial B2B; conferência semanal de 15 min até integração futura.

## Indicadores de acompanhamento

Boxes pré-vendidos (≥ 30 até 09/08) — diário na pré-venda · Conversão de influenciadores (cupons rastreados ≥ 15 vendas) — semanal · Assinantes ativos (≥ 25 até 30/09) — semanal · Clientes B2B (≥ 4 até 30/09) — quinzenal · Margem por canal (direta ≥ 50% · box/assinatura ≥ 45% · atacado ≥ 30%) — quinzenal · Receita nova/mês (≥ R$ 9.400 até 16/10) — mensal.

## Dissidências

Ivone (4 SKUs) × marketing (8 SKUs) — **desempate do CEO mantido:** comunicar os 8, produzir com teto por SKU; o Box de lançamento resolve elegantemente a dissidência: a seleção do box concentra a produção nos 4–5 SKUs de melhor margem/giro.

## Premissas declaradas

- Orientação estadual válida por ~1 ano (verbal — documentar); box fundador R$ 139 (ajustar após fichas técnicas); 50 boxes de pré-venda; investimento ~R$ 3.400–4.200 (sem Omie: economia de R$ 200–400/mês; + custo dos boxes de influenciador ~R$ 700).
- Fichas técnicas serão fornecidas pelo usuário (aguardando envio).

## Ajustes do usuário aplicados nesta versão (18/07)

1. Selo: venda estadual liberada pela orientação da Secretaria (convênio em andamento) — SIE deixa de ser bloqueio, vira plano B documentável.
2. ERP: Consumer já atende o fiscal — Omie removido; sistema-364-web priorizado em recebimento, insumos, produção e estoque.
3. Marketing: boxes para influenciadores locais + pré-venda de Box com controle de parceria/divulgação/pedidos incorporados ao plano.

*Anexos: [pesquisa.md](pesquisa.md) · [contribuicoes.md](contribuicoes.md) · [plano-operacional.md](plano-operacional.md) · [analise-financeira.md](analise-financeira.md) · [indicadores.md](indicadores.md) · revisão: [revisao.md](revisao.md) (APROVA 8,4 na v1; v2 = ajustes do usuário)*
