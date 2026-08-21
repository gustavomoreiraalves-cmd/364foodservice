'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AppShell from '../../components/AppShell';
import { useEmpresaAtual } from '../../lib/empresa';
import { useCadastro } from '../../lib/cadastro';

const FORM_VAZIO = { nome: '', cnpj: '', categoria: 'Carnes', contato: '', telefone: '', email: '' };
const CATEGORIAS = ['Carnes', 'Temperos', 'Embalagens', 'Equipamentos', 'Serviços', 'Outros'];

// O CNPJ é gravado só com dígitos: é assim que ele vem no XML da NF-e, e é por
// igualdade exata que a importação encontra o fornecedor da nota. Fornecedor
// cadastrado como 12.345.678/0001-99 nunca casava com a nota.
const soDigitos = v => String(v || '').replace(/\D/g, '');

export default function FornecedoresPage() {
  return (
    <AppShell modulo="fornecedores" titulo="Fornecedores" desc="Cadastro de fornecedores e categorias">
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
    const { data, error } = await supabase.from('fornecedores').select('*').eq('empresa_id', empresaAtual.id).order('nome');
    if (!error) setLista(data);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  const [mostrarInativos, setMostrarInativos] = useState(false);
  const { form, setForm, editando, salvando, iniciarEdicao, cancelarEdicao, salvar, alternarAtivo, excluir } =
    useCadastro({
      tabela: 'fornecedores',
      formVazio: FORM_VAZIO,
      empresaId: empresaAtual?.id,
      aoTerminar: carregar,
      // CNPJ em branco vai como null: a coluna é opcional e string vazia não
      // passa no check de "só dígitos" da migração 23.
      paraGravar: f => ({ ...f, cnpj: soDigitos(f.cnpj) || null }),
    });

  const emEdicao = editando ? lista.find(f => f.id === editando) : null;
  const visiveis = mostrarInativos ? lista : lista.filter(f => f.ativo !== false);

  return (
    <>
      <div className="panel">
        <h3>{emEdicao ? `Editando: ${emEdicao.nome}` : 'Novo fornecedor'}</h3>
        <form onSubmit={salvar} className="form-grid">
          <div><label>Nome / Razão social</label><input required value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} /></div>
          <div><label>CNPJ</label>
            <input inputMode="numeric" maxLength={14} placeholder="Só números"
              value={form.cnpj} onChange={e => setForm({ ...form, cnpj: soDigitos(e.target.value) })} />
          </div>
          <div><label>Categoria</label>
            <select value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })}>
              {CATEGORIAS.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div><label>Contato</label><input value={form.contato} onChange={e => setForm({ ...form, contato: e.target.value })} /></div>
          <div><label>Telefone</label><input value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} /></div>
          <div><label>E-mail</label><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button className="btn" type="submit" disabled={salvando}>
              {salvando ? 'Salvando…' : (editando ? 'Salvar alterações' : 'Adicionar fornecedor')}
            </button>
            {editando && <button className="btn secondary" type="button" onClick={cancelarEdicao}>Cancelar</button>}
          </div>
        </form>
      </div>

      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3>Fornecedores cadastrados ({visiveis.length})</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={mostrarInativos} onChange={e => setMostrarInativos(e.target.checked)} />
            Mostrar inativos
          </label>
        </div>
        {loading ? <p className="muted">Carregando…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nome</th><th>Categoria</th><th>CNPJ</th><th>Contato</th><th>Telefone</th><th>E-mail</th><th></th></tr></thead>
              <tbody>
                {visiveis.length ? visiveis.map(f => {
                  const inativo = f.ativo === false;
                  return (
                    <tr key={f.id} style={inativo ? { opacity: 0.55 } : undefined}>
                      <td>{f.nome} {inativo && <span className="tag warn">inativo</span>}</td>
                      <td>{f.categoria || '—'}</td>
                      <td className="muted">{f.cnpj || '—'}</td>
                      <td>{f.contato || '—'}</td>
                      <td className="muted">{f.telefone || '—'}</td>
                      <td className="muted">{f.email || '—'}</td>
                      <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className="btn secondary" onClick={() => iniciarEdicao(f)}>Editar</button>
                        <button className="btn secondary" onClick={() => alternarAtivo(f)}>{inativo ? 'Reativar' : 'Desativar'}</button>
                        <button className="btn danger" onClick={() => excluir(f, `Excluir o fornecedor ${f.nome}?`)}>Excluir</button>
                      </td>
                    </tr>
                  );
                }) : <tr className="empty-row"><td colSpan={7}>Nenhum fornecedor {mostrarInativos ? 'cadastrado' : 'ativo'}.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
