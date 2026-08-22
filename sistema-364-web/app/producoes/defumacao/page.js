'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';
import { hoje, fmtDate } from '../../../lib/format';
import { condicaoRendimento, proximaFicha, prefixoFicha, rendimentoDaFicha } from '../../../lib/defumacao';
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

function fmtHora(h) {
  return h ? String(h).slice(0, 5) : '—';
}

export default function DefumacaoPage() {
  return (
    <AppShell modulo="producoes" titulo="Defumação" desc="Ficha de defumação: rendimento e rastro por lote de matéria-prima">
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
    // `funcionarios!defumacoes_responsavel_id_fkey`: desde a atualização 29,
    // `defumacoes` tem duas FKs para `funcionarios` (responsavel_id e
    // cancelada_por_id), então `funcionarios(nome)` sem qualificação devolve
    // PGRST201 (ambíguo). O nome da constraint desambigua — mesmo padrão de
    // app/pedidos/[id]/page.js para responsavel_id x cancelado_por_id.
    const { data, error } = await supabase
      .from('defumacoes')
      .select('*, funcionarios!defumacoes_responsavel_id_fkey(nome), defumacao_itens(peso_bruto_kg, peso_final_kg)')
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

  // Número da ficha vem do maior sufixo já usado dentre as fichas cujo LOTE
  // começa com o prefixo de hoje (DEF-AAMMDD-), nunca da contagem — que
  // repete número assim que uma ficha some — nem da coluna `data` da ficha
  // (ver comentário de prefixoFicha em lib/defumacao.js). `data` é editável
  // em rascunho e é comum o lançamento acontecer no dia seguinte à
  // defumação: filtrar por `.eq('data', dataHoje)` faz uma ficha editada
  // sair do filtro do dia em que nasceu, `proximaFicha` repete o número dela
  // (a mesma DEF-AAMMDD-001), e todo insert seguinte — inclusive as
  // tentativas de retry abaixo — bate na constraint de unicidade e falha com
  // uma mensagem de colisão que não é a colisão de verdade. Filtrando pelo
  // prefixo do LOTE em vez da `data`, a numeração fica desacoplada do campo
  // editável. A consulta é refeita a cada tentativa: se duas pessoas clicam
  // "Nova ficha" ao mesmo tempo, a segunda tentativa já enxerga a ficha que a
  // primeira acabou de gravar.
  async function buscarFichasDoPrefixo(eid, prefixo) {
    const { data, error } = await supabase
      .from('defumacoes')
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
    const prefixo = prefixoFicha(dataHoje);
    const MAX_TENTATIVAS = 3;
    try {
      for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
        const fichasDoPrefixo = await buscarFichasDoPrefixo(eid, prefixo);
        const numero = proximaFicha(dataHoje, fichasDoPrefixo);
        const { data, error } = await supabase
          .from('defumacoes')
          .insert([{ lote: numero, data: dataHoje, status: 'rascunho', empresa_id: eid }])
          .select('id')
          .single();

        if (!error) {
          router.push(`/producoes/defumacao/${data.id}`);
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
        Não foi possível carregar as fichas de defumação: {erroCarregar}{' '}
        <button className="btn secondary small" onClick={carregar}>Tentar novamente</button>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Fichas de defumação</h3>
          <button className="btn" onClick={novaFicha} disabled={criando}>
            {criando ? 'Criando…' : '+ Nova ficha de defumação'}
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
                <th>Ficha</th><th>Data</th><th>Horário</th><th>Temp.</th>
                <th>Responsável</th><th>Matérias-primas</th><th>Rendimento</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {lista.length ? lista.map(f => {
                const itens = f.defumacao_itens || [];
                // Mesma conta que a ficha usa (rendimentoDaFicha, em
                // lib/defumacao.js): só pareia bruto e final dos itens já
                // pesados. Somar o bruto de TODOS os itens contra o final só
                // dos pesados (o que esta lista fazia antes) inflava o
                // denominador sem contrapartida no numerador — numa ficha
                // com um item pesado e outro ainda não, a lista mostrava um
                // rendimento bem menor do que a ficha mostrava no mesmo
                // instante.
                const r = rendimentoDaFicha(itens);
                const cond = condicaoRendimento(r);
                return (
                  <tr key={f.id} onClick={() => router.push(`/producoes/defumacao/${f.id}`)} style={{ cursor: 'pointer' }}>
                    <td>{f.lote}</td>
                    <td className="muted">{fmtDate(f.data)}</td>
                    <td className="muted">{fmtHora(f.hora_inicio)}–{fmtHora(f.hora_fim)}</td>
                    <td className="num">{f.temperatura_c != null ? `${f.temperatura_c} °C` : '—'}</td>
                    <td>{f.funcionarios?.nome || '—'}</td>
                    <td className="num">{itens.length}</td>
                    <td>
                      <span style={{ color: cond.cor, fontWeight: 600, fontSize: 12.5 }}>
                        {r === null ? '—' : `${(r * 100).toFixed(1)}%`}
                      </span>
                    </td>
                    <td>
                      <span className={`tag ${STATUS_TAG[f.status] || ''}`}
                        title={f.status === 'cancelada' ? f.cancelada_motivo || undefined : undefined}>
                        {STATUS_LABELS[f.status] || f.status}
                      </span>
                    </td>
                  </tr>
                );
              }) : <tr className="empty-row"><td colSpan={8}>Nenhuma ficha de defumação lançada.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
