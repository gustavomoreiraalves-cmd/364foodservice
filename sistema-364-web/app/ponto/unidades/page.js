'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import PontoTabs from '../../../components/PontoTabs';
import { useEmpresaAtual } from '../../../lib/empresa';
import { useIsAdmin, formatarCnpj } from '../../../lib/ponto';

const UNIDADE_VAZIA = { nome: '', codigo: '', tipo: 'operacao', empregador_id: '', endereco: '', cidade: '', uf: '', cep: '', latitude: '', longitude: '', responsavel: '' };
const CENTRO_VAZIO = { codigo: '', nome: '' };

export default function UnidadesPage() {
  return (
    <AppShell modulo="ponto" titulo="Ponto — Unidades e empregadores" desc="Estrutura organizacional do controle de ponto">
      <PontoTabs />
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const isAdmin = useIsAdmin();
  const [empregadores, setEmpregadores] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [centros, setCentros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fUni, setFUni] = useState(UNIDADE_VAZIA);
  const [fCc, setFCc] = useState(CENTRO_VAZIO);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [{ data: emps }, { data: unis }, { data: ccs }] = await Promise.all([
      supabase.from('empregadores').select('*').order('razao_social'),
      supabase.from('unidades').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('centros_custo').select('*').eq('empresa_id', empresaAtual.id).order('codigo'),
    ]);
    setEmpregadores(emps || []);
    setUnidades(unis || []);
    setCentros(ccs || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function addUnidade(e) {
    e.preventDefault();
    const payload = {
      ...fUni,
      empresa_id: empresaAtual.id,
      empregador_id: fUni.empregador_id || null,
      latitude: fUni.latitude === '' ? null : Number(fUni.latitude),
      longitude: fUni.longitude === '' ? null : Number(fUni.longitude),
    };
    const { error } = await supabase.from('unidades').insert([payload]);
    if (error) { alert('Erro ao salvar unidade: ' + error.message); return; }
    setFUni(UNIDADE_VAZIA);
    carregar();
  }

  async function addCentro(e) {
    e.preventDefault();
    const { error } = await supabase.from('centros_custo').insert([{ ...fCc, empresa_id: empresaAtual.id }]);
    if (error) { alert('Erro ao salvar centro de custo: ' + error.message); return; }
    setFCc(CENTRO_VAZIO);
    carregar();
  }

  async function alternarAtivo(tabela, item) {
    const { error } = await supabase.from(tabela).update({ ativo: !item.ativo }).eq('id', item.id);
    if (error) alert('Erro: ' + error.message);
    carregar();
  }

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <>
      <div className="panel">
        <h3>Empregadores (CNPJ) — Grupo 364</h3>
        <p className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
          Pessoa jurídica que assina a carteira. As marcas do sistema (Steakhouse, Food Service…) são operações; o vínculo trabalhista do colaborador é com o empregador cadastrado aqui.
        </p>
        {isAdmin && (
          <p className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
            Cadastro, dados fiscais e certificado A1 ficam em <a href="/empresas">Cadastros → Empresas (CNPJ)</a>.
          </p>
        )}
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Razão social</th><th>CNPJ</th><th>Cidade/UF</th><th>Responsável legal</th><th>Situação</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {empregadores.length ? empregadores.map(emp => (
                <tr key={emp.id}>
                  <td>{emp.razao_social}{emp.nome_fantasia ? <span className="muted"> ({emp.nome_fantasia})</span> : null}</td>
                  <td className="muted">{formatarCnpj(emp.cnpj)}</td>
                  <td className="muted">{[emp.cidade, emp.uf].filter(Boolean).join('/') || '—'}</td>
                  <td className="muted">{emp.responsavel_legal || '—'}</td>
                  <td>{emp.ativo ? <span className="tag ok">Ativo</span> : <span className="tag bad">Inativo</span>}</td>
                  {isAdmin && <td><button className="btn secondary small" onClick={() => alternarAtivo('empregadores', emp)}>{emp.ativo ? 'Inativar' : 'Reativar'}</button></td>}
                </tr>
              )) : <tr className="empty-row"><td colSpan={6}>Nenhum empregador cadastrado.{isAdmin ? ' Cadastre em Empresas (CNPJ).' : ''}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Unidades operacionais — {empresaAtual?.nome}</h3>
        <p className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>
          Local físico onde o colaborador trabalha e bate ponto (o tablet do quiosque fica vinculado a uma unidade).
        </p>
        <form onSubmit={addUnidade} className="form-grid">
          <div><label>Nome</label><input required value={fUni.nome} onChange={e => setFUni({ ...fUni, nome: e.target.value })} placeholder="Ex.: Salão Steakhouse Centro" /></div>
          <div><label>Código</label><input value={fUni.codigo} onChange={e => setFUni({ ...fUni, codigo: e.target.value })} placeholder="Ex.: STK-01" /></div>
          <div><label>Tipo</label>
            <select value={fUni.tipo} onChange={e => setFUni({ ...fUni, tipo: e.target.value })}>
              <option value="matriz">Matriz</option>
              <option value="filial">Filial</option>
              <option value="operacao">Operação</option>
            </select>
          </div>
          <div><label>Empregador</label>
            <select value={fUni.empregador_id} onChange={e => setFUni({ ...fUni, empregador_id: e.target.value })}>
              <option value="">— selecionar —</option>
              {empregadores.filter(x => x.ativo).map(x => <option key={x.id} value={x.id}>{x.nome_fantasia || x.razao_social}</option>)}
            </select>
          </div>
          <div><label>Endereço</label><input value={fUni.endereco} onChange={e => setFUni({ ...fUni, endereco: e.target.value })} /></div>
          <div><label>Cidade</label><input value={fUni.cidade} onChange={e => setFUni({ ...fUni, cidade: e.target.value })} /></div>
          <div><label>UF</label><input maxLength={2} value={fUni.uf} onChange={e => setFUni({ ...fUni, uf: e.target.value.toUpperCase() })} /></div>
          <div><label>CEP</label><input value={fUni.cep} onChange={e => setFUni({ ...fUni, cep: e.target.value })} /></div>
          <div><label>Latitude</label><input value={fUni.latitude} onChange={e => setFUni({ ...fUni, latitude: e.target.value })} placeholder="-16.6869" /></div>
          <div><label>Longitude</label><input value={fUni.longitude} onChange={e => setFUni({ ...fUni, longitude: e.target.value })} placeholder="-49.2648" /></div>
          <div><label>Responsável</label><input value={fUni.responsavel} onChange={e => setFUni({ ...fUni, responsavel: e.target.value })} /></div>
          <div><button className="btn" type="submit">Adicionar unidade</button></div>
        </form>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Nome</th><th>Código</th><th>Tipo</th><th>Empregador</th><th>Cidade/UF</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {unidades.length ? unidades.map(u => (
                <tr key={u.id}>
                  <td>{u.nome}</td>
                  <td className="muted">{u.codigo || '—'}</td>
                  <td className="muted">{u.tipo}</td>
                  <td className="muted">{empregadores.find(x => x.id === u.empregador_id)?.nome_fantasia || empregadores.find(x => x.id === u.empregador_id)?.razao_social || '—'}</td>
                  <td className="muted">{[u.cidade, u.uf].filter(Boolean).join('/') || '—'}</td>
                  <td>{u.ativo ? <span className="tag ok">Ativa</span> : <span className="tag bad">Inativa</span>}</td>
                  <td><button className="btn secondary small" onClick={() => alternarAtivo('unidades', u)}>{u.ativo ? 'Inativar' : 'Reativar'}</button></td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={7}>Nenhuma unidade cadastrada para esta empresa.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h3>Centros de custo — {empresaAtual?.nome}</h3>
        <form onSubmit={addCentro} className="form-grid">
          <div><label>Código</label><input required value={fCc.codigo} onChange={e => setFCc({ ...fCc, codigo: e.target.value })} placeholder="Ex.: COZ" /></div>
          <div><label>Nome</label><input required value={fCc.nome} onChange={e => setFCc({ ...fCc, nome: e.target.value })} placeholder="Ex.: Cozinha" /></div>
          <div><button className="btn" type="submit">Adicionar centro de custo</button></div>
        </form>
        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead><tr><th>Código</th><th>Nome</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              {centros.length ? centros.map(c => (
                <tr key={c.id}>
                  <td>{c.codigo}</td>
                  <td>{c.nome}</td>
                  <td>{c.ativo ? <span className="tag ok">Ativo</span> : <span className="tag bad">Inativo</span>}</td>
                  <td><button className="btn secondary small" onClick={() => alternarAtivo('centros_custo', c)}>{c.ativo ? 'Inativar' : 'Reativar'}</button></td>
                </tr>
              )) : <tr className="empty-row"><td colSpan={4}>Nenhum centro de custo cadastrado.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
