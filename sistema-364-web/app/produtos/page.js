'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { fmtMoney, proximoCodigoProduto, parseCustoUnitario } from '../../lib/format';
import { CONSERVACOES } from '../../lib/producao';
import AppShell from '../../components/AppShell';
import Icone from '../../components/Icone';
import { useEmpresaAtual } from '../../lib/empresa';
import { camposDoFormulario, mensagemAoAlternarAtivo, mensagemAoExcluir } from '../../lib/cadastro';
import ProdutoFiscal from '../../components/ProdutoFiscal';
import ConfiguracaoFiscalModal from '../../components/ConfiguracaoFiscalModal';
import { pendenciasFiscaisProduto, fatorConversaoTributavel } from '../../lib/fiscal';

const PROD_VAZIO = { nome: '', categoria: '', unidade: 'un', custo_unitario: '', preco_venda: '', validade_dias: 90, producao_interna: false, rastreado: false };

// Bloco fiscal, separado do resto porque só ele depende da atualização 36: se a
// migração ainda não rodou neste banco, estes campos não vão no insert.
const PROD_FISCAL_VAZIO = {
  ncm: '', ex_tipi: '', cest: '', origem_mercadoria: null, sujeito_st: false,
  unidade_tributavel: '', fator_conversao_tributavel: '', peso_liquido_kg: '', peso_bruto_kg: '',
  gtin: '', gtin_tributavel: '', ind_escala: '', cnpj_fabricante: '',
  rastro_obrigatorio: false, grupo_tributario_id: null, aliquota_transparencia: '',
  cclasstrib: '', ativo_fiscal: false, sugerido_automaticamente: false,
};

const CUSTO_INVALIDO = 'Custo inválido. Informe um número igual ou maior que zero (ex.: 45,50), sem separador de milhar. Deixe em branco para usar o custo da ficha técnica.';

function numeroOuNulo(valor) {
  if (valor === '' || valor === null || valor === undefined) return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function textoOuNulo(valor) {
  const t = String(valor ?? '').trim();
  return t === '' ? null : t;
}

// Traduz o formulário para as colunas da atualização 36. Texto em branco vira
// null (e não string vazia) porque as constraints de formato do banco checam
// `is null or ~ regex`: uma string vazia não é nula e reprovaria no check.
// `ativo_fiscal` não entra: quem o liga é o botão Liberar, nunca o Salvar.
function camposFiscais(form) {
  return {
    ncm: textoOuNulo(form.ncm),
    ex_tipi: textoOuNulo(form.ex_tipi),
    cest: textoOuNulo(form.cest),
    origem_mercadoria: numeroOuNulo(form.origem_mercadoria),
    sujeito_st: !!form.sujeito_st,
    unidade_tributavel: textoOuNulo(form.unidade_tributavel),
    fator_conversao_tributavel: fatorConversaoTributavel(form),
    peso_liquido_kg: numeroOuNulo(form.peso_liquido_kg),
    peso_bruto_kg: numeroOuNulo(form.peso_bruto_kg),
    gtin: textoOuNulo(form.gtin),
    gtin_tributavel: textoOuNulo(form.gtin_tributavel),
    ind_escala: textoOuNulo(form.ind_escala),
    cnpj_fabricante: textoOuNulo(form.cnpj_fabricante),
    rastro_obrigatorio: !!form.rastro_obrigatorio,
    grupo_tributario_id: form.grupo_tributario_id || null,
    aliquota_transparencia: numeroOuNulo(form.aliquota_transparencia),
    cclasstrib: textoOuNulo(form.cclasstrib),
  };
}

export default function ProdutosPage() {
  return (
    <AppShell modulo="produtos" titulo="Produtos" desc="Catálogo, ficha técnica, custo e dados fiscais">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [mps, setMps] = useState([]);
  const [produtos, setProdutos] = useState([]);
  const [fichas, setFichas] = useState([]);
  const [regras, setRegras] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selecionado, setSelecionado] = useState(null);
  const [criando, setCriando] = useState(false);
  const [formProd, setFormProd] = useState({ ...PROD_VAZIO, ...PROD_FISCAL_VAZIO });
  const [aba, setAba] = useState('geral');
  const [busca, setBusca] = useState('');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [itemFicha, setItemFicha] = useState({});
  const [regraForm, setRegraForm] = useState({});
  const [tabelasFiscais, setTabelasFiscais] = useState({ ncms: [], cests: [], unidades: [], grupos: [] });
  const [naturezas, setNaturezas] = useState([]);
  const [regrasTributarias, setRegrasTributarias] = useState([]);
  const [cfops, setCfops] = useState([]);
  const [configAberta, setConfigAberta] = useState(null); // { grupoId } ou { grupoId: null } para nova
  const [fiscalDisponivel, setFiscalDisponivel] = useState(false);
  // Sem esta trava, `proximoCodigoProduto` lê a contagem antes de qualquer
  // insert e dois cliques rápidos criam dois produtos com o mesmo 0364-XXX —
  // o código impresso na etiqueta, que não pode repetir.
  const [salvando, setSalvando] = useState(false);

  const produtoSelecionado = selecionado ? produtos.find(p => p.id === selecionado) : null;

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [r1, r2, r3, r4] = await Promise.all([
      supabase.from('materias_primas').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('produtos').select('*').eq('empresa_id', empresaAtual.id).order('codigo'),
      supabase.from('ficha_tecnica').select('*, materias_primas(nome, unidade)').eq('empresa_id', empresaAtual.id),
      supabase.from('produto_regras_validade').select('*').eq('empresa_id', empresaAtual.id),
    ]);
    setMps(r1.data || []);
    setProdutos(r2.data || []);
    setFichas(r3.data || []);
    setRegras(r4.data || []);
    await carregarTabelasFiscais();
    setLoading(false);
  }

  // As tabelas oficiais (NCM, CEST, unidades) não têm empresa_id: são as mesmas
  // para todo mundo e só a service role escreve nelas. Se qualquer uma faltar, o
  // bloco fiscal inteiro fica indisponível em vez de gravar dado pela metade.
  async function carregarTabelasFiscais() {
    const [ncm, cest, un, grupo, nat, regra, cfop] = await Promise.all([
      supabase.from('tabela_ncm').select('ncm, descricao').order('ncm'),
      supabase.from('tabela_cest').select('cest, ncm, descricao').order('cest'),
      supabase.from('tabela_unidade_medida').select('codigo, descricao').order('codigo'),
      supabase.from('grupos_tributarios').select('id, codigo, descricao')
        .eq('empresa_id', empresaAtual.id).eq('ativo', true).order('codigo'),
      supabase.from('naturezas_operacao').select('*')
        .eq('empresa_id', empresaAtual.id).eq('ativo', true).order('descricao'),
      supabase.from('regras_tributarias').select('*')
        .eq('empresa_id', empresaAtual.id).order('created_at'),
      supabase.from('tabela_cfop').select('cfop, descricao').order('cfop'),
    ]);
    if (ncm.error || cest.error || grupo.error) { setFiscalDisponivel(false); return; }
    setFiscalDisponivel(true);
    setTabelasFiscais({
      ncms: ncm.data || [], cests: cest.data || [],
      unidades: un.data || [], grupos: grupo.data || [],
    });
    setNaturezas(nat.data || []);
    setRegrasTributarias(regra.data || []);
    setCfops(cfop.data || []);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  // Esc fecha a ficha. Sem isto a janela só sai pelo botão, e quem trabalha no
  // teclado fica preso nela.
  useEffect(() => {
    function aoTeclar(e) {
      if (e.key === 'Escape' && !configAberta) fechar();
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [configAberta]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return produtos
      .filter(p => mostrarInativos || p.ativo !== false)
      .filter(p => !termo
        || p.nome.toLowerCase().includes(termo)
        || (p.codigo || '').toLowerCase().includes(termo)
        || (p.categoria || '').toLowerCase().includes(termo)
        || (p.ncm || '').includes(termo));
  }, [produtos, busca, mostrarInativos]);

  function custoTeorico(produtoId) {
    return fichas
      .filter(f => f.produto_id === produtoId)
      .reduce((s, f) => {
        const mp = mps.find(m => m.id === f.materia_prima_id);
        return s + (mp ? Number(f.quantidade) * Number(mp.custo_unitario) : 0);
      }, 0);
  }

  function abrir(p) {
    setFormProd(camposDoFormulario(p, { ...PROD_VAZIO, ...PROD_FISCAL_VAZIO }));
    setSelecionado(p.id);
    setCriando(false);
    setAba('geral');
  }

  function abrirNovo() {
    setFormProd({ ...PROD_VAZIO, ...PROD_FISCAL_VAZIO });
    setSelecionado(null);
    setCriando(true);
    setAba('geral');
  }

  function fechar() {
    setSelecionado(null);
    setCriando(false);
    setFormProd({ ...PROD_VAZIO, ...PROD_FISCAL_VAZIO });
  }

  async function salvarProduto(e) {
    e.preventDefault();
    if (salvando) return;
    // Sem esta validação `Number('-5') || 0` gravaria -5, e um texto inválido
    // viraria 0 em silêncio.
    const custo = parseCustoUnitario(formProd.custo_unitario);
    if (custo === null) { alert(CUSTO_INVALIDO); return; }

    const campos = {
      nome: formProd.nome,
      categoria: formProd.categoria || null,
      unidade: formProd.unidade,
      custo_unitario: custo,
      preco_venda: Number(formProd.preco_venda),
      // Teste tem que ser "campo em branco", não falsy: `|| 90` apagaria um
      // validade_dias = 0 salvo de propósito ao reabrir o produto para editar.
      validade_dias: formProd.validade_dias === '' || formProd.validade_dias === null || formProd.validade_dias === undefined
        ? 90
        : Number(formProd.validade_dias),
      producao_interna: !!formProd.producao_interna,
      rastreado: !!formProd.rastreado,
      ...(fiscalDisponivel ? camposFiscais(formProd) : {}),
    };

    setSalvando(true);
    try {
      let error;
      let novoId = selecionado;
      if (selecionado) {
        ({ error } = await supabase.from('produtos').update(campos).eq('id', selecionado));
      } else {
        const codigo = await proximoCodigoProduto(empresaAtual.id, empresaAtual.prefixo_codigo);
        const resposta = await supabase.from('produtos')
          .insert([{ ...campos, codigo, empresa_id: empresaAtual.id }]).select('id').maybeSingle();
        error = resposta.error;
        novoId = resposta.data?.id || null;
      }
      if (error) { alert('Erro ao salvar: ' + error.message); return; }
      await carregar();
      // Depois de criar, o produto continua aberto: quem cadastrou quase sempre
      // vai direto preencher a ficha técnica e o bloco fiscal.
      if (novoId) { setSelecionado(novoId); setCriando(false); }
    } finally {
      setSalvando(false);
    }
  }

  // A trava fiscal só cai depois que alguém conferiu: é o que separa dado
  // sugerido de dado confirmado, e o banco repete a checagem em constraint.
  async function liberarParaEmissao() {
    if (!selecionado || pendenciasFiscaisProduto(formProd).length) return;
    // Quem conferiu fica registrado: numa fiscalização, "o sistema liberou" não
    // é resposta — a coluna revisado_por_id existe para ter um nome.
    const { data: sessao } = await supabase.auth.getUser();
    const { error } = await supabase.from('produtos')
      .update({
        ativo_fiscal: true,
        // Produto salvo antes desta derivação existir pode estar sem o fator;
        // repetimos aqui para que ele não fique travado esperando um resalvar.
        fator_conversao_tributavel: fatorConversaoTributavel(formProd),
        sugerido_automaticamente: false,
        revisado_em: new Date().toISOString(),
        revisado_por_id: sessao?.user?.id || null,
      })
      .eq('id', selecionado);
    if (error) { alert('Não foi possível liberar: ' + error.message); return; }
    setFormProd({ ...formProd, ativo_fiscal: true, sugerido_automaticamente: false });
    carregar();
  }

  async function alternarAtivo(p) {
    const { error } = await supabase.from('produtos')
      .update({ ativo: !(p.ativo !== false) }).eq('id', p.id);
    if (error) { alert(mensagemAoAlternarAtivo(error)); return; }
    carregar();
  }

  async function excluir(id) {
    if (!confirm('Excluir este produto e sua ficha técnica? Não dá para desfazer.')) return;
    const { error } = await supabase.from('produtos').delete().eq('id', id);
    if (error) { alert(mensagemAoExcluir(error, 'produto')); return; }
    if (selecionado === id) fechar();
    carregar();
  }

  async function salvarCusto(produtoId, valor) {
    if (valor === null || valor === undefined) return;
    const custo = parseCustoUnitario(valor);
    if (custo === null) { alert(CUSTO_INVALIDO); return; }
    const { error } = await supabase.from('produtos').update({ custo_unitario: custo }).eq('id', produtoId);
    if (error) { alert('Erro ao salvar o custo: ' + error.message); return; }
    carregar();
  }

  async function addItemFicha(e, produtoId) {
    e.preventDefault();
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

  async function delItemFicha(id) {
    await supabase.from('ficha_tecnica').delete().eq('id', id);
    carregar();
  }

  function regraDe(produtoId, conservacao) {
    return regras.find(r => r.produto_id === produtoId && r.conservacao === conservacao);
  }

  async function salvarRegra(produtoId, conservacao) {
    const chave = produtoId + ':' + conservacao;
    const atual = regraDe(produtoId, conservacao);
    const f = regraForm[chave] || {
      permitido: atual ? atual.permitido : true,
      valor: atual?.validade_valor || '',
      unidade: atual?.validade_unidade || 'dias',
    };
    if (f.permitido && !Number(f.valor)) { alert('Informe o prazo de validade para conservação permitida.'); return; }
    const { error } = await supabase.from('produto_regras_validade').upsert([{
      empresa_id: empresaAtual.id,
      produto_id: produtoId,
      conservacao,
      permitido: !!f.permitido,
      validade_valor: f.permitido ? Number(f.valor) : null,
      validade_unidade: f.permitido ? f.unidade : null,
      ativo: true,
    }], { onConflict: 'produto_id,conservacao' });
    if (error) { alert('Erro ao salvar regra: ' + error.message); return; }
    carregar();
  }

  if (loading) return <p className="muted">Carregando…</p>;

  const fichaAberta = criando || !!produtoSelecionado;
  const pendencias = fiscalDisponivel ? pendenciasFiscaisProduto(formProd) : [];

  return (
    <>
      <section className="panel">
        <div className="filter-bar" style={{ marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="busca-produto">Buscar</label>
            <input id="busca-produto" value={busca} placeholder="código, nome, categoria ou NCM"
                   onChange={e => setBusca(e.target.value)} />
          </div>
          <button className="btn" type="button" onClick={abrirNovo}>
            <Icone nome="mais" tamanho={14} /> Novo produto
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {visiveis.length} de {produtos.length} produto{produtos.length === 1 ? '' : 's'}
          </span>
          <label className="check-line" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
            Mostrar inativos
          </label>
        </div>

        {visiveis.length ? (
          <div className="registro-lista" role="listbox" aria-label="Produtos">
            <div className="registro-cabecalho" aria-hidden="true">
              <span className="codigo">Código</span>
              <span className="nome">Produto</span>
              <span className="tag-espaco">Categoria</span>
              <span className="ncm">NCM</span>
              <span className="valores">
                <span>Custo</span><span>Venda</span><span>Margem</span>
              </span>
              <span className="tag-espaco situacao">Fiscal</span>
            </div>
            {visiveis.map(p => {
              const custoT = custoTeorico(p.id);
              const custoEfetivo = Number(p.custo_unitario) > 0 ? Number(p.custo_unitario) : custoT;
              const margem = Number(p.preco_venda)
                ? ((Number(p.preco_venda) - custoEfetivo) / Number(p.preco_venda) * 100) : 0;
              return (
                <button type="button" key={p.id} role="option"
                        aria-selected={selecionado === p.id}
                        className={'registro' + (p.ativo === false ? ' inativo' : '')}
                        onClick={() => abrir(p)}>
                  <span className="codigo">{p.codigo}</span>
                  <span className="nome" title={p.nome}>{p.nome}</span>
                  {p.categoria
                    ? <span className="tag categoria" title={p.categoria}>{p.categoria}</span>
                    : <span className="tag-espaco" aria-hidden="true" />}
                  <span className="ncm" title={p.ncm ? 'NCM ' + p.ncm : 'sem NCM'}>
                    {p.ncm || <span className="muted">—</span>}
                  </span>
                  <span className="valores">
                    <span title="Custo">{fmtMoney(custoEfetivo)}</span>
                    <span title="Preço de venda">{fmtMoney(p.preco_venda)}</span>
                    <span title="Margem" className={margem < 0 ? 'erro' : ''}>{margem.toFixed(0)}%</span>
                  </span>
                  {fiscalDisponivel && (p.ativo_fiscal
                    ? <span className="tag ok">fiscal ok</span>
                    : <span className="tag warn">fiscal</span>)}
                  {p.ativo === false && <span className="tag neutro">inativo</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <p className="muted" style={{ padding: '18px 0' }}>
            {busca ? 'Nenhum produto encontrado para essa busca.' : 'Nenhum produto cadastrado ainda.'}
          </p>
        )}
      </section>

      {fichaAberta && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) fechar(); }}>
          <div className="modal-box wide" role="dialog" aria-modal="true" aria-labelledby="ficha-titulo">
            <div className="modal-head">
              <div>
                <h3 id="ficha-titulo">{produtoSelecionado ? produtoSelecionado.nome : 'Novo produto'}</h3>
                {produtoSelecionado && (
                  <span className="muted mono" style={{ fontSize: 11.5 }}>{produtoSelecionado.codigo}</span>
                )}
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

            {aba === 'geral' && (
              <form onSubmit={salvarProduto}>
                <div className="modal-body">
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
                </div>
                <div className="modal-foot">
                  <button className="btn" type="submit" disabled={salvando}>
                    {salvando ? 'Salvando…' : (produtoSelecionado ? 'Salvar alterações' : 'Criar produto')}
                  </button>
                  <button className="btn secondary" type="button" onClick={fechar}>Cancelar</button>
                  {produtoSelecionado && (
                    <>
                      <button className="btn secondary small" type="button" style={{ marginLeft: 'auto' }}
                              onClick={() => alternarAtivo(produtoSelecionado)}>
                        {produtoSelecionado.ativo === false ? 'Reativar' : 'Desativar'}
                      </button>
                      <button className="btn danger" type="button" onClick={() => excluir(produtoSelecionado.id)}>
                        <Icone nome="lixeira" tamanho={13} /> Excluir
                      </button>
                    </>
                  )}
                </div>
              </form>
            )}

            {aba === 'fiscal' && (
              <form onSubmit={salvarProduto}>
                <div className="modal-body">
                  <ProdutoFiscal form={formProd} setForm={setFormProd} tabelas={tabelasFiscais}
                                 disponivel={fiscalDisponivel} editando={!!produtoSelecionado}
                                 onLiberar={liberarParaEmissao}
                                 naturezas={naturezas} regras={regrasTributarias}
                                 onAbrirConfiguracao={grupoId => setConfigAberta({ grupoId })}
                                 produtos={produtos} produtoAtualId={selecionado} />
                </div>
                <div className="modal-foot">
                  <button className="btn" type="submit" disabled={salvando || !fiscalDisponivel}>
                    {salvando ? 'Salvando…' : 'Salvar dados fiscais'}
                  </button>
                  <button className="btn secondary" type="button" onClick={fechar}>Cancelar</button>
                </div>
              </form>
            )}

            {aba === 'ficha' && produtoSelecionado && (
              <>
                <div className="modal-body">
                  <FichaTecnica
                    produto={produtoSelecionado}
                    itens={fichas.filter(f => f.produto_id === selecionado)}
                    mps={mps}
                    custoTeorico={custoTeorico(selecionado)}
                    item={itemFicha[selecionado] || { materia_prima_id: mps.find(m => m.ativo !== false)?.id || '', quantidade: '' }}
                    setItem={novo => setItemFicha({ ...itemFicha, [selecionado]: novo })}
                    onAdicionar={e => addItemFicha(e, selecionado)}
                    onRemover={delItemFicha}
                    onEditarCusto={() => salvarCusto(selecionado, prompt(
                      'Custo unitário de ' + produtoSelecionado.nome + ' (R$). Custo teórico da ficha: '
                        + fmtMoney(custoTeorico(selecionado)),
                      produtoSelecionado.custo_unitario || custoTeorico(selecionado).toFixed(2)))}
                    regras={CONSERVACOES.map(c => ({ ...c, atual: regraDe(selecionado, c.id) }))}
                    regraForm={regraForm}
                    setRegraForm={setRegraForm}
                    onSalvarRegra={conservacao => salvarRegra(selecionado, conservacao)}
                  />
                </div>
                <div className="modal-foot">
                  <button className="btn secondary" type="button" onClick={fechar}>Fechar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {configAberta && (
        <ConfiguracaoFiscalModal
          empresaId={empresaAtual.id}
          grupo={tabelasFiscais.grupos.find(g => g.id === configAberta.grupoId) || null}
          naturezas={naturezas}
          cfops={cfops}
          regras={regrasTributarias}
          onFechar={() => setConfigAberta(null)}
          onSalvo={async grupoId => {
            await carregarTabelasFiscais();
            // Uma configuração criada de dentro do produto já fica escolhida
            // nele: quem acabou de descrever a tributação não deveria precisar
            // voltar ao seletor para apontá-la.
            if (grupoId) setFormProd(atual => ({ ...atual, grupo_tributario_id: grupoId }));
          }}
        />
      )}
    </>
  );
}

// Ficha técnica e regras de conservação: o que o produto consome e como ele
// pode ser guardado. Fica numa aba própria porque é trabalho de outra pessoa,
// em outro momento, que o cadastro comercial.
function FichaTecnica({
  produto, itens, mps, custoTeorico, item, setItem, onAdicionar, onRemover, onEditarCusto,
  regras, regraForm, setRegraForm, onSalvarRegra,
}) {
  const custoCadastrado = Number(produto.custo_unitario) > 0;
  return (
    <>
      <div className="form-grid">
        <div className="secao">Matéria-prima por unidade produzida</div>
      </div>

      {itens.length ? (
        <div className="items-list">
          {itens.map(f => {
            const mp = mps.find(m => m.id === f.materia_prima_id);
            const custo = mp ? Number(f.quantidade) * Number(mp.custo_unitario) : 0;
            const fatia = custoTeorico > 0 ? (custo / custoTeorico) * 100 : 0;
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
          })}
          <div className="subtotal">Custo da ficha: {fmtMoney(custoTeorico)}</div>
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 12.5 }}>Nenhum item na ficha técnica ainda.</p>
      )}

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

      <div className="banner info" style={{ marginTop: 16 }}>
        Custo em uso: <b>{fmtMoney(custoCadastrado ? Number(produto.custo_unitario) : custoTeorico)}</b>{' '}
        {custoCadastrado ? '(cadastrado na mão)' : '(calculado pela ficha)'}
        <button className="btn secondary small" type="button" style={{ marginLeft: 10 }} onClick={onEditarCusto}>
          <Icone nome="lapis" tamanho={13} /> Editar custo
        </button>
      </div>

      {produto.producao_interna && (
        <>
          <div className="form-grid"><div className="secao">Conservação e validade</div></div>
          <p className="ajuda" style={{ marginTop: 0 }}>Usadas na Produção Interna para calcular a validade da etiqueta.</p>
          {regras.map(c => {
            const chave = produto.id + ':' + c.id;
            const f = regraForm[chave] || {
              permitido: c.atual ? c.atual.permitido : false,
              valor: c.atual?.validade_valor || '',
              unidade: c.atual?.validade_unidade || 'dias',
            };
            const setF = novo => setRegraForm({ ...regraForm, [chave]: { ...f, ...novo } });
            return (
              <div className="item-line" key={c.id} style={{ gap: 10, flexWrap: 'wrap' }}>
                <span style={{ flex: 'none', minWidth: 96 }}>{c.label}</span>
                <label className="check-line" style={{ flex: 'none' }}>
                  <input type="checkbox" checked={!!f.permitido} onChange={e => setF({ permitido: e.target.checked })} />
                  Permitido
                </label>
                {f.permitido && (
                  <>
                    <input type="number" min="1" style={{ width: 78 }} placeholder="Prazo" value={f.valor}
                           onChange={e => setF({ valor: e.target.value })} aria-label="Prazo de validade" />
                    <select value={f.unidade} onChange={e => setF({ unidade: e.target.value })}
                            style={{ width: 92 }} aria-label="Unidade do prazo">
                      <option value="dias">dias</option><option value="horas">horas</option>
                    </select>
                  </>
                )}
                <button className="btn secondary small" type="button" onClick={() => onSalvarRegra(c.id)}>Salvar</button>
                <span className="muted" style={{ flex: 1, fontSize: 11.5, textAlign: 'right' }}>
                  {c.atual
                    ? (c.atual.permitido ? c.atual.validade_valor + ' ' + c.atual.validade_unidade : 'não permitido')
                    : 'sem regra'}
                </span>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
