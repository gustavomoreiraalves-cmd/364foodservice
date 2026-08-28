'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import { useEmpresaAtual } from '../../../lib/empresa';
import {
  situacaoFiscalProduto, camposCopiaFiscal, CAMPOS_COPIA_FISCAL, gruposComRegra,
} from '../../../lib/fiscal';

// Quais produtos ainda não conseguem emitir nota — pergunta que não tinha
// resposta em tela nenhuma, e que é o impedimento atual da linha Food Service.
// A cópia de configuração vive aqui porque é a ação que a resposta pede.

export default function ProdutosFiscalPage() {
  return (
    <AppShell modulo="fiscal" titulo="Produtos — situação fiscal"
              desc="O que falta em cada produto para ele poder entrar numa nota">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const { empresaAtual } = useEmpresaAtual();
  const [loading, setLoading] = useState(true);
  const [produtos, setProdutos] = useState([]);
  const [grupos, setGrupos] = useState([]);
  const [comRegra, setComRegra] = useState(new Set());
  const [origemId, setOrigemId] = useState('');
  const [destinos, setDestinos] = useState([]);
  const [aplicando, setAplicando] = useState(false);
  const [resultado, setResultado] = useState(null);

  useEffect(() => { if (empresaAtual?.id) carregar(); /* eslint-disable-next-line */ }, [empresaAtual?.id]);

  async function carregar() {
    setLoading(true);
    const [p, g, r] = await Promise.all([
      supabase.from('produtos')
        .select('id, codigo, nome, unidade, ncm, ex_tipi, cest, origem_mercadoria, unidade_tributavel, '
          + 'fator_conversao_tributavel, grupo_tributario_id, ind_escala, cnpj_fabricante, cst_ibs_cbs, '
          + 'gtin, gtin_tributavel, sujeito_st, ativo_fiscal')
        .eq('empresa_id', empresaAtual.id).eq('ativo', true).order('codigo'),
      supabase.from('grupos_tributarios').select('id, codigo').eq('empresa_id', empresaAtual.id),
      supabase.from('regras_tributarias').select('grupo_tributario_id, ativo').eq('empresa_id', empresaAtual.id),
    ]);
    setProdutos(p.data || []);
    setGrupos(g.data || []);
    setComRegra(gruposComRegra(r.data || []));
    setLoading(false);
  }

  // situacaoFiscalProduto também marca `grupoSemRegra`: pendenciasFiscaisProduto
  // confere que existe grupo, não que exista regra para ele. Um produto pode
  // passar em todas as pendências, ser liberado, e ainda assim ser recusado na
  // emissão com "Não há regra tributária para…".
  const linhas = useMemo(() => produtos.map(p => ({
    ...p,
    ...situacaoFiscalProduto(p, comRegra),
    grupoCodigo: grupos.find(g => g.id === p.grupo_tributario_id)?.codigo || '—',
  })), [produtos, grupos, comRegra]);

  const fonte = produtos.find(p => p.id === origemId) || null;
  const payload = fonte ? camposCopiaFiscal(fonte) : null;

  function alternarDestino(id) {
    setDestinos(d => (d.includes(id) ? d.filter(x => x !== id) : [...d, id]));
  }

  async function aplicar(liberar) {
    setAplicando(true);
    setResultado(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resposta = await fetch('/api/fiscal/copiar-tributacao', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ origemId, destinoIds: destinos, liberar }),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) { setResultado({ erro: corpo.error || 'Falha ao copiar.' }); return; }
      setResultado(corpo);
      setDestinos([]);
      await carregar();
    } finally {
      setAplicando(false);
    }
  }

  if (loading) return <p className="muted">Carregando…</p>;

  const pendentes = linhas.filter(l => l.pendencias.length > 0 || l.grupoSemRegra || !l.ativo_fiscal).length;

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        {pendentes} de {linhas.length} produto(s) ainda não podem entrar numa nota.
      </p>

      <table className="tabela">
        <thead>
          <tr>
            <th></th><th>Código</th><th>Produto</th><th>NCM</th><th>CEST</th>
            <th>Grupo</th><th>Situação</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(l => (
            <tr key={l.id}>
              <td>
                <input type="checkbox" checked={destinos.includes(l.id)}
                       disabled={l.id === origemId}
                       onChange={() => alternarDestino(l.id)} />
              </td>
              <td>{l.codigo}</td>
              <td>{l.nome}</td>
              <td>{l.ncm || '—'}</td>
              <td>{l.cest || '—'}</td>
              <td>{l.grupoCodigo}</td>
              <td>
                {l.pendencias.length === 0 && !l.grupoSemRegra && l.ativo_fiscal
                  ? <span>Liberado para emissão</span>
                  : (
                    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                      {l.pendencias.map(p => <li key={p}>{p}</li>)}
                      {l.grupoSemRegra && (
                        <li>
                          o grupo {l.grupoCodigo} não tem nenhuma regra ativa — sem ela a emissão
                          é recusada mesmo com o cadastro completo
                        </li>
                      )}
                      {l.pendencias.length === 0 && !l.ativo_fiscal && (
                        <li>cadastro completo, falta liberar para emissão</li>
                      )}
                    </ul>
                  )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 24 }}>Copiar configuração fiscal</h3>
      <div className="form-grid">
        <div>
          <label>Produto de origem</label>
          <select value={origemId} onChange={e => { setOrigemId(e.target.value); setDestinos([]); }}>
            <option value="">Escolha…</option>
            {produtos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>)}
          </select>
        </div>
      </div>

      {fonte && destinos.length > 0 && (
        <>
          <p className="muted" style={{ marginTop: 12 }}>
            O que muda em cada destino. Copiar é espelhar: campo vazio na origem apaga o valor do destino.
          </p>
          <table className="tabela">
            <thead><tr><th>Destino</th><th>Campo</th><th>Hoje</th><th>Fica</th></tr></thead>
            <tbody>
              {destinos.flatMap(id => {
                const destino = produtos.find(p => p.id === id);
                return CAMPOS_COPIA_FISCAL
                  .filter(campo => String(destino?.[campo] ?? '') !== String(payload[campo] ?? ''))
                  .map(campo => {
                    const tinha = destino?.[campo] ?? null;
                    const fica = payload[campo];
                    const apaga = tinha !== null && tinha !== '' && (fica === null || fica === '');
                    return (
                      <tr key={`${id}-${campo}`}>
                        <td>{destino?.codigo}</td>
                        <td>{campo}</td>
                        <td style={apaga ? { color: 'var(--red, #d66)' } : undefined}>{String(tinha ?? '—')}</td>
                        <td>{String(fica ?? '—')}</td>
                      </tr>
                    );
                  });
              })}
            </tbody>
          </table>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn" disabled={aplicando} onClick={() => aplicar(false)}>
              {aplicando ? 'Aplicando…' : `Copiar para ${destinos.length} produto(s)`}
            </button>
            <button className="btn secondary" disabled={aplicando} onClick={() => aplicar(true)}>
              Copiar e liberar os que ficarem completos
            </button>
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
            Liberar para emissão é declarar que alguém conferiu a classificação. NCM errado
            classifica errado a operação inteira — carne salgada e farofa não têm o mesmo NCM.
          </p>
        </>
      )}

      {resultado?.erro && <p className="muted" style={{ marginTop: 12 }}>{resultado.erro}</p>}
      {resultado?.resultados && (
        <ul style={{ marginTop: 12, fontSize: 13 }}>
          {resultado.resultados.map(r => (
            <li key={r.produtoId}>
              {r.nome || r.produtoId}: {r.erro
                ? `não entrou — ${r.erro}`
                : `copiado${r.liberado ? ' e liberado' : ''}`}
              {!r.erro && !r.liberado && r.pendencias?.length
                ? ` (ainda falta: ${r.pendencias.join('; ')})`
                : ''}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
