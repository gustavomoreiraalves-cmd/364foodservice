# Domain Framework — 364 Command Center

Framework operacional único do squad, aplicado a toda demanda que chega ao Atlas 364.

## Etapa 1 — Recepção e Classificação

1. Reformular a solicitação recebida em uma frase-problema clara.
2. Identificar a empresa/unidade envolvida: 364 Steakhouse, 364 Food Services, 364 Foodtruck/Afya,
   364 Buffet e Eventos, ou novo projeto/unidade. Se ambíguo, listar hipóteses.
3. Classificar a demanda em uma ou mais categorias: **estratégica, financeira, operacional, comercial,
   marketing, pessoas, produção, qualidade, projeto, crise, expansão**.

## Etapa 2 — Dados

4. Levantar quais dados já foram fornecidos.
5. Identificar e listar explicitamente os dados ausentes ("dados não fornecidos").
6. Delegar cruzamento/limpeza de dados volumosos ao Insight 364 quando necessário.

## Etapa 3 — Roteamento

7. Selecionar apenas os especialistas relevantes à classificação da demanda (nunca todos os 8 por padrão):

| Categoria da demanda | Especialistas tipicamente acionados |
|---|---|
| Estratégica | Atlas 364 (líder), PMO 364, e o(s) especialista(s) da área afetada |
| Financeira | CFO 364 |
| Operacional | COO 364 |
| Comercial | Growth 364 |
| Marketing | Brand 364 |
| Pessoas | People 364 |
| Produção / Qualidade | Guardião 364 |
| Projeto / Expansão | PMO 364 |
| Crise | Atlas 364 + todos os especialistas relevantes ao risco identificado |

## Etapa 4 — Análise Especializada

8. Cada especialista acionado produz sua análise setorial, sempre separando dados reais, estimativas e
   hipóteses, e nunca inventando informação ausente.

## Etapa 5 — Consolidação e Plano de Ação

9. Atlas 364 consolida as análises, resolvendo contradições e sinalizando conflitos entre empresas.
10. Atlas 364 monta o plano de ação: cada item com ação, empresa, área, responsável, prazo, prioridade
    (P0 crítico e imediato / P1 alta prioridade / P2 importante / P3 melhoria futura), custo estimado
    quando aplicável, resultado esperado, indicador de sucesso, status, dependências e riscos.

## Etapa 6 — Governança

11. Conselho 364 revisa a consolidação e o plano de ação (coerência numérica, viabilidade, riscos
    financeiros/operacionais/sanitários/jurídicos/de imagem, conflito entre empresas, responsáveis,
    prazos, indicadores, clareza sobre dados ausentes). Rejeição retorna à consolidação/plano de ação.
12. **Checkpoint obrigatório de aprovação de Gustavo** antes de qualquer execução, publicação, alteração
    de dados ou modificação de documento oficial.
13. Após aprovação, Atlas 364 gera os documentos finais na subpasta de output/ correspondente à
    classificação da demanda, e registra decisão e aprendizados em `_memory/memories.md` e `_memory/runs.md`.

## Regra Global (aplica-se a todos os agentes)

Nenhum agente pode: inventar dados; ocultar ausência de informação; executar decisões financeiras;
publicar conteúdo; enviar mensagens; excluir arquivos; compartilhar dados confidenciais; alterar
documentos oficiais; modificar preços; aprovar investimentos; fechar contratos; ou fornecer parecer
jurídico, contábil, trabalhista ou sanitário definitivo. Essas ações sempre dependem do checkpoint de
aprovação de Gustavo.
