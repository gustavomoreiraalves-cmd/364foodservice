'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import ContaBancariaModal from '../../../components/ContaBancariaModal';
import { useEmpresaAtual } from '../../../lib/empresa';

// Sugestões, não a lista fechada: o campo é texto livre. Cartão de crédito é o
// caso que mais precisa disso — emissor e bandeira raramente coincidem com o
// nome do banco onde fica a conta corrente.
const INSTITUICOES_SUGERIDAS = ['Sicoob', 'Cresol', 'Sicredi', 'Banco do Brasil', 'Santander', 'Bradesco'];

const VAZIO = () => ({
  nome: '', instituicao: '', tipo: 'conta_corrente', agencia: '', numero_conta: '',
});

export default function ContasBancariasPage() {
  return (
    <AppShell modulo="financeiro" titulo="Contas Bancárias"
      desc="Contas e cartões do grupo, usados na conciliação dos extratos">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [form, setForm] = useState(VAZIO());
  const [salvando, setSalvando] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState(null);

  // Sem filtro por empresa: conta de banco e cartão são do Grupo 364, não da
  // marca (atualização 45). `empresa_id` continua gravado no cadastro, mas só
  // como registro de quem cadastrou primeiro.
  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    const { data, error } = await supabase.from('contas_bancarias').select('*')
      .order('nome');
    if (error) console.error(error);
    setLista(data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  // As seis conhecidas mais o que já foi cadastrado no grupo, sem repetir.
  // Sai da lista que a tabela já carregou — nenhuma consulta a mais.
  const instituicoesSugeridas = [...new Set([
    ...INSTITUICOES_SUGERIDAS,
    ...lista.map(c => c.instituicao).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  async function salvar(e) {
    e.preventDefault();
    if (!form.nome.trim()) { alert('Dê um nome para a conta (ex.: Sicoob principal).'); return; }
    if (!form.instituicao.trim()) { alert('Diga a instituição (ex.: Bradesco, Nubank PJ, Ailos).'); return; }
    setSalvando(true);
    const { error } = await supabase.from('contas_bancarias').insert([{
      empresa_id: empresaAtual.id,
      nome: form.nome.trim(),
      instituicao: form.instituicao.trim(),
      tipo: form.tipo,
      agencia: form.agencia.trim() || null,
      numero_conta: form.numero_conta.trim() || null,
    }]);
    setSalvando(false);
    if (error) { alert('Não consegui salvar: ' + error.message); return; }
    setForm(VAZIO());
    carregar();
  }

  async function alternarAtivo(conta) {
    const { error } = await supabase.from('contas_bancarias')
      .update({ ativo: !conta.ativo }).eq('id', conta.id);
    if (error) { alert('Não consegui atualizar: ' + error.message); return; }
    carregar();
  }

  return (
    <>
      <div className="panel">
        <strong>Nova conta</strong>
        <p className="muted" style={{ marginTop: 4 }}>
          O cadastro é do grupo: a conta aparece em todas as empresas, qualquer que
          seja a que estiver selecionada aqui.
        </p>
        <form className="form-grid" onSubmit={salvar} style={{ marginTop: 10 }}>
          <div>
            <label>Nome</label>
            <input value={form.nome} placeholder="Sicoob principal"
              onChange={e => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div>
            <label>Instituição</label>
            <input list="lista-instituicoes" value={form.instituicao}
              placeholder="Bradesco, Nubank PJ, Ailos…"
              onChange={e => setForm({ ...form, instituicao: e.target.value })} />
            <datalist id="lista-instituicoes">
              {instituicoesSugeridas.map(i => <option key={i} value={i} />)}
            </datalist>
          </div>
          <div>
            <label>Tipo</label>
            <select value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
              <option value="conta_corrente">Conta corrente</option>
              <option value="cartao_credito">Cartão de crédito</option>
            </select>
          </div>
          <div>
            <label>Agência</label>
            <input value={form.agencia} onChange={e => setForm({ ...form, agencia: e.target.value })} />
          </div>
          <div>
            <label>{form.tipo === 'cartao_credito' ? 'Final do cartão' : 'Número da conta'}</label>
            <input value={form.numero_conta}
              onChange={e => setForm({ ...form, numero_conta: e.target.value })} />
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button className="btn" disabled={salvando}>{salvando ? 'Salvando…' : 'Cadastrar'}</button>
          </div>
        </form>
      </div>

      <div className="panel">
        <strong>Contas cadastradas</strong>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead>
              <tr>
                <th>Nome</th><th>Instituição</th><th>Tipo</th><th>Agência</th>
                <th>Conta / cartão</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr className="empty-row"><td colSpan={7}>Carregando…</td></tr>}
              {!loading && !lista.length && (
                <tr className="empty-row"><td colSpan={7}>
                  Nenhuma conta cadastrada no grupo. Comece pelas contas dos bancos que você usa.
                </td></tr>
              )}
              {lista.map(c => (
                <tr key={c.id}>
                  <td onClick={() => setEditando(c)} title="Clique para editar esta conta"
                    style={{ cursor: 'pointer', textDecoration: 'underline' }}>{c.nome}</td>
                  <td>{c.instituicao}</td>
                  <td>{c.tipo === 'cartao_credito' ? 'Cartão de crédito' : 'Conta corrente'}</td>
                  <td>{c.agencia || '—'}</td>
                  <td>{c.numero_conta || '—'}</td>
                  <td><span className={'tag ' + (c.ativo ? 'ok' : 'bad')}>
                    {c.ativo ? 'Ativa' : 'Inativa'}
                  </span></td>
                  <td className="row-actions">
                    <button className="btn secondary small" onClick={() => alternarAtivo(c)}>
                      {c.ativo ? 'Desativar' : 'Reativar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editando && (
        <ContaBancariaModal
          conta={editando}
          sugestoes={instituicoesSugeridas}
          aoSalvar={() => { setEditando(null); carregar(); }}
          aoCancelar={() => setEditando(null)}
        />
      )}
    </>
  );
}
