'use client';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { MODULOS } from '../../lib/auth';
import AppShell from '../../components/AppShell';

// Aba exclusiva de administradores: cria e edita usuários e define quais
// abas cada um pode acessar. Requer SUPABASE_SERVICE_ROLE_KEY no .env.local.

const FORM_VAZIO = { id: null, nome: '', usuario: '', email: '', telefone: '', cpf: '', senha: '', permissoes: [], admin: false, empresas: [] };

export default function UsuariosPage() {
  return (
    <AppShell modulo="admin" titulo="Usuários" desc="Cadastro de usuários e permissões de acesso por aba">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const [lista, setLista] = useState([]);
  const [empresasDisponiveis, setEmpresasDisponiveis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);

  const editando = !!form.id;

  const api = useCallback(async (method, body) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/usuarios', {
      method,
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Erro inesperado.');
    return json;
  }, []);

  const carregar = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const { usuarios, empresasDisponiveis } = await api('GET');
      setLista(usuarios);
      setEmpresasDisponiveis(empresasDisponiveis || []);
    } catch (e) {
      setErro(e.message);
    }
    setLoading(false);
  }, [api]);

  useEffect(() => { carregar(); }, [carregar]);

  function toggleFormModulo(mod) {
    setForm(f => ({
      ...f,
      permissoes: f.permissoes.includes(mod)
        ? f.permissoes.filter(m => m !== mod)
        : [...f.permissoes, mod],
    }));
  }

  function toggleFormEmpresa(empresaId) {
    setForm(f => ({
      ...f,
      empresas: f.empresas.includes(empresaId)
        ? f.empresas.filter(e => e !== empresaId)
        : [...f.empresas, empresaId],
    }));
  }

  function iniciarEdicao(u) {
    setForm({
      id: u.id,
      nome: u.nome,
      usuario: u.usuario,
      email: u.email,
      telefone: u.telefone,
      cpf: u.cpf,
      senha: '',
      permissoes: u.permissoes.filter(m => m !== 'admin'),
      admin: u.permissoes.includes('admin'),
      empresas: u.empresas || [],
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function salvar(e) {
    e.preventDefault();
    if (!editando && form.senha.length < 6) { alert('A senha precisa ter pelo menos 6 caracteres.'); return; }
    if (editando && form.senha && form.senha.length < 6) { alert('A nova senha precisa ter pelo menos 6 caracteres.'); return; }
    setSalvando(true);
    try {
      const permissoes = form.admin ? ['admin'] : form.permissoes;
      // Admin enxerga todas as empresas automaticamente — não envia `empresas`
      // (undefined) para não mexer no que já existe de acesso explícito.
      const empresas = form.admin ? undefined : form.empresas;
      if (editando) {
        await api('PATCH', {
          id: form.id, nome: form.nome, email: form.email, telefone: form.telefone,
          cpf: form.cpf, senha: form.senha || undefined, permissoes, empresas,
        });
      } else {
        await api('POST', {
          nome: form.nome, usuario: form.usuario, email: form.email,
          telefone: form.telefone, cpf: form.cpf, senha: form.senha, permissoes, empresas,
        });
      }
      setForm(FORM_VAZIO);
      carregar();
    } catch (e2) {
      alert('Erro ao salvar: ' + e2.message);
    }
    setSalvando(false);
  }

  async function excluir(u) {
    if (!confirm(`Excluir o usuário "${u.usuario}"?`)) return;
    try {
      await api('DELETE', { id: u.id });
      if (form.id === u.id) setForm(FORM_VAZIO);
      carregar();
    } catch (e) {
      alert('Erro ao excluir: ' + e.message);
    }
  }

  return (
    <>
      <div className="panel">
        <h3>{editando ? `Editando: ${form.usuario}` : 'Novo usuário'}</h3>
        <form onSubmit={salvar}>
          <div className="form-grid">
            <div><label>Nome completo</label><input required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
            <div><label>Nome de usuário (login)</label>
              <input required disabled={editando} value={form.usuario} placeholder="ex: joao"
                onChange={e => setForm({ ...form, usuario: e.target.value })} />
            </div>
            <div><label>E-mail</label><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
            <div><label>Telefone</label><input value={form.telefone} placeholder="(11) 90000-0000" onChange={e => setForm({ ...form, telefone: e.target.value })} /></div>
            <div><label>CPF</label><input value={form.cpf} placeholder="000.000.000-00" onChange={e => setForm({ ...form, cpf: e.target.value })} /></div>
            <div><label>{editando ? 'Nova senha (deixe vazio p/ manter)' : 'Senha (mín. 6)'}</label>
              <input type="password" required={!editando} value={form.senha} onChange={e => setForm({ ...form, senha: e.target.value })} />
            </div>
          </div>

          <div style={{ margin: '16px 0 6px' }}><label>Abas de acesso</label></div>
          <label className="check-line" style={{ fontWeight: 700, color: 'var(--amber-bright)', marginRight: 16 }}>
            <input type="checkbox" checked={form.admin} onChange={e => setForm({ ...form, admin: e.target.checked })} />
            Administrador (todas as abas e empresas)
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 8, opacity: form.admin ? 0.4 : 1 }}>
            {MODULOS.map(m => (
              <label key={m.id} className="check-line">
                <input
                  type="checkbox"
                  disabled={form.admin}
                  checked={form.permissoes.includes(m.id)}
                  onChange={() => toggleFormModulo(m.id)}
                />
                {m.label}
              </label>
            ))}
          </div>

          <div style={{ margin: '16px 0 6px' }}><label>Empresas com acesso</label></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', opacity: form.admin ? 0.4 : 1 }}>
            {empresasDisponiveis.map(emp => (
              <label key={emp.id} className="check-line">
                <input
                  type="checkbox"
                  disabled={form.admin}
                  checked={form.empresas.includes(emp.id)}
                  onChange={() => toggleFormEmpresa(emp.id)}
                />
                {emp.nome}
              </label>
            ))}
          </div>

          <div className="row-actions" style={{ marginTop: 16 }}>
            <button className="btn" type="submit" disabled={salvando}>
              {salvando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Criar usuário'}
            </button>
            {editando && (
              <button type="button" className="btn secondary" onClick={() => setForm(FORM_VAZIO)}>Cancelar edição</button>
            )}
          </div>
        </form>
      </div>

      <div className="panel">
        <h3>Usuários cadastrados ({lista.length})</h3>
        {erro && <p className="erro">{erro}</p>}
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Nome completo</th><th>Usuário</th><th>E-mail</th><th>Telefone</th><th>CPF</th><th>Abas de acesso</th><th>Empresas</th><th></th></tr>
              </thead>
              <tbody>
                {lista.length ? lista.map(u => {
                  const ehAdmin = u.permissoes.includes('admin');
                  return (
                    <tr key={u.id}>
                      <td>{u.nome || '—'}</td>
                      <td>{u.usuario}</td>
                      <td className="muted">{u.email || '—'}</td>
                      <td className="muted">{u.telefone || '—'}</td>
                      <td className="muted">{u.cpf || '—'}</td>
                      <td>
                        {ehAdmin
                          ? <span className="tag warn">Administrador</span>
                          : (u.permissoes.length
                            ? u.permissoes.map(p => {
                              const m = MODULOS.find(x => x.id === p);
                              return <span key={p} className="tag ok" style={{ marginRight: 4 }}>{m ? m.label : p}</span>;
                            })
                            : <span className="muted">sem acesso</span>)}
                      </td>
                      <td>
                        {ehAdmin
                          ? <span className="muted">todas</span>
                          : (u.empresas.length
                            ? u.empresas.map(eid => {
                              const emp = empresasDisponiveis.find(x => x.id === eid);
                              return <span key={eid} className="tag ok" style={{ marginRight: 4 }}>{emp ? emp.nome : eid}</span>;
                            })
                            : <span className="muted">nenhuma</span>)}
                      </td>
                      <td>
                        <div className="row-actions">
                          <button className="btn secondary small" onClick={() => iniciarEdicao(u)}>Editar</button>
                          <button className="btn danger" onClick={() => excluir(u)}>Excluir</button>
                        </div>
                      </td>
                    </tr>
                  );
                }) : <tr className="empty-row"><td colSpan={8}>Nenhum usuário.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
