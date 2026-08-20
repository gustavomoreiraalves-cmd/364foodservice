'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import PontoTabs from '../../../components/PontoTabs';
import PromptDialog from '../../../components/PromptDialog';
import { useEmpresaAtual } from '../../../lib/empresa';
import { MODULOS } from '../../../lib/auth';
import { formatarCpf, useIsAdmin } from '../../../lib/ponto';
import { uploadFotoColaborador, signedUrlColaborador } from '../../../lib/storage';

const FORM_VAZIO = {
  nome: '', cpf: '', data_nascimento: '', email: '', telefone: '',
  matricula: '', pis: '', cargo: '', tipo_contrato: 'clt',
  data_admissao: '', carga_horaria_semanal: '44', banco_horas: false, tolerancia_minutos: '10',
  empregador_id: '', unidade_principal_id: '', centro_custo_id: '', gestor_id: '',
  registra_ponto: true,
};

const STATUS_LABEL = { ativo: 'Ativo', afastado: 'Afastado', ferias: 'Férias', suspenso: 'Suspenso', desligado: 'Desligado' };
const BIO_LABEL = { pendente: 'Pendente', cadastrada: 'Cadastrada', bloqueada: 'Bloqueada' };

export default function ColaboradoresPage() {
  return (
    <AppShell modulo="ponto" titulo="Ponto — Colaboradores" desc="Cadastro trabalhista para controle de jornada">
      <PontoTabs />
      <Conteudo />
    </AppShell>
  );
}

// dados do colaborador -> shape do form (edição carrega os valores atuais)
function colaboradorParaForm(c) {
  return {
    nome: c.nome || '', cpf: c.cpf || '', data_nascimento: c.data_nascimento || '',
    email: c.email || '', telefone: c.telefone || '',
    matricula: c.matricula || '', pis: c.pis || '', cargo: c.cargo || '',
    tipo_contrato: c.tipo_contrato || 'clt', data_admissao: c.data_admissao || '',
    carga_horaria_semanal: c.carga_horaria_semanal ?? '44', banco_horas: !!c.banco_horas,
    tolerancia_minutos: c.tolerancia_minutos ?? '10',
    empregador_id: c.empregador_id || '', unidade_principal_id: c.unidade_principal_id || '',
    centro_custo_id: c.centro_custo_id || '', gestor_id: c.gestor_id || '',
    registra_ponto: c.registra_ponto ?? true,
  };
}

function Conteudo() {
  const { empresaAtual, empresas: empresasDisponiveis } = useEmpresaAtual();
  const isAdmin = useIsAdmin();
  const [acessoDe, setAcessoDe] = useState(null); // colaborador com painel de acesso aberto
  const [editando, setEditando] = useState(null); // colaborador com painel de edição aberto
  const [lista, setLista] = useState([]);
  const [empregadores, setEmpregadores] = useState([]);
  const [unidades, setUnidades] = useState([]);
  const [centros, setCentros] = useState([]);
  const [vinculos, setVinculos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(FORM_VAZIO);
  const [fotoFile, setFotoFile] = useState(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [pinDe, setPinDe] = useState(null); // colaborador para o qual definir PIN

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const [{ data: colabs }, { data: emps }, { data: unis }, { data: ccs }, { data: vincs }] = await Promise.all([
      supabase.from('colaboradores').select('*').eq('empresa_id', empresaAtual.id).order('nome'),
      supabase.from('empregadores').select('id, razao_social, nome_fantasia').eq('ativo', true).order('razao_social'),
      supabase.from('unidades').select('id, nome, codigo').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('nome'),
      supabase.from('centros_custo').select('id, codigo, nome').eq('empresa_id', empresaAtual.id).eq('ativo', true).order('codigo'),
      supabase.from('colaborador_unidades').select('*'),
    ]);
    setLista(colabs || []);
    setEmpregadores(emps || []);
    setUnidades(unis || []);
    setCentros(ccs || []);
    setVinculos(vincs || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  async function adicionar(e) {
    e.preventDefault();
    if (!form.empregador_id) { alert('Selecione o empregador (CNPJ). Cadastre em "Unidades e empregadores" se ainda não existir.'); return; }
    setSalvando(true);
    try {
      const payload = {
        ...form,
        cpf: form.cpf.replace(/\D/g, ''),
        empresa_id: empresaAtual.id,
        data_nascimento: form.data_nascimento || null,
        data_admissao: form.data_admissao || null,
        unidade_principal_id: form.unidade_principal_id || null,
        centro_custo_id: form.centro_custo_id || null,
        gestor_id: form.gestor_id || null,
        carga_horaria_semanal: form.carga_horaria_semanal === '' ? null : Number(form.carga_horaria_semanal),
        tolerancia_minutos: Number(form.tolerancia_minutos) || 10,
      };
      const { data, error } = await supabase.from('colaboradores').insert([payload]).select().single();
      if (error) throw error;

      if (payload.unidade_principal_id) {
        await supabase.from('colaborador_unidades').insert([{ colaborador_id: data.id, unidade_id: payload.unidade_principal_id }]);
      }
      if (fotoFile) {
        const path = await uploadFotoColaborador(empresaAtual.id, data.id, fotoFile);
        await supabase.from('colaboradores').update({ foto_cadastral_path: path }).eq('id', data.id);
      }
      setForm(FORM_VAZIO);
      setFotoFile(null);
      setMostrarForm(false);
      carregar();
    } catch (err) {
      alert('Erro ao salvar colaborador: ' + err.message);
    } finally {
      setSalvando(false);
    }
  }

  async function atualizar(e) {
    e.preventDefault();
    setSalvando(true);
    try {
      const payload = {
        ...form,
        cpf: form.cpf.replace(/\D/g, ''),
        data_nascimento: form.data_nascimento || null,
        data_admissao: form.data_admissao || null,
        unidade_principal_id: form.unidade_principal_id || null,
        centro_custo_id: form.centro_custo_id || null,
        gestor_id: form.gestor_id || null,
        carga_horaria_semanal: form.carga_horaria_semanal === '' ? null : Number(form.carga_horaria_semanal),
        tolerancia_minutos: Number(form.tolerancia_minutos) || 10,
      };
      const { error } = await supabase.from('colaboradores').update(payload).eq('id', editando.id);
      if (error) throw error;
      if (fotoFile) {
        const path = await uploadFotoColaborador(empresaAtual.id, editando.id, fotoFile);
        await supabase.from('colaboradores').update({ foto_cadastral_path: path }).eq('id', editando.id);
      }
      setEditando(null);
      setFotoFile(null);
      setForm(FORM_VAZIO);
      carregar();
    } catch (err) {
      alert('Erro ao atualizar colaborador: ' + err.message);
    } finally {
      setSalvando(false);
    }
  }

  async function mudarStatus(c, status) {
    const { error } = await supabase.from('colaboradores').update({ status, ...(status === 'desligado' ? { data_desligamento: new Date().toISOString().slice(0, 10), registra_ponto: false } : {}) }).eq('id', c.id);
    if (error) { alert('Erro: ' + error.message); return; }
    // desligamento revoga o acesso ao sistema automaticamente (login banido,
    // permissões removidas, funcionários inativados) — exigência da especificação
    if (status === 'desligado' && c.user_id) {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch('/api/ponto/colaboradores/acesso', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ colaboradorId: c.id, motivo: 'desligamento' }),
      });
      const json = await resp.json();
      alert(resp.ok
        ? 'Colaborador desligado. O login foi bloqueado e as permissões removidas.'
        : 'Colaborador desligado, mas houve erro ao revogar o acesso: ' + (json.error || ''));
    }
    carregar();
  }

  async function verFoto(c) {
    try {
      const url = await signedUrlColaborador(c.foto_cadastral_path);
      window.open(url, '_blank');
    } catch (err) {
      alert('Não foi possível abrir a foto: ' + err.message);
    }
  }

  async function definirPin(c, pin) {
    if (!/^\d{4,6}$/.test(pin)) { alert('O PIN deve ter de 4 a 6 dígitos.'); return; }
    setPinDe(null);
    const { data: { session } } = await supabase.auth.getSession();
    const resp = await fetch('/api/ponto/colaboradores/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ colaboradorId: c.id, pin }),
    });
    const json = await resp.json();
    if (!resp.ok) { alert(json.error || 'Erro ao definir PIN'); return; }
    if (!(c.metodos_permitidos || []).includes('pin')) {
      await supabase.from('colaboradores').update({ metodos_permitidos: [...(c.metodos_permitidos || []), 'pin'] }).eq('id', c.id);
      carregar();
    }
    alert('PIN definido. O colaborador pode usar matrícula + PIN no quiosque como contingência.');
  }

  async function adicionarVinculo(colaboradorId, unidadeId) {
    if (!unidadeId) return;
    const { error } = await supabase.from('colaborador_unidades').insert([{ colaborador_id: colaboradorId, unidade_id: unidadeId }]);
    if (error) { alert('Erro ao vincular unidade: ' + error.message); return; }
    carregar();
  }

  async function encerrarVinculo(v) {
    const { error } = await supabase.from('colaborador_unidades').update({ data_fim: new Date().toISOString().slice(0, 10) }).eq('id', v.id);
    if (error) { alert('Erro: ' + error.message); return; }
    carregar();
  }

  const nomeUnidade = id => unidades.find(u => u.id === id)?.nome || '—';

  if (loading) return <p className="muted">Carregando…</p>;

  return (
    <>
      <div className="panel">
        <h3>Novo colaborador</h3>
        {!mostrarForm ? (
          <button className="btn" onClick={() => setMostrarForm(true)}>Cadastrar colaborador</button>
        ) : (
          <form onSubmit={adicionar}>
            <CamposColaborador form={form} setForm={setForm} empregadores={empregadores} unidades={unidades} centros={centros}
              gestores={lista.filter(c => c.status === 'ativo')} onFoto={setFotoFile} />
            <div className="row-actions" style={{ marginTop: 14 }}>
              <button className="btn" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar colaborador'}</button>
              <button className="btn secondary" type="button" onClick={() => { setMostrarForm(false); setForm(FORM_VAZIO); }}>Cancelar</button>
            </div>
          </form>
        )}
      </div>

      {editando && (
        <div className="panel" style={{ borderColor: 'var(--amber)' }}>
          <h3>Editar colaborador — {editando.nome}</h3>
          <form onSubmit={atualizar}>
            <CamposColaborador form={form} setForm={setForm} empregadores={empregadores} unidades={unidades} centros={centros}
              gestores={lista.filter(c => c.status === 'ativo' && c.id !== editando.id)} onFoto={setFotoFile} />
            <div className="row-actions" style={{ marginTop: 14 }}>
              <button className="btn" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar alterações'}</button>
              <button className="btn secondary" type="button" onClick={() => { setEditando(null); setForm(FORM_VAZIO); setFotoFile(null); }}>Cancelar</button>
            </div>
          </form>
        </div>
      )}

      {acessoDe && (
        <AcessoPanel
          colaborador={acessoDe}
          empresasDisponiveis={empresasDisponiveis}
          aoFechar={(mudou) => { setAcessoDe(null); if (mudou) carregar(); }}
        />
      )}

      <div className="panel">
        <h3>Colaboradores ({lista.length})</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nome</th><th>Matrícula</th><th>CPF</th><th>Cargo</th><th>Unidades de ponto</th><th>Status</th><th>Biometria</th><th>Acesso</th><th></th></tr></thead>
            <tbody>
              {lista.length ? lista.map(c => {
                const meusVinculos = vinculos.filter(v => v.colaborador_id === c.id && !v.data_fim);
                return (
                  <tr key={c.id}>
                    <td>{c.nome}</td>
                    <td className="muted">{c.matricula || '—'}</td>
                    <td className="muted">{formatarCpf(c.cpf)}</td>
                    <td className="muted">{c.cargo || '—'}</td>
                    <td className="muted">
                      {meusVinculos.length ? meusVinculos.map(v => (
                        <span key={v.id} style={{ marginRight: 6 }}>
                          {nomeUnidade(v.unidade_id)}
                          <button className="btn danger" style={{ marginLeft: 4, padding: '0 5px', fontSize: 10 }} title="Encerrar vínculo" onClick={() => encerrarVinculo(v)}>×</button>
                        </span>
                      )) : '—'}
                      <select style={{ marginTop: 4, fontSize: 11 }} value="" onChange={e => adicionarVinculo(c.id, e.target.value)}>
                        <option value="">+ unidade</option>
                        {unidades.filter(u => !meusVinculos.some(v => v.unidade_id === u.id)).map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                      </select>
                    </td>
                    <td>
                      <select value={c.status} onChange={e => mudarStatus(c, e.target.value)} style={{ fontSize: 12 }}>
                        {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    </td>
                    <td>
                      {c.biometria_status === 'cadastrada' ? <span className="tag ok">{BIO_LABEL[c.biometria_status]}</span>
                        : c.biometria_status === 'bloqueada' ? <span className="tag bad">{BIO_LABEL[c.biometria_status]}</span>
                        : <span className="tag warn">{BIO_LABEL[c.biometria_status]}</span>}
                    </td>
                    <td>
                      {c.user_id ? <span className="tag ok">Tem login</span> : <span className="muted">—</span>}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button className="btn secondary small" onClick={() => { setEditando(c); setForm(colaboradorParaForm(c)); setFotoFile(null); setMostrarForm(false); }}>Editar</button>
                        {isAdmin && <button className="btn secondary small" onClick={() => setAcessoDe(c)}>Acesso</button>}
                        <Link className="btn secondary small" href={`/ponto/colaboradores/${c.id}/facial`}>Biometria facial</Link>
                        <button className="btn secondary small" onClick={() => setPinDe(c)}>PIN</button>
                        {c.foto_cadastral_path && <button className="btn secondary small" onClick={() => verFoto(c)}>Foto</button>}
                      </div>
                    </td>
                  </tr>
                );
              }) : <tr className="empty-row"><td colSpan={9}>Nenhum colaborador cadastrado nesta empresa.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          O colaborador só consegue bater ponto nas unidades vinculadas acima e após cadastrar a biometria facial.
          Desligamento bloqueia novas marcações e revoga o acesso ao sistema automaticamente.
          O botão <b>Acesso</b> (admin) gerencia login, permissões por aba e empresas — substitui a antiga tela de Usuários.
        </p>
      </div>

      {pinDe && (
        <PromptDialog
          titulo={`PIN de contingência — ${pinDe.nome}`}
          label="PIN (4 a 6 dígitos)"
          placeholder="0000"
          tipo="password"
          aoConfirmar={pin => definirPin(pinDe, pin)}
          aoCancelar={() => setPinDe(null)}
        />
      )}
    </>
  );
}

// Campos de cadastro trabalhista, reaproveitados no formulário de criação e no de edição.
function CamposColaborador({ form, setForm, empregadores, unidades, centros, gestores, onFoto }) {
  return (
    <>
      <p className="muted" style={{ fontSize: 11.5, margin: '0 0 10px' }}>Dados pessoais</p>
      <div className="form-grid">
        <div><label>Nome completo</label><input required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
        <div><label>CPF</label><input required value={formatarCpf(form.cpf)} onChange={e => setForm({ ...form, cpf: e.target.value })} placeholder="000.000.000-00" /></div>
        <div><label>Data de nascimento</label><input type="date" value={form.data_nascimento} onChange={e => setForm({ ...form, data_nascimento: e.target.value })} /></div>
        <div><label>E-mail</label><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
        <div><label>Telefone</label><input value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} /></div>
        <div><label>Foto cadastral</label><input type="file" accept="image/*" onChange={e => onFoto(e.target.files?.[0] || null)} /></div>
      </div>
      <p className="muted" style={{ fontSize: 11.5, margin: '14px 0 10px' }}>Dados trabalhistas</p>
      <div className="form-grid">
        <div><label>Empregador (CNPJ)</label>
          <select required value={form.empregador_id} onChange={e => setForm({ ...form, empregador_id: e.target.value })}>
            <option value="">— selecionar —</option>
            {empregadores.map(x => <option key={x.id} value={x.id}>{x.nome_fantasia || x.razao_social}</option>)}
          </select>
        </div>
        <div><label>Matrícula</label><input value={form.matricula} onChange={e => setForm({ ...form, matricula: e.target.value })} /></div>
        <div><label>PIS</label><input value={form.pis} onChange={e => setForm({ ...form, pis: e.target.value })} /></div>
        <div><label>Cargo</label><input value={form.cargo} onChange={e => setForm({ ...form, cargo: e.target.value })} /></div>
        <div><label>Tipo de contrato</label>
          <select value={form.tipo_contrato} onChange={e => setForm({ ...form, tipo_contrato: e.target.value })}>
            <option value="clt">CLT</option>
            <option value="estagio">Estágio</option>
            <option value="pj">PJ</option>
            <option value="temporario">Temporário</option>
            <option value="socio">Sócio</option>
          </select>
        </div>
        <div><label>Data de admissão</label><input type="date" value={form.data_admissao} onChange={e => setForm({ ...form, data_admissao: e.target.value })} /></div>
        <div><label>Carga horária semanal</label><input type="number" step="0.5" value={form.carga_horaria_semanal} onChange={e => setForm({ ...form, carga_horaria_semanal: e.target.value })} /></div>
        <div><label>Unidade principal</label>
          <select value={form.unidade_principal_id} onChange={e => setForm({ ...form, unidade_principal_id: e.target.value })}>
            <option value="">— selecionar —</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </div>
        <div><label>Centro de custo</label>
          <select value={form.centro_custo_id} onChange={e => setForm({ ...form, centro_custo_id: e.target.value })}>
            <option value="">— selecionar —</option>
            {centros.map(c => <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>)}
          </select>
        </div>
        <div><label>Gestor imediato</label>
          <select value={form.gestor_id} onChange={e => setForm({ ...form, gestor_id: e.target.value })}>
            <option value="">— selecionar —</option>
            {gestores.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 11.5, margin: '14px 0 10px' }}>Controle de ponto</p>
      <div className="form-grid">
        <div><label>Registra ponto</label>
          <select value={form.registra_ponto ? 'sim' : 'nao'} onChange={e => setForm({ ...form, registra_ponto: e.target.value === 'sim' })}>
            <option value="sim">Sim</option>
            <option value="nao">Não</option>
          </select>
        </div>
        <div><label>Banco de horas</label>
          <select value={form.banco_horas ? 'sim' : 'nao'} onChange={e => setForm({ ...form, banco_horas: e.target.value === 'sim' })}>
            <option value="nao">Não</option>
            <option value="sim">Sim</option>
          </select>
        </div>
        <div><label>Tolerância (minutos)</label><input type="number" value={form.tolerancia_minutos} onChange={e => setForm({ ...form, tolerancia_minutos: e.target.value })} /></div>
      </div>
    </>
  );
}

// Painel de acesso ao sistema: cria/vincula login, permissões por módulo,
// empresas, troca de senha e revogação. Sincroniza a tabela funcionarios
// (Responsável nas telas operacionais) a partir dos dados do colaborador.
function AcessoPanel({ colaborador, empresasDisponiveis, aoFechar }) {
  const [info, setInfo] = useState(null);      // resposta do GET
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({ usuario: '', senha: '', vincularUserId: '', admin: false, permissoes: [], empresas: [] });
  const [pedirMotivo, setPedirMotivo] = useState(false);

  async function api(method, body, query) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/ponto/colaboradores/acesso' + (query || ''), {
      method,
      headers: { Authorization: `Bearer ${session?.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erro na API');
    return json;
  }

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    api('GET', null, `?colaboradorId=${colaborador.id}`)
      .then(json => {
        if (!ativo) return;
        setInfo(json);
        if (json.acesso) {
          const admin = json.acesso.permissoes.includes('admin');
          setForm(f => ({
            ...f,
            admin,
            permissoes: json.acesso.permissoes.filter(m => m !== 'admin'),
            empresas: json.acesso.empresas,
          }));
        }
      })
      .catch(err => alert(err.message))
      .finally(() => ativo && setCarregando(false));
    return () => { ativo = false; };
  }, [colaborador.id]);

  function alternar(campo, valor) {
    setForm(f => ({
      ...f,
      [campo]: f[campo].includes(valor) ? f[campo].filter(v => v !== valor) : [...f[campo], valor],
    }));
  }

  async function salvar(e) {
    e.preventDefault();
    setSalvando(true);
    try {
      const permissoes = form.admin ? ['admin'] : form.permissoes;
      // admin enxerga todas as empresas sem usuario_empresas — não mexer nas
      // empresas nem nos funcionários dele (mesma regra da antiga tela /usuarios)
      const empresas = form.admin ? undefined : form.empresas;
      if (info?.acesso) {
        await api('PATCH', {
          colaboradorId: colaborador.id,
          senha: form.senha || undefined,
          permissoes,
          empresas,
        });
      } else {
        await api('POST', {
          colaboradorId: colaborador.id,
          usuario: form.vincularUserId ? undefined : form.usuario,
          senha: form.vincularUserId ? undefined : form.senha,
          vincularUserId: form.vincularUserId || undefined,
          permissoes,
          empresas,
        });
      }
      alert('Acesso salvo.');
      aoFechar(true);
    } catch (err) {
      alert('Erro ao salvar acesso: ' + err.message);
    } finally {
      setSalvando(false);
    }
  }

  async function revogar(motivo) {
    setPedirMotivo(false);
    try {
      await api('DELETE', { colaboradorId: colaborador.id, motivo });
      alert('Acesso revogado: login bloqueado, permissões removidas e funcionários inativados.');
      aoFechar(true);
    } catch (err) {
      alert('Erro ao revogar: ' + err.message);
    }
  }

  return (
    <div className="panel" style={{ borderColor: 'var(--amber)' }}>
      <h3>Acesso ao sistema — {colaborador.nome}</h3>
      {carregando ? <p className="muted">Carregando…</p> : (
        <form onSubmit={salvar}>
          {info?.acesso ? (
            <p style={{ fontSize: 13, marginBottom: 10 }}>
              Login: <b>{info.acesso.usuario}</b>{' '}
              {info.acesso.banido
                ? <span className="tag bad">Bloqueado</span>
                : <span className="tag ok">Ativo</span>}
            </p>
          ) : (
            <div className="form-grid">
              <div><label>Novo usuário (login)</label>
                <input value={form.usuario} disabled={!!form.vincularUserId}
                  onChange={e => setForm({ ...form, usuario: e.target.value })} placeholder="ex.: joao.silva" />
              </div>
              <div><label>Senha</label>
                <input type="password" value={form.senha} disabled={!!form.vincularUserId}
                  onChange={e => setForm({ ...form, senha: e.target.value })} placeholder="mínimo 6 caracteres" />
              </div>
              <div><label>Ou vincular login existente</label>
                <select value={form.vincularUserId} onChange={e => setForm({ ...form, vincularUserId: e.target.value })}>
                  <option value="">— criar login novo —</option>
                  {(info?.loginsDisponiveis || []).map(u => (
                    <option key={u.id} value={u.id}>{u.usuario}{u.nome ? ` (${u.nome})` : ''}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {info?.acesso && (
            <div className="form-grid" style={{ marginTop: 8 }}>
              <div><label>Nova senha (deixe vazio para manter)</label>
                <input type="password" value={form.senha} onChange={e => setForm({ ...form, senha: e.target.value })} />
              </div>
            </div>
          )}

          <p className="muted" style={{ fontSize: 11.5, margin: '14px 0 6px' }}>Permissões por aba</p>
          <label style={{ display: 'block', fontSize: 12.5, marginBottom: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.admin} onChange={e => setForm({ ...form, admin: e.target.checked })} />{' '}
            <b>Administrador</b> (todas as abas e empresas)
          </label>
          {!form.admin && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
              {MODULOS.map(m => (
                <label key={m.id} style={{ fontSize: 12.5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.permissoes.includes(m.id)} onChange={() => alternar('permissoes', m.id)} /> {m.label}
                </label>
              ))}
            </div>
          )}

          <p className="muted" style={{ fontSize: 11.5, margin: '14px 0 6px' }}>Empresas com acesso (também vira &quot;Responsável&quot; nas telas operacionais)</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
            {(empresasDisponiveis || []).map(emp => (
              <label key={emp.id} style={{ fontSize: 12.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.empresas.includes(emp.id)} onChange={() => alternar('empresas', emp.id)} /> {emp.nome}
              </label>
            ))}
          </div>

          <div className="row-actions" style={{ marginTop: 16 }}>
            <button className="btn" type="submit" disabled={salvando}>{salvando ? 'Salvando…' : (info?.acesso ? 'Salvar alterações' : 'Conceder acesso')}</button>
            {info?.acesso && <button className="btn danger" type="button" onClick={() => setPedirMotivo(true)}>Revogar acesso</button>}
            <button className="btn secondary" type="button" onClick={() => aoFechar(false)}>Fechar</button>
          </div>
        </form>
      )}

      {pedirMotivo && (
        <PromptDialog
          titulo="Motivo da revogação do acesso"
          label="Motivo"
          placeholder="Ex.: desligamento, troca de função"
          aoConfirmar={revogar}
          aoCancelar={() => setPedirMotivo(false)}
        />
      )}
    </div>
  );
}
