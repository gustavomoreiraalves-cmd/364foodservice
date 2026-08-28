# Ideias de implementação — 364 OS

Caixa de entrada de ideias de melhoria do sistema. Aqui a ideia entra crua, do
jeito que veio à cabeça. Nada aqui é compromisso de implementar.

## Como funciona

1. **Anotar** — a ideia é registrada abaixo, em "Ideias em aberto", com o mínimo:
   título, o que incomoda hoje e o que se espera depois. Sem análise, sem estimativa.
2. **Amadurecer** — quando for o momento, a ideia vira uma spec em
   `docs/superpowers/specs/AAAA-MM-DD-<slug>-design.md` (levantamento de requisitos,
   regras de negócio, telas, schema, riscos).
3. **Planejar** — da spec sai o plano de execução em
   `docs/superpowers/plans/AAAA-MM-DD-<slug>.md`, em fases verificáveis.
4. **Implementar** — o plano é executado, e a ideia sai desta lista para
   "Implementadas", com link para a spec e o plano.

Status possíveis: `aberta` (só anotada), `em análise` (spec sendo escrita),
`planejada` (plano pronto, aguardando execução), `em execução`, `implementada`,
`descartada` (com o motivo).

Campos de cada ideia:

- **Data** — quando a ideia foi anotada.
- **Módulo** — área do sistema afetada (Estoque, Fiscal, Financeiro, Ponto, PDV,
  Produção, Relatórios, Cadastros, Infraestrutura...).
- **Dor** — o que hoje dá trabalho, erra ou não existe.
- **Desejado** — como deveria funcionar.
- **Observações** — qualquer coisa solta: exemplo real, tela, regra fiscal,
  referência de outro sistema.

---

## Ideias em aberto

<!-- Modelo: copiar o bloco abaixo para cada ideia nova.

### IDEIA-000 — Título curto da ideia

- **Data:** AAAA-MM-DD
- **Status:** aberta
- **Módulo:**
- **Dor:**
- **Desejado:**
- **Observações:**

-->

### IDEIA-001 — TV mural para colaboradores ao lado do terminal de ponto

- **Data:** 2026-08-26
- **Status:** aberta
- **Módulo:** Ponto / Comunicação interna
- **Dor:** o colaborador bate o ponto e vai embora para o posto sem nenhuma
  informação do dia. Metas de venda, avisos e datas importantes hoje circulam
  por WhatsApp ou papel no quadro, se é que circulam; ninguém garante que a
  equipe viu. Não existe canal do grupo para a equipe da operação.
- **Desejado:** uma TV fixa ao lado do terminal de registro de ponto, exibindo
  um painel em rotação, sem ninguém precisar operar. Conteúdo pensado para o
  colaborador, não para o gestor:
  - meta de venda (dia e mês) e quanto já foi realizado, com barra de progresso;
  - aniversariantes do mês / do dia, pelo cadastro de funcionários;
  - avisos e recados da gerência, cadastrados no sistema com data de validade;
  - versículo do dia;
  - outras informações que somem no dia a dia (a levantar): escala do dia,
    quem está de folga, cardápio ou prato do dia, tempo/clima, aniversário de
    empresa e tempo de casa, ranking ou reconhecimento da equipe, lembretes de
    segurança e boas práticas de manipulação.
- **Observações:**
  - Público é a equipe inteira, incluindo quem não tem login no sistema. O
    painel fica exposto: não pode mostrar salário, custo, margem, nem dado
    pessoal além de nome e data de aniversário.
  - Não confundir com o `/painel` de gestão já rascunhado em
    [2026-08-24-painel-tela-secundaria-design.md](docs/superpowers/specs/2026-08-24-painel-tela-secundaria-design.md)
    (pausado): aquele é para o gestor, com vendas, despesas, saldo de conta e
    agenda. Este é mural de equipe. Podem compartilhar infraestrutura de
    rotação de telas, mas o conteúdo e a permissão são outros.
  - A TV precisa de uma forma de autenticação que não dependa de alguém logado:
    a definir na spec (token de dispositivo, como já existe em
    `/ponto/dispositivos`, é o candidato natural).
  - Meta de venda depende de onde a meta é cadastrada hoje — verificar na
    análise se já existe cadastro de meta por unidade/mês ou se precisa nascer.
  - Versículo do dia: decidir entre fonte externa (API), lista carregada no
    banco ou cadastro manual. Sem internet no local, o painel precisa continuar
    exibindo algo.


---

## Em análise / planejadas

_Vazio._

---

## Implementadas

_Vazio._

---

## Descartadas

_Vazio._
