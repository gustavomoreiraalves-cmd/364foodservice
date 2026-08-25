'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabase';

// Edição de uma conta já cadastrada. Abre ao clicar no nome dela na tabela de
// Financeiro › Contas Bancárias.
//
// `ativo` fica de fora de propósito: quem liga e desliga a conta é o botão da
// própria linha, e o mesmo controle em dois lugares é como nasce divergência.
//
// O datalist tem id próprio porque a tela de trás já tem um com as mesmas
// sugestões — dois elementos com o mesmo id é HTML inválido, e o navegador
// liga o input no primeiro que achar.
export default function ContaBancariaModal({ conta, sugestoes = [], aoSalvar, aoCancelar }) {
  const [form, setForm] = useState({
    nome: conta.nome || '',
    instituicao: conta.instituicao || '',
    tipo: conta.tipo,
    agencia: conta.agencia || '',
    numero_conta: conta.numero_conta || '',
  });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const tipoMudou = form.tipo !== conta.tipo;

  async function salvar(e) {
    e.preventDefault();
    if (!form.nome.trim()) { setErro('Dê um nome para a conta.'); return; }
    if (!form.instituicao.trim()) { setErro('Diga a instituição (ex.: Bradesco, Nubank PJ, Ailos).'); return; }
    setErro('');
    setSalvando(true);
    const { error } = await supabase.from('contas_bancarias').update({
      nome: form.nome.trim(),
      instituicao: form.instituicao.trim(),
      tipo: form.tipo,
      agencia: form.agencia.trim() || null,
      numero_conta: form.numero_conta.trim() || null,
    }).eq('id', conta.id);
    setSalvando(false);
    if (error) { setErro('Não consegui salvar: ' + error.message); return; }
    aoSalvar();
  }

  return (
    <div className="modal-backdrop" onClick={aoCancelar}>
      <div className="modal-box" style={{ width: 'min(94vw,560px)' }} onClick={e => e.stopPropagation()}>
        <p><b>Editar conta</b></p>

        <form className="form-grid" onSubmit={salvar}>
          <div>
            <label>Nome</label>
            <input autoFocus value={form.nome} placeholder="Sicoob principal"
              onChange={e => setForm({ ...form, nome: e.target.value })} />
          </div>
          <div>
            <label>Instituição</label>
            <input list="lista-instituicoes-edicao" value={form.instituicao}
              placeholder="Bradesco, Nubank PJ, Ailos…"
              onChange={e => setForm({ ...form, instituicao: e.target.value })} />
            <datalist id="lista-instituicoes-edicao">
              {sugestoes.map(i => <option key={i} value={i} />)}
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
            <input value={form.agencia}
              onChange={e => setForm({ ...form, agencia: e.target.value })} />
          </div>
          <div>
            <label>{form.tipo === 'cartao_credito' ? 'Final do cartão' : 'Número da conta'}</label>
            <input value={form.numero_conta}
              onChange={e => setForm({ ...form, numero_conta: e.target.value })} />
          </div>
        </form>

        {tipoMudou && (
          <div className="banner info" style={{ marginTop: 12 }}>
            Trocar o tipo vale só para importações novas. Os extratos e faturas que já
            foram importados nesta conta continuam como estão, e o que já foi conciliado
            não muda. O que muda é que a conta passa a aparecer no outro seletor na hora
            de importar.
          </div>
        )}

        {erro && <p style={{ color: 'var(--bad, #c0392b)', marginTop: 10 }}>{erro}</p>}

        <div className="row-actions" style={{ marginTop: 14 }}>
          <button className="btn" type="button" disabled={salvando} onClick={salvar}>
            {salvando ? 'Salvando…' : 'Salvar alterações'}
          </button>
          <button className="btn secondary" type="button" disabled={salvando} onClick={aoCancelar}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
