'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import AppShell from '../../../components/AppShell';
import ListaCadastro from '../../../components/ListaCadastro';
import { useEmpresaAtual } from '../../../lib/empresa';
import { fmtMoney, fmtDate } from '../../../lib/format';
import { totalPedido } from '../../../lib/pedidos';
import { SITUACAO_NOTA, montarRelatorioNotas } from '../../../lib/emissaoFiscal';
import { filtrarRegistros } from '../../../lib/listaCadastro';
import { formatarCnpj } from '../../../lib/cnpj';

const ABAS = [
  { id: 'emitida', label: 'Emitidas' },
  { id: 'pendente', label: 'Pendentes' },
  { id: 'erro', label: 'Com erro' },
];

const CAMPOS_BUSCA = ['clienteNome', 'clienteDoc', 'numeroNota', 'chaveNota'];

export default function NotasFiscaisPage() {
  return (
    <AppShell modulo="fiscal" titulo="Notas fiscais" desc="Notas emitidas, pendentes e com erro da empresa selecionada">
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const router = useRouter();
  const { empresaAtual } = useEmpresaAtual();
  const [linhas, setLinhas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erroCarregar, setErroCarregar] = useState('');
  const [aba, setAba] = useState('pendente');
  const [busca, setBusca] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    setErroCarregar('');
    const eid = empresaAtual.id;
    // Mesma regra de "pedido relevante para nota fiscal" de
    // app/pedidos/[id]/page.js: Faturado é quem libera a emissão, Enviado é o
    // mesmo pedido depois de despachado — a nota (se existir) continua sendo
    // dele. Cancelado com nota já emitida antes do cancelamento é uma borda
    // rara que fica de fora por ora.
    const [{ data: pedidos, error: ePed }, { data: notas, error: eNota }] = await Promise.all([
      supabase.from('pedidos')
        .select('id, data, status, clientes(nome, cnpj), pedido_itens(quantidade, preco_unitario)')
        .eq('empresa_id', eid).in('status', ['Faturado', 'Enviado'])
        .order('data', { ascending: false }),
      supabase.from('nfe_saida_documentos')
        .select('id, pedido_id, status, modelo, serie, numero, chave, valor_total, motivo_rejeicao, emitida_em, created_at')
        .eq('empresa_id', eid)
        .order('created_at', { ascending: false }),
    ]);
    if (ePed || eNota) { setErroCarregar((ePed || eNota).message); setLoading(false); return; }
    setLinhas(montarRelatorioNotas(pedidos || [], notas || []));
    setLoading(false);
  }

  useEffect(() => { carregar(); /* eslint-disable-next-line */ }, [empresaAtual?.id]);

  const registros = useMemo(() => linhas.map(l => ({
    id: l.pedido.id,
    data: l.pedido.data,
    clienteNome: l.pedido.clientes?.nome || '',
    clienteDoc: l.pedido.clientes?.cnpj || '',
    bucket: l.bucket,
    nota: l.nota,
    numeroNota: l.nota?.numero != null ? String(l.nota.numero) : '',
    chaveNota: l.nota?.chave || '',
    valor: l.nota?.valor_total ?? totalPedido(l.pedido.pedido_itens),
  })), [linhas]);

  const contagens = useMemo(() => ABAS.reduce((c, a) => ({ ...c, [a.id]: registros.filter(r => r.bucket === a.id).length }), {}), [registros]);

  const noPeriodo = useMemo(() => registros.filter(r => (!de || r.data >= de) && (!ate || r.data <= ate)), [registros, de, ate]);
  const daAba = useMemo(() => noPeriodo.filter(r => r.bucket === aba), [noPeriodo, aba]);
  const visiveis = useMemo(
    () => filtrarRegistros(daAba, { campos: CAMPOS_BUSCA, busca, mostrarInativos: true }),
    [daAba, busca],
  );

  const COLUNAS = [
    { titulo: 'Data', largura: 92, render: r => fmtDate(r.data), textoPuro: r => fmtDate(r.data) },
    { titulo: 'Cliente', principal: true, minimo: 200, render: r => r.clienteNome || null, textoPuro: r => r.clienteNome },
    { titulo: 'CNPJ', largura: 132, mono: true, render: r => (r.clienteDoc ? formatarCnpj(r.clienteDoc) : null), textoPuro: r => r.clienteDoc },
    {
      titulo: 'Nº Nota', largura: 90, mono: true, alinhamento: 'right',
      render: r => (r.nota?.numero != null ? `${r.nota.numero}/${r.nota.serie}` : null),
      textoPuro: r => (r.nota?.numero != null ? `${r.nota.numero}/${r.nota.serie}` : ''),
    },
    {
      titulo: 'Situação', largura: 190,
      render: r => {
        const s = r.nota ? SITUACAO_NOTA[r.nota.status] : null;
        return <span className={`tag ${s ? s.classe : 'neutro'}`}>{s ? s.rotulo : 'Não emitida'}</span>;
      },
      textoPuro: r => (r.nota ? (SITUACAO_NOTA[r.nota.status]?.rotulo || r.nota.status) : 'Não emitida'),
    },
    {
      titulo: 'Motivo', largura: 220,
      render: r => r.nota?.motivo_rejeicao || null,
      textoPuro: r => r.nota?.motivo_rejeicao || '',
    },
    { titulo: 'Valor', largura: 110, alinhamento: 'right', render: r => fmtMoney(r.valor), textoPuro: r => fmtMoney(r.valor) },
  ];

  if (!empresaAtual) return <p className="muted">Carregando empresa…</p>;
  if (loading) return <p className="muted">Carregando…</p>;
  if (erroCarregar) return <p className="erro">{erroCarregar}</p>;

  return (
    <section className="panel">
      <div className="ponto-tabs">
        {ABAS.map(a => (
          <button key={a.id} type="button"
                  className={'ponto-tab' + (aba === a.id ? ' ativo' : '')}
                  onClick={() => setAba(a.id)}>
            {a.label} ({contagens[a.id] ?? 0})
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <div style={{ flex: 1, minWidth: 200 }}>
          <label htmlFor="busca-nota">Buscar</label>
          <input id="busca-nota" value={busca} placeholder="cliente, CNPJ, número ou chave da nota"
                 onChange={e => setBusca(e.target.value)} />
        </div>
        <div>
          <label htmlFor="nota-de">De</label>
          <input id="nota-de" type="date" value={de} onChange={e => setDe(e.target.value)} />
        </div>
        <div>
          <label htmlFor="nota-ate">Até</label>
          <input id="nota-ate" type="date" value={ate} onChange={e => setAte(e.target.value)} />
        </div>
      </div>

      <div style={{ marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 11.5 }}>
          {visiveis.length} de {daAba.length} pedido{daAba.length === 1 ? '' : 's'}
        </span>
      </div>

      <ListaCadastro
        colunas={COLUNAS} registros={visiveis} onAbrir={r => router.push(`/pedidos/${r.id}`)}
        rotulo="Notas fiscais"
        vazio={busca || de || ate
          ? 'Nenhum pedido encontrado para esse filtro.'
          : (aba === 'pendente' ? 'Nenhum pedido faturado pendente de nota.' : aba === 'erro' ? 'Nenhuma nota com erro.' : 'Nenhuma nota emitida ainda.')} />
    </section>
  );
}
