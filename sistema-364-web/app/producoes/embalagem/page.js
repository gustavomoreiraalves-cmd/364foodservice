'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { hoje, fmtDate } from '../../../lib/format';
import { proximaFichaEmbalagem, prefixoFichaEmbalagem } from '../../../lib/embalagem';
import AppShell from '../../../components/AppShell';
import ProducaoTabs from '../../../components/ProducaoTabs';
import { useEmpresaAtual } from '../../../lib/empresa';

const STATUS_LABELS = {
  rascunho: 'Rascunho',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
};

const STATUS_TAG = {
  rascunho: 'warn',
  finalizada: 'ok',
  cancelada: 'bad',
};

export default function EmbalagemPage() {
  return (
    <AppShell modulo="producoes" titulo="Embalagem" desc="Ficha de embalagem: peso defumado vira produto acabado com lote e validade">
      <ProducaoTabs />
      <Conteudo />
    </AppShell>
  );
}

function Conteudo() {
  const router = useRouter();
  const { empresaAtual } = useEmpresaAtual();
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erroCarregar, setErroCarregar] = useState('');
  const [criando, setCriando] = useState(false);
  const [erroCriar, setErroCriar] = useState('');

  async function carregar() {
    if (!empresaAtual) return;
    setLoading(true);
    setErroCarregar('');
    const eid = empresaAtual.id;
    // `funcionarios!embalagens_responsavel_id_fkey`: desde a atualização 30,
    // `embalagens` tem duas FKs para `funcionarios` (responsavel_id e
    // cancelada_por_id), então `funcionarios(nome)` sem qualificação devolve
    // PGRST201 (ambíguo). Nome confirmado no banco de produção (select conname
    // from pg_constraint where conrelid = 'public.embalagens'::regclass):
    // `responsavel_id` já usa `embalagens_responsavel_id_fkey` desde a criação
    // da tabela (atualização 08); `cancelada_por_id`, adicionado pela
    // atualização 30 com `references public.funcionarios(id)` inline, segue a
    // convenção padrão do Postgres (<tabela>_<coluna>_fkey) e nasce
    // `embalagens_cancelada_por_id_fkey` — mesmo padrão já visto em
    // `defumacoes_cancelada_por_id_fkey`. Mesmo caso resolvido em
    // app/producoes/defumacao/page.js.
    const { data, error } = await supabase
      .from('embalagens')
      .select('*, funcionarios!embalagens_responsavel_id_fkey(nome), embalagem_itens(quantidade, peso_total_kg, produtos(nome))')
      .eq('empresa_id', eid)
      .order('data', { ascending: false });

    if (error) {
      setErroCarregar(error.message);
      setLoading(false);
      return;
    }
    setLista(data || []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, [empresaAtual?.id]);

  // Mesmo raciocínio de app/producoes/defumacao/page.js: o número da ficha vem
  // do maior sufixo já usado dentre as fichas cujo LOTE começa com o prefixo de
  // hoje (EMB-AAMMDD-), nunca da contagem nem da coluna `data` da ficha. `data`
  // é editável em rascunho, e ancorar a busca em `.eq('data', dataHoje)` faz uma
  // ficha editada sair do filtro do dia em que nasceu — o próximo número repete
  // o dela e todo insert seguinte, inclusive os retries abaixo, esbarra na
  // constraint de unicidade com uma colisão que não é a colisão de verdade.
  // A consulta é refeita a cada tentativa: se duas pessoas clicam "Nova ficha"
  // ao mesmo tempo, a segunda tentativa já enxerga a ficha que a primeira
  // acabou de gravar.
  async function buscarFichasDoPrefixo(eid, prefixo) {
    const { data, error } = await supabase
      .from('embalagens')
      .select('lote')
      .eq('empresa_id', eid)
      .like('lote', `${prefixo}%`);
    if (error) throw error;
    return data || [];
  }

  async function novaFicha() {
    if (!empresaAtual || criando) return;
    setCriando(true);
    setErroCriar('');
    const eid = empresaAtual.id;
    const dataHoje = hoje();
    const prefixo = prefixoFichaEmbalagem(dataHoje);
    const MAX_TENTATIVAS = 3;
    try {
      for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
        const fichasDoPrefixo = await buscarFichasDoPrefixo(eid, prefixo);
        const numero = proximaFichaEmbalagem(dataHoje, fichasDoPrefixo);
        const { data, error } = await supabase
          .from('embalagens')
          .insert([{ lote: numero, data: dataHoje, status: 'rascunho', empresa_id: eid }])
          .select('id')
          .single();

        if (!error) {
          router.push(`/producoes/embalagem/${data.id}`);
          return;
        }
        // 23505 = unique_violation: outra ficha levou o mesmo número entre a
        // consulta acima e este insert. Tenta de novo com um número
        // recém-conferido em vez de vazar o erro cru do Postgres.
        if (error.code !== '23505') throw error;
      }
      setErroCriar('Duas fichas foram criadas ao mesmo tempo e o número colidiu de novo. Tente mais uma vez.');
    } catch (e) {
      setErroCriar('Não foi possível criar a ficha: ' + e.message);
    } finally {
      setCriando(false);
    }
  }

  if (loading) return <p className="muted">Carregando…</p>;

  if (erroCarregar) {
    return (
      <div className="banner bad">
        Não foi possível carregar as fichas de embalagem: {erroCarregar}{' '}
        <button className="btn secondary small" onClick={carregar}>Tentar novamente</button>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Fichas de embalagem</h3>
          <button className="btn" onClick={novaFicha} disabled={criando}>
            {criando ? 'Criando…' : '+ Nova ficha de embalagem'}
          </button>
        </div>

        {erroCriar && (
          <div className="banner bad" style={{ marginTop: 10 }}>
            {erroCriar}{' '}
            <button className="btn secondary small" onClick={novaFicha}>Tentar de novo</button>
          </div>
        )}

        <div className="table-wrap" style={{ marginTop: 14 }}>
          <table>
            <thead>
              <tr>
                <th>Ficha</th><th>Data</th><th>Responsável</th>
                <th>Produtos embalados</th><th>Unidades</th><th>Peso total</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lista.length ? lista.map(f => {
                const itens = f.embalagem_itens || [];
                const produtosNomes = [...new Set(itens.map(i => i.produtos?.nome).filter(Boolean))];
                const unidades = itens.reduce((s, i) => s + (Number(i.quantidade) || 0), 0);
                const pesoTotal = itens.reduce((s, i) => s + (Number(i.peso_total_kg) || 0), 0);
                return (
                  <tr key={f.id} onClick={() => router.push(`/producoes/embalagem/${f.id}`)} style={{ cursor: 'pointer' }}>
                    <td>{f.lote}</td>
                    <td className="muted">{fmtDate(f.data)}</td>
                    <td>{f.funcionarios?.nome || '—'}</td>
                    <td>{produtosNomes.length ? produtosNomes.join(', ') : '—'}</td>
                    <td className="num">{unidades || '—'}</td>
                    <td className="num">{pesoTotal ? `${pesoTotal.toFixed(3)} kg` : '—'}</td>
                    <td>
                      <span className={`tag ${STATUS_TAG[f.status] || ''}`}
                        title={f.status === 'cancelada' ? f.cancelada_motivo || undefined : undefined}>
                        {STATUS_LABELS[f.status] || f.status}
                      </span>
                    </td>
                  </tr>
                );
              }) : <tr className="empty-row"><td colSpan={7}>Nenhuma ficha de embalagem lançada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
