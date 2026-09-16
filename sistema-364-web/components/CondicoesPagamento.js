'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabase';

// Cadastro de condições de pagamento (empresa_id, nome, numero_parcelas,
// intervalo_dias) — atualização 53. Usado pelo pedido de venda para gerar as
// parcelas da conta a receber na emissão da NF-e (lib/nfe/emitir.js). Sem
// exclusão: uma condição referenciada por pedido antigo só pode ser
// desativada (índice condicoes_pagamento_empresa_nome_unico e a FK de
// pedidos.condicao_pagamento_id impedem apagar em segurança).
export default function CondicoesPagamento({ empresaId, condicoes, onAtualizar }) {
  const [novo, setNovo] = useState({ nome: '', numero_parcelas: 1, intervalo_dias: 0 });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function criar(e) {
    e.preventDefault();
    if (!novo.nome.trim()) { setErro('Informe um nome para a condição.'); return; }
    setSalvando(true);
    setErro('');
    const { error } = await supabase.from('condicoes_pagamento').insert([{
      empresa_id: empresaId,
      nome: novo.nome.trim(),
      numero_parcelas: Number(novo.numero_parcelas),
      intervalo_dias: Number(novo.intervalo_dias),
    }]);
    setSalvando(false);
    if (error) { setErro('Erro ao criar: ' + error.message); return; }
    setNovo({ nome: '', numero_parcelas: 1, intervalo_dias: 0 });
    onAtualizar();
  }

  async function alternarAtivo(condicao) {
    const { error } = await supabase.from('condicoes_pagamento')
      .update({ ativo: !condicao.ativo }).eq('id', condicao.id);
    if (error) { alert('Erro ao atualizar: ' + error.message); return; }
    onAtualizar();
  }

  return (
    <div className="panel">
      <h3>Condições de pagamento</h3>
      {erro && <div className="banner bad">{erro}</div>}
      <form className="form-grid" onSubmit={criar}>
        <div><label>Nome</label>
          <input type="text" required placeholder="Ex.: 30/60/90" value={novo.nome}
            onChange={e => setNovo({ ...novo, nome: e.target.value })} />
        </div>
        <div><label>Nº de parcelas</label>
          <input type="number" min="1" step="1" required value={novo.numero_parcelas}
            onChange={e => setNovo({ ...novo, numero_parcelas: e.target.value })} />
        </div>
        <div><label>Intervalo entre parcelas (dias)</label>
          <input type="number" min="0" step="1" required value={novo.intervalo_dias}
            onChange={e => setNovo({ ...novo, intervalo_dias: e.target.value })} />
        </div>
        <div><button className="btn secondary" type="submit" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Adicionar condição'}
        </button></div>
      </form>

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr><th>Nome</th><th className="num">Parcelas</th><th className="num">Intervalo (dias)</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {condicoes.length ? condicoes.map(c => (
              <tr key={c.id}>
                <td>{c.nome}</td>
                <td className="num">{c.numero_parcelas}</td>
                <td className="num">{c.intervalo_dias}</td>
                <td><span className={`tag ${c.ativo === false ? 'bad' : 'ok'}`}>{c.ativo === false ? 'Inativa' : 'Ativa'}</span></td>
                <td>
                  <button className="btn secondary small" onClick={() => alternarAtivo(c)}>
                    {c.ativo === false ? 'Reativar' : 'Desativar'}
                  </button>
                </td>
              </tr>
            )) : <tr className="empty-row"><td colSpan={5}>Nenhuma condição de pagamento cadastrada.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
