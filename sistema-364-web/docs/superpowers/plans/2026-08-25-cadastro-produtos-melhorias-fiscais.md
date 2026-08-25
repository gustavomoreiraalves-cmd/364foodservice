# Cadastro de Produtos — Melhorias pontuais (custo, fiscal, UX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aplicar as 6 melhorias confirmadas no cadastro de produtos (fonte única de custo, cabeçalho persistente, botão Salvar único, duplicar produto, copiar configuração fiscal, barra gráfica de custo na ficha técnica), sem tocar em Estoque/Perguntas/Complementos/Descrição/Imagem/Taxa de serviço/Código PDV (cortados) e sem construir IBS/CBS agora (adiado para perto de 04/01/2027).

**Architecture:** Tudo em `app/produtos/page.js` (client component, Supabase direto, sem camada de API — confirmado, não existe `app/api/produtos/*`) e nos componentes que ele já usa (`components/ProdutoFiscal.js`). Uma migration nova (`atualizacao_38`) adiciona só `updated_at`/`atualizado_por_id` em `produtos`, reaproveitando a função de trigger `public.fn_set_updated_at()` já usada em outras tabelas.

**Tech Stack:** Next.js (client component), Supabase JS client, Postgres/RLS (Supabase), sem framework de teste de componente — verificação por browser (dev server) já é o padrão do projeto para esta tela.

**Spec:** `docs/superpowers/specs/2026-08-25-cadastro-produtos-melhorias-fiscais.md`

## Global Constraints

- Não criar aba Estoque, Perguntas, Complementos, nem campos Descrição/Imagem/Taxa de serviço/Código PDV — cortados pelo usuário.
- Não construir estrutura IBS/CBS agora — adiado, colunas já reservadas ficam intocadas.
- Não remover `produtos.sujeito_st` nem qualquer coluna fiscal existente sem checar uso em `lib/fiscal.js` (`pendenciasFiscaisProduto`) e na emissão de NF-e.
- Migration só roda em produção com aprovação explícita do usuário (Supabase de produção, acesso psql já disponível só para leitura livre — escrita pede ok).
- Sem camada de API: toda mudança é Supabase client direto em `app/produtos/page.js`/componentes, seguindo o padrão já existente.
- Reaproveitar padrões já estabelecidos: `camposDoFormulario` (`lib/cadastro.js`), `fn_set_updated_at()` (trigger), estilo de modal inline já usado (não introduzir `FichaModal`/`ListaCadastro` aqui — está fora de escopo trocar esse padrão nesta tarefa).

---

### Task 1: Migration — `updated_at` e `atualizado_por_id` em `produtos`

**Files:**
- Create: `supabase/atualizacao_38_cabecalho_produto.sql`

**Interfaces:**
- Produces: colunas `produtos.updated_at timestamptz`, `produtos.atualizado_por_id uuid` — consumidas pela Task 3 (cabeçalho) e pela Task 2 (grava `atualizado_por_id` a cada save).

- [ ] **Step 1: Escrever a migration**

```sql
-- =========================================================
-- 38 — CABEÇALHO DO PRODUTO: rastro de última alteração
-- produtos não tinha updated_at (só tem revisado_em/revisado_por_id, que são
-- específicos da liberação fiscal). O cabeçalho persistente do cadastro
-- precisa saber quando e quem alterou qualquer campo do produto.
-- =========================================================

alter table public.produtos add column if not exists updated_at timestamptz not null default now();
alter table public.produtos add column if not exists atualizado_por_id uuid references auth.users(id);
comment on column public.produtos.atualizado_por_id is
  'Quem fez o último UPDATE em produtos — igual ao padrão de revisado_por_id, mas para qualquer alteração, não só liberação fiscal. Preenchido pela aplicação a cada salvarProduto, não por trigger (o trigger não tem acesso ao usuário autenticado de forma simples aqui).';

drop trigger if exists trg_produtos_updated_at on public.produtos;
create trigger trg_produtos_updated_at before update on public.produtos
  for each row execute function public.fn_set_updated_at();
```

- [ ] **Step 2: Rodar contra o banco de desenvolvimento/local primeiro (nunca direto em produção)**

Confirmar com o usuário antes de aplicar em produção — seguir o mesmo processo já usado nas migrations 35-37 (aplicar, depois `\d produtos` via psql pra confirmar as colunas).

- [ ] **Step 3: Commit**

```bash
git add supabase/atualizacao_38_cabecalho_produto.sql
git commit -m "feat(produtos): coluna de rastro de última alteração para o cabeçalho do cadastro"
```

---

### Task 2: Formulário único + rodapé de ações fixo (Salvar/Cancelar/Duplicar/Excluir em qualquer aba)

Pré-requisito para as Tasks 3, 6 e 7 — o cabeçalho e os novos botões (Duplicar) vivem nesse rodapé único.

**Files:**
- Modify: `app/produtos/page.js:280-287` (`salvarCusto` — sem mudança de assinatura aqui, só referenciado)
- Modify: `app/produtos/page.js:289-309` (`addItemFicha` — remove dependência de evento de formulário)
- Modify: `app/produtos/page.js:421-583` (bloco do modal `fichaAberta`)
- Modify: `app/produtos/page.js:609-719` (`FichaTecnica` — remove `<form>` interno de "Adicionar")

**Interfaces:**
- Consumes: `salvarProduto(e)` já existente (linha 198), `fiscalDisponivel`, `produtoSelecionado`, `alternarAtivo`, `excluir`.
- Produces: `addItemFicha(produtoId)` (sem parâmetro de evento — assinatura muda, ver Step 2) — a Task 7 e 8 não dependem disso, mas qualquer código futuro que chame `addItemFicha` deve passar só `produtoId`.

- [ ] **Step 1: Remover o `<form>` aninhado de "Adicionar" na Ficha Técnica**

Em `app/produtos/page.js`, dentro de `FichaTecnica` (por volta da linha 649), trocar:

```jsx
      <form className="form-grid" style={{ marginTop: 12 }} onSubmit={onAdicionar}>
        <div>
          <label htmlFor="ft-mp">Matéria-prima</label>
          <select id="ft-mp" value={item.materia_prima_id}
                  onChange={e => setItem({ ...item, materia_prima_id: e.target.value })}>
            <option value="">Selecione…</option>
            {mps.filter(m => m.ativo !== false || m.id === item.materia_prima_id)
              .map(m => <option key={m.id} value={m.id}>{m.nome} ({m.unidade})</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ft-qtd">Quantidade por unidade</label>
          <input id="ft-qtd" type="number" step="0.001" required value={item.quantidade}
                 onChange={e => setItem({ ...item, quantidade: e.target.value })} />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="btn secondary" type="submit">Adicionar</button>
        </div>
      </form>
```

por (mesma estrutura visual, `div` no lugar de `form`, botão vira `type="button"` chamando `onAdicionar` direto — sem `<form>` aninhado dentro do `<form>` único do modal):

```jsx
      <div className="form-grid" style={{ marginTop: 12 }}>
        <div>
          <label htmlFor="ft-mp">Matéria-prima</label>
          <select id="ft-mp" value={item.materia_prima_id}
                  onChange={e => setItem({ ...item, materia_prima_id: e.target.value })}>
            <option value="">Selecione…</option>
            {mps.filter(m => m.ativo !== false || m.id === item.materia_prima_id)
              .map(m => <option key={m.id} value={m.id}>{m.nome} ({m.unidade})</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ft-qtd">Quantidade por unidade</label>
          <input id="ft-qtd" type="number" step="0.001" required value={item.quantidade}
                 onChange={e => setItem({ ...item, quantidade: e.target.value })} />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="btn secondary" type="button" onClick={onAdicionar}>Adicionar</button>
        </div>
      </div>
```

- [ ] **Step 2: Tirar a dependência de evento em `addItemFicha`**

Em `app/produtos/page.js:289-309`, trocar a assinatura e a validação:

```jsx
  async function addItemFicha(produtoId) {
    const item = itemFicha[produtoId] || {};
    if (!item.materia_prima_id) {
      alert(mps.some(m => m.ativo !== false)
        ? 'Selecione a matéria-prima antes de adicionar o item à ficha técnica.'
        : 'Nenhuma matéria-prima ativa para escolher. Cadastre uma em Matérias-primas, '
          + 'ou reative uma que tenha sido desativada, antes de montar a ficha técnica.');
      return;
    }
    if (!item.quantidade) { alert('Informe a quantidade de matéria-prima por unidade produzida.'); return; }
    const { error } = await supabase.from('ficha_tecnica').insert([{
      produto_id: produtoId,
      materia_prima_id: item.materia_prima_id,
      quantidade: Number(item.quantidade),
      empresa_id: empresaAtual.id,
    }]);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    setItemFicha({ ...itemFicha, [produtoId]: { materia_prima_id: item.materia_prima_id, quantidade: '' } });
    carregar();
  }
```

E onde `FichaTecnica` é montada (linha ~564), trocar `onAdicionar={e => addItemFicha(e, selecionado)}` por `onAdicionar={() => addItemFicha(selecionado)}`.

- [ ] **Step 3: Substituir o bloco do modal (linhas 421-583) por um único `<form>` com rodapé fixo**

```jsx
      {fichaAberta && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) fechar(); }}>
          <div className="modal-box wide" role="dialog" aria-modal="true" aria-labelledby="ficha-titulo">
            <div className="modal-head">
              <div>
                <h3 id="ficha-titulo">{produtoSelecionado ? produtoSelecionado.nome : 'Novo produto'}</h3>
                {produtoSelecionado && <CabecalhoProduto produto={produtoSelecionado} usuarios={usuarios} />}
              </div>
              <button className="btn secondary small" type="button" onClick={fechar} aria-label="Fechar ficha">
                <Icone nome="fechar" tamanho={14} />
              </button>
            </div>

            <div className="tabs" role="tablist" style={{ padding: '0 20px', marginBottom: 0 }}>
              <button role="tab" type="button" className="tab" aria-selected={aba === 'geral'}
                      onClick={() => setAba('geral')}>Geral</button>
              <button role="tab" type="button" className="tab" aria-selected={aba === 'fiscal'}
                      onClick={() => setAba('fiscal')}>
                Fiscal
                {fiscalDisponivel && (pendencias.length
                  ? <span className="contador">{pendencias.length}</span>
                  : <span className="contador ok"><Icone nome="conferido" tamanho={10} /></span>)}
              </button>
              <button role="tab" type="button" className="tab" aria-selected={aba === 'ficha'}
                      onClick={() => setAba('ficha')} disabled={!produtoSelecionado}>
                Ficha técnica
                {produtoSelecionado && (
                  <span className="contador ok">{fichas.filter(f => f.produto_id === selecionado).length}</span>
                )}
              </button>
            </div>

            <form onSubmit={salvarProduto}>
              <div className="modal-body">
                {aba === 'geral' && (
                  <div className="form-grid">
                    <div className="secao">Identificação</div>
                    <div className="largo">
                      <label htmlFor="p-nome">Nome</label>
                      <input id="p-nome" required autoFocus value={formProd.nome}
                             onChange={e => setFormProd({ ...formProd, nome: e.target.value })} />
                    </div>
                    <div>
                      <label htmlFor="p-cat">Categoria</label>
                      <input id="p-cat" placeholder="Defumado, Embutido…" value={formProd.categoria}
                             onChange={e => setFormProd({ ...formProd, categoria: e.target.value })} />
                    </div>
                    <div>
                      <label htmlFor="p-un">Unidade de venda</label>
                      <select id="p-un" value={formProd.unidade}
                              onChange={e => setFormProd({ ...formProd, unidade: e.target.value })}>
                        <option value="un">un</option><option value="kg">kg</option><option value="pct">pacote</option>
                      </select>
                    </div>

                    <div className="secao">Custo e preço</div>
                    <div>
                      <label htmlFor="p-custo">Custo unitário (R$)</label>
                      <input id="p-custo" type="number" step="0.01" placeholder="0,00" value={formProd.custo_unitario}
                             onChange={e => setFormProd({ ...formProd, custo_unitario: e.target.value })} />
                      <p className="ajuda">Em branco, o sistema usa o custo da ficha técnica no cálculo de CMV.</p>
                    </div>
                    <div>
                      <label htmlFor="p-preco">Preço de venda (R$)</label>
                      <input id="p-preco" type="number" step="0.01" required value={formProd.preco_venda}
                             onChange={e => setFormProd({ ...formProd, preco_venda: e.target.value })} />
                    </div>
                    <div>
                      <label htmlFor="p-val">Validade (dias)</label>
                      <input id="p-val" type="number" value={formProd.validade_dias}
                             onChange={e => setFormProd({ ...formProd, validade_dias: e.target.value })} />
                    </div>

                    <div className="secao">Produção</div>
                    <div className="largo">
                      <label className="check-line">
                        <input type="checkbox" checked={formProd.producao_interna}
                               onChange={e => setFormProd({ ...formProd, producao_interna: e.target.checked })} />
                        Produto de produção interna
                      </label>
                    </div>
                    <div className="largo">
                      <label className="check-line">
                        <input type="checkbox" checked={formProd.rastreado}
                               onChange={e => setFormProd({ ...formProd, rastreado: e.target.checked })} />
                        Produto rastreado
                      </label>
                      <p className="ajuda">
                        Marcado, entra no estoque só pela ficha de embalagem — a Produção Completa recusa lançá-lo.
                      </p>
                    </div>
                  </div>
                )}

                {aba === 'fiscal' && (
                  <ProdutoFiscal form={formProd} setForm={setFormProd} tabelas={tabelasFiscais}
                                 disponivel={fiscalDisponivel} editando={!!produtoSelecionado}
                                 onLiberar={liberarParaEmissao}
                                 naturezas={naturezas} regras={regrasTributarias}
                                 produtos={produtos} produtoAtualId={selecionado}
                                 onAbrirConfiguracao={grupoId => setConfigAberta({ grupoId })} />
                )}

                {aba === 'ficha' && produtoSelecionado && (
                  <FichaTecnica
                    produto={produtoSelecionado}
                    itens={fichas.filter(f => f.produto_id === selecionado)}
                    mps={mps}
                    custoTeorico={custoTeorico(selecionado)}
                    item={itemFicha[selecionado] || { materia_prima_id: mps.find(m => m.ativo !== false)?.id || '', quantidade: '' }}
                    setItem={novo => setItemFicha({ ...itemFicha, [selecionado]: novo })}
                    onAdicionar={() => addItemFicha(selecionado)}
                    onRemover={delItemFicha}
                    regras={CONSERVACOES.map(c => ({ ...c, atual: regraDe(selecionado, c.id) }))}
                    regraForm={regraForm}
                    setRegraForm={setRegraForm}
                    onSalvarRegra={conservacao => salvarRegra(selecionado, conservacao)}
                  />
                )}
              </div>

              <div className="modal-foot">
                {produtoSelecionado && (
                  <>
                    <button className="btn secondary small" type="button" onClick={() => setDuplicarAberto(true)}>
                      <Icone nome="copiar" tamanho={13} /> Duplicar
                    </button>
                    <button className="btn secondary small" type="button"
                            onClick={() => alternarAtivo(produtoSelecionado)}>
                      {produtoSelecionado.ativo === false ? 'Reativar' : 'Desativar'}
                    </button>
                    <button className="btn danger" type="button" onClick={() => excluir(produtoSelecionado.id)}>
                      <Icone nome="lixeira" tamanho={13} /> Excluir
                    </button>
                  </>
                )}
                <button className="btn secondary" type="button" style={{ marginLeft: 'auto' }} onClick={fechar}>
                  Cancelar
                </button>
                <button className="btn" type="submit" disabled={salvando}>
                  {salvando ? 'Salvando…' : (produtoSelecionado ? 'Salvar alterações' : 'Criar produto')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
```

Nota: `CabecalhoProduto` e as props novas de `ProdutoFiscal` (`produtos`, `produtoAtualId`) e `duplicarAberto`/`setDuplicarAberto` só existem depois das Tasks 3 e 7 — ao aplicar esta task isoladamente, comente essas duas referências (`<CabecalhoProduto .../>` e o botão Duplicar) ou aplique as Tasks 2, 3 e 7 na mesma sessão antes de rodar a verificação do Step 4.

- [ ] **Step 4: Verificar manualmente no browser**

Rodar o dev server (`preview_start` com o app), abrir `/produtos`, testar:
1. Editar um produto existente, trocar de aba Geral → Fiscal → Ficha técnica → Geral, mudar o nome, clicar Salvar estando na aba Ficha técnica — confirma que salva o nome.
2. Adicionar item na Ficha técnica — confirma que ainda funciona sem `<form>` aninhado (checar console sem warning de form aninhado).
3. Confirma que Cancelar/Salvar aparecem em qualquer aba, sempre no mesmo lugar.
4. Confirma que Desativar/Excluir só aparecem com produto existente selecionado (não em "Novo produto").

- [ ] **Step 5: Commit**

```bash
git add app/produtos/page.js
git commit -m "refactor(produtos): formulário único com rodapé de ações fixo em todas as abas"
```

---

### Task 3: Cabeçalho persistente do produto

**Files:**
- Modify: `app/produtos/page.js` (novo componente `CabecalhoProduto`, chamado dentro do `modal-head` da Task 2)
- Modify: `app/produtos/page.js:198-243` (`salvarProduto` — grava `atualizado_por_id`)
- Create: nenhum arquivo novo — componente pequeno o bastante para viver no mesmo arquivo, junto de `FichaTecnica`.

**Interfaces:**
- Consumes: `produtos.updated_at`, `produtos.atualizado_por_id` (Task 1).
- Produces: nada consumido por outras tasks.

- [ ] **Step 1: Buscar nome de usuário para exibir no cabeçalho**

O nome de exibição não vem de RPC/API (essas exigem service role, só existem em `app/api/usuarios/route.js`, rota server-side). Do client, a fonte é a tabela `funcionarios` (`user_id`, `nome`), já usada com esse propósito em `app/api/usuarios/route.js:72,98` (fallback: primeiro funcionário ativo daquele `user_id`).

Em `app/produtos/page.js`, perto do topo de `Conteudo()` (linha ~90, junto dos outros `useState`), adicionar:

```jsx
  const [usuarios, setUsuarios] = useState({});
```

E dentro de `carregar()` (linha 102-117), acrescentar ao `Promise.all`:

```jsx
      supabase.from('funcionarios').select('user_id, nome').eq('empresa_id', empresaAtual.id).eq('ativo', true),
```

E depois do `Promise.all`, junto dos outros `set...(rX.data || [])`:

```jsx
    const mapaUsuarios = {};
    for (const f of (r5.data || [])) mapaUsuarios[f.user_id] = f.nome;
    setUsuarios(mapaUsuarios);
```

(renomear `r5` para o índice correto de acordo com a posição da nova consulta no array desestruturado `[r1, r2, r3, r4]` → `[r1, r2, r3, r4, r5]`).

- [ ] **Step 2: Criar o componente `CabecalhoProduto`**

Logo antes de `function FichaTecnica(...)` (linha 609):

```jsx
function fmtDataHora(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function CabecalhoProduto({ produto, usuarios }) {
  const nomeUsuario = produto.atualizado_por_id ? usuarios[produto.atualizado_por_id] : null;
  return (
    <span className="muted mono" style={{ fontSize: 11.5, display: 'block' }}>
      #{produto.codigo} · {produto.ativo === false ? 'Inativo' : 'Ativo'}
      {produto.updated_at && (
        <> · Última alteração: {fmtDataHora(produto.updated_at)}{nomeUsuario ? ' por ' + nomeUsuario : ''}</>
      )}
    </span>
  );
}
```

- [ ] **Step 3: Gravar `atualizado_por_id` a cada salvamento**

Em `salvarProduto` (linha 198-243), antes de montar `campos`, buscar a sessão (já existe padrão idêntico em `liberarParaEmissao`, linha 251):

```jsx
    const { data: sessao } = await supabase.auth.getUser();
```

E acrescentar ao objeto `campos` (linha 206-220): `atualizado_por_id: sessao?.user?.id || null,`.

- [ ] **Step 4: Verificar manualmente no browser**

Editar um produto, salvar, reabrir a ficha — confirma que o cabeçalho mostra "Última alteração: DD/MM/AAAA HH:MM" atualizado. Criar produto novo — confirma que não quebra (produto sem `updated_at` anterior ainda mostra o valor do `default now()` da migration).

- [ ] **Step 5: Commit**

```bash
git add app/produtos/page.js
git commit -m "feat(produtos): cabeçalho persistente com status e última alteração"
```

---

### Task 4: Um único ponto de edição de custo

**Files:**
- Modify: `app/produtos/page.js:609-719` (`FichaTecnica`)
- Modify: `app/produtos/page.js` (remoção do prop `onEditarCusto` na chamada de `FichaTecnica`, Task 2 Step 3 já não o inclui — confirmar que não sobrou referência)

**Interfaces:**
- Consumes: nenhuma nova.
- Produces: `FichaTecnica` perde o prop `onEditarCusto` — checar que nenhuma outra chamada do componente ainda o passa.

- [ ] **Step 1: Trocar o banner "Custo em uso" de editável para somente leitura**

Em `FichaTecnica` (linha 669-675), trocar:

```jsx
      <div className="banner info" style={{ marginTop: 16 }}>
        Custo em uso: <b>{fmtMoney(custoCadastrado ? Number(produto.custo_unitario) : custoTeorico)}</b>{' '}
        {custoCadastrado ? '(cadastrado na mão)' : '(calculado pela ficha)'}
        <button className="btn secondary small" type="button" style={{ marginLeft: 10 }} onClick={onEditarCusto}>
          <Icone nome="lapis" tamanho={13} /> Editar custo
        </button>
      </div>
```

por:

```jsx
      <div className="banner info" style={{ marginTop: 16 }}>
        Custo em uso: <b>{fmtMoney(custoCadastrado ? Number(produto.custo_unitario) : custoTeorico)}</b>{' '}
        {custoCadastrado ? '(cadastrado na mão, aba Geral)' : '(calculado pela ficha técnica)'}
        <p className="ajuda" style={{ marginTop: 4 }}>
          Para usar o custo calculado pela ficha em vez do valor da aba Geral, apague o campo
          "Custo unitário" na aba Geral e salve.
        </p>
      </div>
```

- [ ] **Step 2: Remover a assinatura `onEditarCusto` da função `FichaTecnica`**

Linha 610, trocar:

```jsx
function FichaTecnica({
  produto, itens, mps, custoTeorico, item, setItem, onAdicionar, onRemover, onEditarCusto,
  regras, regraForm, setRegraForm, onSalvarRegra,
}) {
```

por:

```jsx
function FichaTecnica({
  produto, itens, mps, custoTeorico, item, setItem, onAdicionar, onRemover,
  regras, regraForm, setRegraForm, onSalvarRegra,
}) {
```

(A Task 2 Step 3 já monta `<FichaTecnica>` sem passar `onEditarCusto` — se a Task 2 ainda não tiver sido aplicada, também remover a prop de lá.)

- [ ] **Step 3: `salvarCusto` fica sem uso — decidir manter ou remover**

`salvarCusto` (linha 280-287) só era chamado pelo botão removido. Como nenhuma outra chamada existe (`grep -n "salvarCusto" app/produtos/page.js` deve mostrar só a definição depois deste step), remover a função inteira.

- [ ] **Step 4: Verificar manualmente no browser**

Abrir um produto com ficha técnica e custo manual preenchido — banner mostra "(cadastrado na mão, aba Geral)", sem botão de editar. Apagar o custo manual na aba Geral, salvar, voltar na Ficha técnica — banner passa a mostrar "(calculado pela ficha técnica)".

- [ ] **Step 5: Commit**

```bash
git add app/produtos/page.js
git commit -m "fix(produtos): custo unitário edita só na aba Geral, ficha técnica fica só leitura"
```

---

### Task 5: Texto do `sujeito_st` mais claro

**Files:**
- Modify: `components/ProdutoFiscal.js:99-108`

**Interfaces:** nenhuma — mudança só de texto.

- [ ] **Step 1: Reforçar o rótulo e o texto de ajuda**

Em `components/ProdutoFiscal.js`, trocar (linhas 99-108):

```jsx
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.sujeito_st}
                   onChange={e => set({ sujeito_st: e.target.checked })} />
            Sujeito a substituição tributária
          </label>
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
            Marque conforme a orientação do contador. Quem decide se há retenção nesta nota é o grupo tributário.
          </p>
        </div>
```

por:

```jsx
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.sujeito_st}
                   onChange={e => set({ sujeito_st: e.target.checked })} />
            Sujeito a substituição tributária (indicativo de cadastro)
          </label>
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
            Marque conforme a orientação do contador — exige CEST preenchido. Este campo não decide
            a retenção: quem resolve se há ST nesta nota é a regra tributária do grupo fiscal,
            configurada na aba Tributação abaixo.
          </p>
        </div>
```

- [ ] **Step 2: Verificar manualmente no browser**

Abrir aba Fiscal de um produto — texto novo aparece, checkbox continua funcionando (marcar exige CEST, conforme `pendenciasFiscaisProduto`).

- [ ] **Step 3: Commit**

```bash
git add components/ProdutoFiscal.js
git commit -m "fix(produtos): deixa claro que sujeito_st é indicativo, não decide a retenção"
```

---

### Task 6: Barra gráfica de % de custo na Ficha Técnica

**Files:**
- Modify: `app/produtos/page.js:620-642` (lista de itens da `FichaTecnica`)
- Modify: `app/globals.css` (classe nova `.barra-custo`)

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Adicionar a barra visual ao lado do percentual**

Em `FichaTecnica` (linha 626-641), trocar:

```jsx
            return (
              <div className="item-line" key={f.id}>
                <span>{f.materias_primas?.nome || '—'}</span>
                <span className="num" style={{ minWidth: 76 }}>
                  {Number(f.quantidade)} {f.materias_primas?.unidade || ''}
                </span>
                <span className="num" style={{ minWidth: 76 }}>{fmtMoney(custo)}</span>
                <span className="muted mono" style={{ minWidth: 42, textAlign: 'right', fontSize: 11.5 }}>
                  {fatia.toFixed(0)}%
                </span>
                <button className="btn danger" type="button" onClick={() => onRemover(f.id)}
                        aria-label="Remover item da ficha">
                  <Icone nome="lixeira" tamanho={13} />
                </button>
              </div>
            );
```

por:

```jsx
            return (
              <div className="item-line" key={f.id}>
                <span>{f.materias_primas?.nome || '—'}</span>
                <span className="num" style={{ minWidth: 76 }}>
                  {Number(f.quantidade)} {f.materias_primas?.unidade || ''}
                </span>
                <span className="num" style={{ minWidth: 76 }}>{fmtMoney(custo)}</span>
                <span className="barra-custo" style={{ minWidth: 60 }} aria-hidden="true">
                  <span className="barra-custo-preenchida" style={{ width: `${Math.min(fatia, 100)}%` }} />
                </span>
                <span className="muted mono" style={{ minWidth: 36, textAlign: 'right', fontSize: 11.5 }}>
                  {fatia.toFixed(0)}%
                </span>
                <button className="btn danger" type="button" onClick={() => onRemover(f.id)}
                        aria-label="Remover item da ficha">
                  <Icone nome="lixeira" tamanho={13} />
                </button>
              </div>
            );
```

- [ ] **Step 2: Estilo da barra em `app/globals.css`**

Adicionar (perto de outras classes de `.item-line`/`.num` já existentes — checar convenção de cor de destaque usada no design system, ex. `--cor-destaque` ou equivalente do PlanIQ, documentado em `DESIGN.md`):

```css
.barra-custo {
  display: inline-block;
  height: 6px;
  border-radius: 3px;
  background: var(--border);
  overflow: hidden;
}
.barra-custo-preenchida {
  display: block;
  height: 100%;
  background: var(--accent);
  border-radius: 3px;
}
```

Tokens confirmados em `app/globals.css:82` (`--border`) e `app/globals.css:36` (`--accent`, o menta do design system PlanIQ).

- [ ] **Step 3: Verificar manualmente no browser**

Abrir ficha técnica com 3+ insumos de custo bem diferentes — confirma que as barras são proporcionais e que a soma visual bate com o `%` numérico ao lado.

- [ ] **Step 4: Commit**

```bash
git add app/produtos/page.js app/globals.css
git commit -m "feat(produtos): barra gráfica de % de custo por insumo na ficha técnica"
```

---

### Task 7: Duplicar produto (diálogo seletivo)

**Files:**
- Modify: `app/produtos/page.js` (novo state, nova função `duplicar`, novo modal `DuplicarProdutoModal`)
- Test: `tests/duplicar-produto.test.mjs` (função pura extraída, ver Step 1)

**Interfaces:**
- Consumes: `PROD_VAZIO`, `PROD_FISCAL_VAZIO`, `camposDoFormulario` (já existentes).
- Produces: `camposParaDuplicar(origem, opcoes)` — função pura, testável, usada por `duplicar()`.

- [ ] **Step 1: Extrair e testar a função pura que decide os campos copiados**

Criar em `lib/cadastro.js` (mesmo arquivo de `camposDoFormulario`, já importado em `app/produtos/page.js`):

```js
// Usado por "Duplicar produto": monta o formulário do produto novo a partir
// de um produto existente, respeitando o que o usuário marcou pra copiar.
// Nunca copia id/codigo/created_at/ativo_fiscal/sugerido_automaticamente/
// revisado_em/revisado_por_id/updated_at/atualizado_por_id — são específicos
// do registro original, não fazem sentido num clone.
export function camposParaDuplicar(origem, formVazio, camposFiscaisChaves, opcoes) {
  const base = camposDoFormulario(origem, formVazio);
  if (!opcoes.fiscal) {
    for (const chave of camposFiscaisChaves) base[chave] = formVazio[chave];
  }
  return base;
}
```

- [ ] **Step 2: Escrever o teste antes de usar em produção**

Criar `tests/duplicar-produto.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { camposParaDuplicar } from '../lib/cadastro.js';

const FORM_VAZIO = { nome: '', categoria: '', ncm: '', cest: '' };
const CAMPOS_FISCAIS = ['ncm', 'cest'];

test('copia todos os campos quando fiscal está marcado', () => {
  const origem = { nome: 'Pantaneiro', categoria: 'Hambúrguer', ncm: '16025000', cest: '1708300' };
  const resultado = camposParaDuplicar(origem, FORM_VAZIO, CAMPOS_FISCAIS, { fiscal: true });
  assert.equal(resultado.ncm, '16025000');
  assert.equal(resultado.cest, '1708300');
  assert.equal(resultado.nome, 'Pantaneiro');
});

test('zera os campos fiscais quando fiscal não está marcado', () => {
  const origem = { nome: 'Pantaneiro', categoria: 'Hambúrguer', ncm: '16025000', cest: '1708300' };
  const resultado = camposParaDuplicar(origem, FORM_VAZIO, CAMPOS_FISCAIS, { fiscal: false });
  assert.equal(resultado.ncm, '');
  assert.equal(resultado.cest, '');
  assert.equal(resultado.nome, 'Pantaneiro');
});
```

- [ ] **Step 3: Rodar o teste e confirmar que passa**

Run: `node --test tests/duplicar-produto.test.mjs`
Expected: 2 passing.

- [ ] **Step 4: Estado e handlers em `app/produtos/page.js`**

Junto dos outros `useState` (linha ~93):

```jsx
  const [duplicarAberto, setDuplicarAberto] = useState(false);
  const [duplicarFichaDe, setDuplicarFichaDe] = useState(null);
```

Função nova, perto de `abrirNovo` (linha 185-190):

```jsx
  function duplicar(origem, opcoes) {
    const vazio = { ...PROD_VAZIO, ...PROD_FISCAL_VAZIO };
    const campos = camposParaDuplicar(origem, vazio, Object.keys(PROD_FISCAL_VAZIO), opcoes);
    setFormProd(campos);
    setSelecionado(null);
    setCriando(true);
    setAba('geral');
    setDuplicarFichaDe(opcoes.ficha ? origem.id : null);
    setDuplicarAberto(false);
  }
```

Import no topo do arquivo: `import { camposDoFormulario, mensagemAoAlternarAtivo, camposParaDuplicar } from '../../lib/cadastro';`

- [ ] **Step 5: Copiar a ficha técnica depois que o produto novo é criado**

Em `salvarProduto` (linha 236-239), depois de `await carregar()`:

```jsx
      await carregar();
      if (novoId && duplicarFichaDe) {
        const origemItens = fichas.filter(f => f.produto_id === duplicarFichaDe);
        if (origemItens.length) {
          await supabase.from('ficha_tecnica').insert(
            origemItens.map(f => ({
              produto_id: novoId,
              materia_prima_id: f.materia_prima_id,
              quantidade: f.quantidade,
              empresa_id: empresaAtual.id,
            }))
          );
          await carregar();
        }
        setDuplicarFichaDe(null);
      }
      if (novoId) { setSelecionado(novoId); setCriando(false); }
```

- [ ] **Step 6: Modal de escolha "O que deseja copiar?"**

Perto de `FichaTecnica` (linha ~609), novo componente:

```jsx
function DuplicarProdutoModal({ produto, onFechar, onConfirmar }) {
  const [fiscal, setFiscal] = useState(true);
  const [ficha, setFicha] = useState(true);
  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onFechar(); }}>
      <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="duplicar-titulo">
        <div className="modal-head">
          <h3 id="duplicar-titulo">Duplicar "{produto.nome}"</h3>
          <button className="btn secondary small" type="button" onClick={onFechar} aria-label="Fechar">
            <Icone nome="fechar" tamanho={14} />
          </button>
        </div>
        <div className="modal-body">
          <p className="ajuda" style={{ marginTop: 0 }}>Informações principais são sempre copiadas.</p>
          <label className="check-line">
            <input type="checkbox" checked={fiscal} onChange={e => setFiscal(e.target.checked)} />
            Configuração fiscal
          </label>
          <label className="check-line">
            <input type="checkbox" checked={ficha} onChange={e => setFicha(e.target.checked)} />
            Ficha técnica
          </label>
        </div>
        <div className="modal-foot">
          <button className="btn secondary" type="button" onClick={onFechar}>Cancelar</button>
          <button className="btn" type="button" onClick={() => onConfirmar({ fiscal, ficha })}>Duplicar</button>
        </div>
      </div>
    </div>
  );
}
```

Import `useState` já existe no topo do arquivo (linha 2).

- [ ] **Step 7: Montar o modal no JSX principal**

Depois do bloco `{configAberta && (...)}` (linha ~585 em diante, já modificado pela Task 2):

```jsx
      {duplicarAberto && produtoSelecionado && (
        <DuplicarProdutoModal
          produto={produtoSelecionado}
          onFechar={() => setDuplicarAberto(false)}
          onConfirmar={opcoes => duplicar(produtoSelecionado, opcoes)}
        />
      )}
```

(O botão "Duplicar" que abre este modal já foi adicionado no rodapé fixo pela Task 2 Step 3.)

- [ ] **Step 8: Verificar manualmente no browser**

Abrir um produto com ficha técnica e dados fiscais, clicar Duplicar, desmarcar "Ficha técnica", confirmar — modal fecha, abre "Novo produto" com Principal+Fiscal preenchidos e Ficha técnica vazia. Clicar Criar produto — confirma que salva como produto novo (código novo, não sobrescreve o original). Repetir marcando Ficha técnica — confirma que os itens aparecem copiados após salvar.

- [ ] **Step 9: Commit**

```bash
git add app/produtos/page.js lib/cadastro.js tests/duplicar-produto.test.mjs
git commit -m "feat(produtos): duplicar produto com diálogo seletivo (fiscal/ficha técnica)"
```

---

### Task 8: Copiar configuração fiscal de outro produto

**Files:**
- Modify: `components/ProdutoFiscal.js` (novo bloco de busca dentro da seção "Tributação")
- Modify: `app/produtos/page.js` (passa `produtos`/`produtoAtualId` para `ProdutoFiscal` — já incluído na Task 2 Step 3)

**Interfaces:**
- Consumes: lista `produtos` completa (já carregada em `Conteudo()`), `PROD_FISCAL_VAZIO`'s chaves (para saber quais campos são "fiscais").

- [ ] **Step 1: Adicionar busca de produto de referência em `ProdutoFiscal.js`**

Em `components/ProdutoFiscal.js`, dentro da seção "Tributação" (por volta da linha 185-227, antes do fechamento da seção), adicionar:

```jsx
      <div className="secao">Copiar de outro produto</div>
      <div className="largo">
        <input
          placeholder="Buscar produto de referência por nome ou código…"
          value={buscaCopia}
          onChange={e => setBuscaCopia(e.target.value)}
        />
        {buscaCopia.trim() && (
          <ul className="lista-sugestoes">
            {(produtos || [])
              .filter(p => p.id !== produtoAtualId)
              .filter(p => p.nome.toLowerCase().includes(buscaCopia.toLowerCase())
                || (p.codigo || '').toLowerCase().includes(buscaCopia.toLowerCase()))
              .slice(0, 8)
              .map(p => (
                <li key={p.id}>
                  <button type="button" className="btn secondary small"
                          onClick={() => setProdutoParaCopiar(p)}>
                    {p.codigo} — {p.nome}
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
```

- [ ] **Step 2: Estado local e confirmação antes de aplicar**

No topo de `ProdutoFiscal` (linha 17-19), acrescentar:

```jsx
export default function ProdutoFiscal({ form, setForm, tabelas, disponivel, editando, onLiberar, naturezas = [], regras = [], onAbrirConfiguracao, produtos = [], produtoAtualId = null }) {
  const set = campos => setForm({ ...form, ...campos });
  const { ncms = [], cests = [], unidades = [], grupos = [] } = tabelas || {};
  const [buscaCopia, setBuscaCopia] = useState('');
  const [produtoParaCopiar, setProdutoParaCopiar] = useState(null);
```

Import `useState` no topo do arquivo (linha 1-7): trocar `'use client';` seguido dos imports por incluir `import { useState } from 'react';`.

E, depois do bloco de busca (Step 1), o diálogo de confirmação:

```jsx
      {produtoParaCopiar && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setProdutoParaCopiar(null); }}>
          <div className="modal-box" role="dialog" aria-modal="true">
            <div className="modal-head"><h3>Copiar configuração fiscal</h3></div>
            <div className="modal-body">
              <p>Copiar de <b>{produtoParaCopiar.codigo} — {produtoParaCopiar.nome}</b>?</p>
              <p className="ajuda">
                Serão importados: NCM, CEST, GTIN, origem, unidade tributável, peso, escala de produção,
                configuração tributária (grupo) e demais campos desta aba. Nada é salvo até você clicar
                em "Salvar alterações".
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn secondary" type="button" onClick={() => setProdutoParaCopiar(null)}>Cancelar</button>
              <button className="btn" type="button" onClick={() => {
                // Descarta tudo que não é fiscal (identidade do registro de origem +
                // campos da aba Geral, que não fazem parte desta cópia) e tudo que é
                // específico da liberação/sugestão do produto de origem — nunca deve
                // "herdar" que o produto de origem já foi liberado para emissão.
                const {
                  id, codigo, created_at, updated_at, atualizado_por_id, empresa_id,
                  nome, categoria, unidade, preco_venda, custo_unitario, validade_dias,
                  producao_interna, rastreado,
                  ativo_fiscal, sugerido_automaticamente, revisado_em, revisado_por_id,
                  ...camposFiscais
                } = produtoParaCopiar;
                set(camposFiscais);
                setProdutoParaCopiar(null);
                setBuscaCopia('');
              }}>Copiar</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 3: Verificar manualmente no browser**

Na aba Fiscal de um produto, buscar outro produto já com NCM/CEST/grupo tributário preenchidos, clicar, confirmar — campos da aba Fiscal atualizam na tela (sem salvar ainda). Clicar Cancelar no modal principal do produto (Task 2) — confirma que nada foi persistido. Repetir e clicar Salvar alterações — confirma que persiste.

- [ ] **Step 4: Commit**

```bash
git add components/ProdutoFiscal.js
git commit -m "feat(produtos): copiar configuração fiscal de outro produto, com confirmação antes de salvar"
```

---

## Ordem recomendada de execução

Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8.
(1-3 têm dependência direta; 4-6 são independentes entre si e podem ser feitas em qualquer ordem depois da 2; 7 e 8 dependem do rodapé fixo da Task 2.)
