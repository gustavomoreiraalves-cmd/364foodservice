'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import Icone from '../../components/Icone';
import ListaCadastro from '../../components/ListaCadastro';
import FichaModal from '../../components/FichaModal';
import { useEmpresaAtual } from '../../lib/empresa';
import { useCadastro } from '../../lib/cadastro';
import { filtrarRegistros } from '../../lib/listaCadastro';
import { pendenciasFiscaisCliente, soDigitos } from '../../lib/fiscal';

const FORM_VAZIO = {
  nome: '', cnpj: '', tipo: 'Revenda', contato: '', telefone: '',
  // Bloco <dest> da NF-e (atualização 36). Sem ele não se emite nota para
  // este cliente, por mais completo que esteja o cadastro comercial.
  tipo_pessoa: 'J', cpf: '', ie: '', ind_ie_dest: null, consumidor_final: null,
  logradouro: '', numero: '', complemento: '', bairro: '',
  codigo_municipio_ibge: '', municipio: '', uf: '', cep: '', email_nfe: '',
};
const TIPOS = ['Revenda', 'Distribuidor', 'Food Service', 'Consumidor Final'];
const CAMPOS_BUSCA = ['nome', 'cnpj', 'cpf', 'tipo', 'municipio'];

export default function ClientesPage() {
  return (
    <AppShell modulo="clientes" titulo="Clientes" desc="Cadastro de clientes, revendas e dados para nota fiscal">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [criando, setCriando] = useState(false);
  const [fiscalDisponivel, setFiscalDisponivel] = useState(true);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const { data } = await supabase.from('clientes').select('*').eq('empresa_id', empresaAtual.id).order('nome');
    setLista(data || []);
    // Sem a atualização 36 as colunas do bloco dest não existem, e gravá-las
    // faria o PostgREST recusar o registro inteiro.
    setFiscalDisponivel(!data?.length || 'uf' in (data[0] || {}));
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  const { form, setForm, editando, salvando, iniciarEdicao, cancelarEdicao, salvar, alternarAtivo, excluir } =
    useCadastro({
      tabela: 'clientes',
      formVazio: FORM_VAZIO,
      empresaId: empresaAtual?.id,
      aoTerminar: async () => { await carregar(); fechar(); },
      paraGravar: dados => (fiscalDisponivel ? dados : recorteComercial(dados)),
    });

  const emEdicao = editando ? lista.find(c => c.id === editando) : null;
  const visiveis = useMemo(
    () => filtrarRegistros(lista, { campos: CAMPOS_BUSCA, busca, mostrarInativos }),
    [lista, busca, mostrarInativos],
  );
  const pendencias = fiscalDisponivel ? pendenciasFiscaisCliente(form) : [];
  const aberto = criando || !!editando;

  function abrirNovo() { cancelarEdicao(); setCriando(true); }
  function fechar() { cancelarEdicao(); setCriando(false); }
  function abrir(c) { setCriando(false); iniciarEdicao(c); }

  const COLUNAS = [
    { titulo: 'Nome', principal: true, minimo: 200, render: c => c.nome, textoPuro: c => c.nome },
    {
      titulo: 'Tipo', largura: 118,
      render: c => (c.tipo ? <span className="tag categoria">{c.tipo}</span> : null),
      textoPuro: c => c.tipo || '',
    },
    { titulo: 'CNPJ / CPF', largura: 132, mono: true, render: c => c.cnpj || c.cpf || null, textoPuro: c => c.cnpj || c.cpf || '' },
    { titulo: 'Município', largura: 130, render: c => (c.municipio ? `${c.municipio}/${c.uf || ''}` : null), textoPuro: c => c.municipio || '' },
    { titulo: 'Contato', largura: 140, render: c => c.contato || null, textoPuro: c => c.contato || '' },
    { titulo: 'Telefone', largura: 118, mono: true, render: c => c.telefone || null, textoPuro: c => c.telefone || '' },
    {
      titulo: 'Nota', largura: 66, alinhamento: 'center',
      render: c => (!fiscalDisponivel ? null
        : pendenciasFiscaisCliente(c).length
          ? <span className="tag warn">falta</span>
          : <span className="tag ok">ok</span>),
      textoPuro: c => (pendenciasFiscaisCliente(c).length ? 'faltam dados para emitir' : 'pronto para emitir'),
    },
  ];

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <>
      <section className="panel">
        <div className="filter-bar" style={{ marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="busca-cliente">Buscar</label>
            <input id="busca-cliente" value={busca} placeholder="nome, CNPJ, CPF, tipo ou município"
                   onChange={e => setBusca(e.target.value)} />
          </div>
          <button className="btn" type="button" onClick={abrirNovo}>
            <Icone nome="mais" tamanho={14} /> Novo cliente
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span className="muted" style={{ fontSize: 11.5 }}>
            {visiveis.length} de {lista.length} cliente{lista.length === 1 ? '' : 's'}
          </span>
          <label className="check-line" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
            Mostrar inativos
          </label>
        </div>

        <ListaCadastro
          colunas={COLUNAS} registros={visiveis} selecionado={editando} onAbrir={abrir}
          rotulo="Clientes"
          vazio={busca ? 'Nenhum cliente encontrado para essa busca.' : 'Nenhum cliente cadastrado ainda.'} />
      </section>

      {aberto && (
        <FichaModal
          titulo={emEdicao ? emEdicao.nome : 'Novo cliente'}
          subtitulo={emEdicao?.cnpj || emEdicao?.cpf || null}
          onFechar={fechar}>
          <form onSubmit={salvar}>
            <div className="modal-body">
              {fiscalDisponivel && (
                <div className={'pendencias' + (pendencias.length ? '' : ' completo')}>
                  {pendencias.length ? (
                    <>
                      <b>Falta para emitir nota para este cliente:</b>
                      <ul>{pendencias.map(p => <li key={p}>{p}</li>)}</ul>
                    </>
                  ) : <span className="tag ok">Pronto para receber nota fiscal</span>}
                </div>
              )}

              <div className="form-grid">
                <div className="secao">Identificação</div>
                <div className="largo">
                  <label htmlFor="c-nome">Nome / Razão social</label>
                  <input id="c-nome" required autoFocus value={form.nome}
                         onChange={e => setForm({ ...form, nome: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="c-pessoa">Pessoa</label>
                  <select id="c-pessoa" value={form.tipo_pessoa || 'J'}
                          onChange={e => setForm({ ...form, tipo_pessoa: e.target.value })}>
                    <option value="J">Jurídica</option><option value="F">Física</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="c-doc">{form.tipo_pessoa === 'F' ? 'CPF' : 'CNPJ'}</label>
                  <input id="c-doc" inputMode="numeric"
                         maxLength={form.tipo_pessoa === 'F' ? 11 : 14}
                         value={form.tipo_pessoa === 'F' ? (form.cpf || '') : (form.cnpj || '')}
                         onChange={e => setForm(form.tipo_pessoa === 'F'
                           ? { ...form, cpf: soDigitos(e.target.value) }
                           : { ...form, cnpj: soDigitos(e.target.value) })} />
                </div>
                <div>
                  <label htmlFor="c-tipo">Tipo de cliente</label>
                  <select id="c-tipo" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                    {TIPOS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="c-contato">Contato</label>
                  <input id="c-contato" value={form.contato} onChange={e => setForm({ ...form, contato: e.target.value })} />
                </div>
                <div>
                  <label htmlFor="c-fone">Telefone</label>
                  <input id="c-fone" value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} />
                </div>
              </div>

              {fiscalDisponivel && (
                <div className="form-grid">
                  <div className="secao">Dados para nota fiscal</div>
                  <div>
                    <label htmlFor="c-indie">Inscrição estadual</label>
                    <select id="c-indie" value={form.ind_ie_dest ?? ''}
                            onChange={e => setForm({
                              ...form,
                              ind_ie_dest: e.target.value === '' ? null : Number(e.target.value),
                              // Trocar para não contribuinte com IE preenchida
                              // deixaria o registro em estado que o banco recusa.
                              ie: e.target.value === '1' ? form.ie : '',
                            })}>
                      <option value="">Selecione…</option>
                      <option value="1">Contribuinte de ICMS</option>
                      <option value="2">Isento de inscrição</option>
                      <option value="9">Não contribuinte</option>
                    </select>
                  </div>
                  {Number(form.ind_ie_dest) === 1 && (
                    <div>
                      <label htmlFor="c-ie">Número da inscrição</label>
                      <input id="c-ie" inputMode="numeric" value={form.ie || ''}
                             onChange={e => setForm({ ...form, ie: soDigitos(e.target.value) })} />
                    </div>
                  )}
                  <div>
                    <label htmlFor="c-final">Compra para</label>
                    <select id="c-final" value={form.consumidor_final === null || form.consumidor_final === undefined ? '' : String(form.consumidor_final)}
                            onChange={e => setForm({ ...form, consumidor_final: e.target.value === '' ? null : e.target.value === 'true' })}>
                      <option value="">Selecione…</option>
                      <option value="false">Revender</option>
                      <option value="true">Consumo próprio</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="c-email">E-mail para a nota</label>
                    <input id="c-email" type="email" value={form.email_nfe || ''}
                           onChange={e => setForm({ ...form, email_nfe: e.target.value })} />
                  </div>

                  <div className="secao">Endereço</div>
                  <div className="largo">
                    <label htmlFor="c-log">Logradouro</label>
                    <input id="c-log" value={form.logradouro || ''}
                           onChange={e => setForm({ ...form, logradouro: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="c-num">Número</label>
                    <input id="c-num" value={form.numero || ''} onChange={e => setForm({ ...form, numero: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="c-comp">Complemento</label>
                    <input id="c-comp" value={form.complemento || ''} onChange={e => setForm({ ...form, complemento: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="c-bairro">Bairro</label>
                    <input id="c-bairro" value={form.bairro || ''} onChange={e => setForm({ ...form, bairro: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="c-cep">CEP</label>
                    <input id="c-cep" inputMode="numeric" maxLength={8} value={form.cep || ''}
                           onChange={e => setForm({ ...form, cep: soDigitos(e.target.value) })} />
                  </div>
                  <div>
                    <label htmlFor="c-mun">Município</label>
                    <input id="c-mun" value={form.municipio || ''} onChange={e => setForm({ ...form, municipio: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor="c-ibge">Código IBGE</label>
                    <input id="c-ibge" inputMode="numeric" maxLength={7} value={form.codigo_municipio_ibge || ''}
                           onChange={e => setForm({ ...form, codigo_municipio_ibge: soDigitos(e.target.value) })} />
                    <p className="ajuda">Ji-Paraná é 1100122; Porto Velho, 1100205.</p>
                  </div>
                  <div>
                    <label htmlFor="c-uf">UF</label>
                    <input id="c-uf" maxLength={2} value={form.uf || ''}
                           onChange={e => setForm({ ...form, uf: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} />
                  </div>
                </div>
              )}
            </div>

            <div className="modal-foot">
              <button className="btn" type="submit" disabled={salvando}>
                {salvando ? 'Salvando…' : (editando ? 'Salvar alterações' : 'Criar cliente')}
              </button>
              <button className="btn secondary" type="button" onClick={fechar}>Cancelar</button>
              {emEdicao && (
                <>
                  <button className="btn secondary small" type="button" style={{ marginLeft: 'auto' }}
                          onClick={() => alternarAtivo(emEdicao)}>
                    {emEdicao.ativo === false ? 'Reativar' : 'Desativar'}
                  </button>
                  <button className="btn danger" type="button"
                          onClick={() => excluir(emEdicao, `Excluir o cliente ${emEdicao.nome}?`)}>
                    <Icone nome="lixeira" tamanho={13} /> Excluir
                  </button>
                </>
              )}
            </div>
          </form>
        </FichaModal>
      )}
    </>
  );
}

// Antes da atualização 36 o cadastro só tinha o recorte comercial; mandar as
// colunas do bloco dest para um banco sem elas derruba o insert inteiro.
function recorteComercial(dados) {
  const { nome, cnpj, tipo, contato, telefone } = dados;
  return { nome, cnpj, tipo, contato, telefone };
}
