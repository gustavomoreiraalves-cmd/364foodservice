'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';
import { useCadastro } from '../../lib/cadastro';

const FORM_VAZIO = { nome: '', cnpj: '', tipo: 'Revenda', contato: '', telefone: '' };
const TIPOS = ['Revenda', 'Distribuidor', 'Food Service', 'Consumidor Final'];

export default function ClientesPage() {
  return (
    <AppShell modulo="clientes" titulo="Clientes" desc="Cadastro de clientes e revendas">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const { data } = await supabase.from('clientes').select('*').eq('empresa_id', empresaAtual.id).order('nome');
    setLista(data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  const [mostrarInativos, setMostrarInativos] = useState(false);
  const { form, setForm, editando, salvando, iniciarEdicao, cancelarEdicao, salvar, alternarAtivo, excluir } =
    useCadastro({ tabela: 'clientes', formVazio: FORM_VAZIO, empresaId: empresaAtual?.id, aoTerminar: carregar });

  const emEdicao = editando ? lista.find(c => c.id === editando) : null;
  const visiveis = mostrarInativos ? lista : lista.filter(c => c.ativo !== false);

  return (
    <>
      <div className="panel">
        <h3>{emEdicao ? `Editando: ${emEdicao.nome}` : 'Novo cliente'}</h3>
        <form onSubmit={salvar} className="form-grid">
          <div><label>Nome / Razão social</label><input required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
          <div><label>CNPJ/CPF</label><input value={form.cnpj} onChange={e => setForm({ ...form, cnpj: e.target.value })} /></div>
          <div><label>Tipo</label>
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
              {TIPOS.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div><label>Contato</label><input value={form.contato} onChange={e => setForm({ ...form, contato: e.target.value })} /></div>
          <div><label>Telefone</label><input value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} /></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="btn" type="submit" disabled={salvando}>
              {salvando ? 'Salvando…' : (editando ? 'Salvar alterações' : 'Adicionar cliente')}
            </button>
            {editando && <button className="btn secondary" type="button" onClick={cancelarEdicao}>Cancelar</button>}
          </div>
        </form>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3>Clientes cadastrados ({visiveis.length})</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
            Mostrar inativos
          </label>
        </div>
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>Tipo</th><th>CNPJ/CPF</th><th>Contato</th><th>Telefone</th><th></th></tr></thead>
              <tbody>
                {visiveis.length ? visiveis.map(c => {
                  const inativo = c.ativo === false;
                  return (
                    <tr key={c.id} style={inativo ? { opacity: 0.55 } : undefined}>
                      <td>{c.nome} {inativo && <span className="tag warn">inativo</span>}</td>
                      <td>{c.tipo || '—'}</td>
                      <td className="muted">{c.cnpj || '—'}</td>
                      <td>{c.contato || '—'}</td>
                      <td className="muted">{c.telefone || '—'}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn secondary" onClick={() => iniciarEdicao(c)}>Editar</button>
                        <button className="btn secondary" onClick={() => alternarAtivo(c)}>{inativo ? 'Reativar' : 'Desativar'}</button>
                        <button className="btn danger" onClick={() => excluir(c, `Excluir o cliente ${c.nome}?`)}>Excluir</button>
                      </td>
                    </tr>
                  );
                }) : <tr className="empty-row"><td colSpan={6}>Nenhum cliente {mostrarInativos ? 'cadastrado' : 'ativo'}.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
