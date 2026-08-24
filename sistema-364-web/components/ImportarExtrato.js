'use client';
import { useState } from 'react';
import { enviarArquivo } from '../lib/extratos/cliente';

// Bloco no topo da conciliação. Aceita PDF, OFX e CSV: OFX é o mais confiável
// (vem estruturado do banco), PDF é o que o colaborador tem na mão e passa
// por leitura automática, que leva alguns segundos.
export default function ImportarExtrato({ empresaId, contas, onImportado }) {
  const [contaId, setContaId] = useState('');
  const [tipo, setTipo] = useState('extrato');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  const contasDoTipo = (contas || []).filter(c => c.ativo !== false
    && (tipo === 'fatura_cartao' ? c.tipo === 'cartao_credito' : c.tipo === 'conta_corrente'));

  async function enviar(file) {
    if (!file) return;
    if (!contaId) { setErro('Escolha a conta antes de enviar o arquivo.'); return; }
    setErro('');
    setOcupado(true);
    try {
      const form = new FormData();
      form.append('arquivo', file);
      form.append('empresaId', empresaId);
      form.append('contaBancariaId', contaId);
      form.append('tipo', tipo);
      const r = await enviarArquivo('/api/financeiro/extratos/upload', form);
      const j = await r.json();
      if (!r.ok) { setErro(j.error || 'Não foi possível importar o arquivo.'); return; }
      onImportado(j);
    } catch (e) {
      setErro('Falha ao importar: ' + e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="panel">
      <strong>Importar extrato ou fatura</strong>
      <p className="muted" style={{ margin: '4px 0 10px' }}>
        PDF, OFX ou CSV. O OFX do internet banking é o mais confiável; o PDF passa por
        leitura automática e leva alguns segundos.
      </p>
      <div className="form-grid">
        <div>
          <label>Documento</label>
          <select value={tipo} disabled={ocupado}
            onChange={e => { setTipo(e.target.value); setContaId(''); }}>
            <option value="extrato">Extrato bancário</option>
            <option value="fatura_cartao">Fatura de cartão</option>
          </select>
        </div>
        <div>
          <label>Conta</label>
          <select value={contaId} disabled={ocupado} onChange={e => setContaId(e.target.value)}>
            <option value="">Escolha…</option>
            {contasDoTipo.map(c => <option key={c.id} value={c.id}>{c.nome} — {c.instituicao}</option>)}
          </select>
        </div>
        <div style={{ alignSelf: 'end' }}>
          <label className="btn">
            {ocupado ? 'Lendo o arquivo…' : 'Enviar arquivo'}
            <input type="file" accept=".pdf,.ofx,.csv,.txt,application/pdf" style={{ display: 'none' }}
              disabled={ocupado}
              onChange={e => { enviar(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
      </div>
      {!contasDoTipo.length && (
        <p className="muted" style={{ marginTop: 8 }}>
          Nenhuma conta {tipo === 'fatura_cartao' ? 'de cartão' : 'corrente'} cadastrada — cadastre
          em Financeiro › Contas Bancárias.
        </p>
      )}
      {erro && <p style={{ color: 'var(--bad, #c0392b)', marginTop: 8 }}>{erro}</p>}
    </div>
  );
}
