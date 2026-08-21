'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabase';

// Bloco no topo do formulário de recebimento. Nesta fase aceita o XML enviado à
// mão; a busca por chave e a caixa de entrada entram nas tarefas seguintes.
export default function ImportarNota({ empresaId, onImportado }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');

  async function comToken(url, opcoes = {}) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Sua sessão expirou. Saia e entre novamente para importar a nota.');
    return fetch(url, {
      ...opcoes,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(opcoes.headers || {}),
      },
    });
  }

  async function enviarXml(file) {
    if (!file) return;
    setErro('');
    setOcupado(true);
    try {
      const xml = await file.text();
      const r1 = await comToken('/api/nfe/upload', {
        method: 'POST',
        body: JSON.stringify({ empresaId, xml }),
      });
      const j1 = await r1.json();
      if (!r1.ok) { setErro(j1.error || 'Não foi possível enviar o XML. Tente novamente.'); return; }
      if (j1.aviso) { setErro(j1.aviso); return; }

      const r2 = await comToken(`/api/nfe/documentos/${j1.documento.chave}/preparar?empresaId=${empresaId}`);
      const j2 = await r2.json();
      if (!r2.ok) { setErro(j2.error || 'Não foi possível preparar os dados da nota. Tente novamente.'); return; }
      if (j2.jaVinculada) { setErro('Esta nota já foi lançada em outro recebimento.'); return; }
      onImportado(j2);
    } catch (e) {
      setErro('Falha ao importar: ' + e.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <strong>Importar nota fiscal</strong>
      <p className="muted" style={{ margin: '4px 0 10px' }}>
        Envie o XML da NF-e e o formulário abaixo vem preenchido.
      </p>
      <label className="btn">
        {ocupado ? 'Lendo…' : 'Enviar XML'}
        <input type="file" accept=".xml,text/xml,application/xml" style={{ display: 'none' }}
          disabled={ocupado}
          onChange={e => { enviarXml(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {erro && <p style={{ color: 'var(--bad, #c0392b)', marginTop: 8 }}>{erro}</p>}
    </div>
  );
}
