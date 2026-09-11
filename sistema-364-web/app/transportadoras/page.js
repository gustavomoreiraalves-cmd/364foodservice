'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import Icone from '../../components/Icone';
import ListaCadastro from '../../components/ListaCadastro';
import FichaModal from '../../components/FichaModal';
import { useEmpresaAtual } from '../../lib/empresa';
import { filtrarRegistros } from '../../lib/listaCadastro';
import { formatarCnpj } from '../../lib/cnpj';

const FORM_VAZIO = {
  nome: '', nome_fantasia: '', cnpj: '', ie: '', logradouro: '', numero: '', complemento: '',
  bairro: '', codigo_municipio_ibge: '', municipio: '', uf: '', cep: '', telefone: '',
};
const CAMPOS_BUSCA = ['nome', 'nome_fantasia', 'cnpj', 'municipio'];

export default function TransportadorasPage() {
  return (
    <AppShell modulo="transportadoras" titulo="Transportadoras" desc="Cadastro de transportadoras, pra informar no romaneio e na NF-e">
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
  const [selecionadoId, setSelecionadoId] = useState(null);
  const [criando, setCriando] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const { data } = await supabase.from('transportadoras').select('*').eq('empresa_id', empresaAtual.id).order('nome');
    setLista(data || []);
    setLoading(false);
  }
  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  const visiveis = useMemo(
    () => filtrarRegistros(lista, { campos: CAMPOS_BUSCA, busca, mostrarInativos }),
    [lista, busca, mostrarInativos],
  );
  const selecionado = selecionadoId ? lista.find(t => t.id === selecionadoId) ?? null : null;
  const aberto = criando || !!selecionado;

  function abrirNovo() { setSelecionadoId(null); setCriando(true); setForm(FORM_VAZIO); }
  function fechar() { setSelecionadoId(null); setCriando(false); setForm(FORM_VAZIO); }
  function abrir(t) { setCriando(false); setSelecionadoId(t.id); setForm({ ...FORM_VAZIO, ...t }); }

  async function salvar(e) {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    try {
      const linha = { ...form, empresa_id: empresaAtual.id };
      const { error } = selecionado
        ? await supabase.from('transportadoras').update(linha).eq('id', selecionado.id)
        : await supabase.from('transportadoras').insert([linha]);
      if (error) { alert(error.message); return; }
      await carregar();
      fechar();
    } finally { setSalvando(false); }
  }

  async function alternarAtivo() {
    if (!selecionado) return;
    const { error } = await supabase.from('transportadoras').update({ ativo: selecionado.ativo === false }).eq('id', selecionado.id);
    if (error) { alert(error.message); return; }
    await carregar();
  }

  const COLUNAS = [
    { id: 'nome', titulo: 'Nome', principal: true, minimo: 200, render: t => t.nome_fantasia || t.nome, textoPuro: t => t.nome_fantasia || t.nome },
    { id: 'cnpj', titulo: 'CNPJ', largura: 140, mono: true, render: t => (t.cnpj ? formatarCnpj(t.cnpj) : null), textoPuro: t => t.cnpj || '' },
    { id: 'municipio', titulo: 'Município', largura: 140, render: t => (t.municipio ? `${t.municipio}/${t.uf || ''}` : null), textoPuro: t => t.municipio || '' },
    { id: 'telefone', titulo: 'Telefone', largura: 120, mono: true, render: t => t.telefone || null, textoPuro: t => t.telefone || '' },
  ];

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <>
      <section className="panel">
        <div className="filter-bar" style={{ marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label htmlFor="busca-transportadora">Buscar</label>
            <input id="busca-transportadora" value={busca} placeholder="nome, CNPJ ou município"
                   onChange={e => setBusca(e.target.value)} />
          </div>
          <button className="btn" type="button" onClick={abrirNovo}><Icone nome="mais" tamanho={14} /> Nova transportadora</button>
        </div>
        <label className="check-line" style={{ fontSize: 12, marginBottom: 8 }}>
          <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} /> Mostrar inativas
        </label>
        <ListaCadastro chave="transportadoras" colunas={COLUNAS} registros={visiveis} selecionado={selecionado?.id}
          onAbrir={abrir} rotulo="Transportadoras" vazio="Nenhuma transportadora cadastrada ainda." />
      </section>

      {aberto && (
        <FichaModal titulo={selecionado ? selecionado.nome : 'Nova transportadora'} onFechar={fechar}>
          <form onSubmit={salvar}>
            <label>Nome (razão social)</label>
            <input required value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
            <label>Nome fantasia</label>
            <input value={form.nome_fantasia} onChange={e => setForm(f => ({ ...f, nome_fantasia: e.target.value }))} />
            <div className="row-actions">
              <div style={{ flex: 1 }}>
                <label>CNPJ</label>
                <input value={form.cnpj} onChange={e => setForm(f => ({ ...f, cnpj: e.target.value }))} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Inscrição estadual</label>
                <input value={form.ie} onChange={e => setForm(f => ({ ...f, ie: e.target.value }))} />
              </div>
            </div>
            <label>Logradouro</label>
            <input value={form.logradouro} onChange={e => setForm(f => ({ ...f, logradouro: e.target.value }))} />
            <div className="row-actions">
              <div style={{ flex: 1 }}>
                <label>Município</label>
                <input value={form.municipio} onChange={e => setForm(f => ({ ...f, municipio: e.target.value }))} />
              </div>
              <div style={{ width: 80 }}>
                <label>UF</label>
                <input maxLength={2} value={form.uf} onChange={e => setForm(f => ({ ...f, uf: e.target.value.toUpperCase() }))} />
              </div>
            </div>
            <label>Código do município (IBGE)</label>
            <input value={form.codigo_municipio_ibge} onChange={e => setForm(f => ({ ...f, codigo_municipio_ibge: e.target.value }))} />
            <label>Telefone</label>
            <input value={form.telefone} onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))} />
            <div className="modal-foot">
              <button className="btn" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : (selecionado ? 'Salvar alterações' : 'Criar transportadora')}</button>
              <button className="btn secondary" type="button" onClick={fechar}>Cancelar</button>
              {selecionado && (
                <button className="btn secondary small" type="button" style={{ marginLeft: 'auto' }} onClick={alternarAtivo}>
                  {selecionado.ativo === false ? 'Reativar' : 'Desativar'}
                </button>
              )}
            </div>
          </form>
        </FichaModal>
      )}
    </>
  );
}
