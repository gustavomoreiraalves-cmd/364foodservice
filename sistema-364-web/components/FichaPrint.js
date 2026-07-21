'use client';

// Modelo de ficha impressa (papel A4, preto no branco) para os registros
// preenchidos no sistema: recebimento, produção e pedido de venda.
// Fica oculto na tela e aparece apenas na impressão (window.print / Ctrl+P).
//
// ficha = {
//   titulo: 'Ficha de Recebimento de Mercadoria',
//   numero: 'LT-260716-001',
//   campos: [{ rot: 'Data', valor: '16/07/2026' }, ...],   // pares rótulo/valor
//   itens:  { headers: [...], rows: [[...], ...] },        // tabela opcional
//   totais: 'Total: R$ 1.234,56',                          // linha opcional
//   assinaturas: ['Responsável pelo recebimento', 'Conferido por'],
// }
export default function FichaPrint({ ficha }) {
  if (!ficha) return null;

  // agrupa os campos em pares (2 por linha da tabela)
  const linhas = [];
  for (let i = 0; i < ficha.campos.length; i += 2) {
    linhas.push(ficha.campos.slice(i, i + 2));
  }

  return (
    <div className="print-area">
      <div className="ficha">
        <div className="ficha-head">
          <div className="ficha-brand">
            <div className="num">364 FOODSERVICES</div>
            <div className="sub">Sistema de Gestão · Controle Interno</div>
          </div>
          <div className="ficha-id">
            <div className="titulo">{ficha.titulo}</div>
            <div className="numero">{ficha.numero}</div>
          </div>
        </div>

        <table className="campos">
          <tbody>
            {linhas.map((par, i) => (
              <tr key={i}>
                {par.map((c, j) => (
                  <td key={j} colSpan={par.length === 1 ? 2 : 1}>
                    <span className="rot">{c.rot}</span>
                    {c.valor || '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {ficha.itens && (
          <table className="itens">
            <thead>
              <tr>{ficha.itens.headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {ficha.itens.rows.map((row, i) => (
                <tr key={i}>{row.map((cel, j) => <td key={j}>{cel}</td>)}</tr>
              ))}
            </tbody>
          </table>
        )}

        {ficha.totais && <div className="total-linha">{ficha.totais}</div>}

        <div className="obs"><span className="rot">Observações</span></div>

        <div className="assinaturas">
          {(ficha.assinaturas || []).map((a, i) => (
            <div key={i} className="assinatura">{a}</div>
          ))}
        </div>

        <div className="ficha-foot">
          Documento emitido pelo Sistema de Gestão 364 Foodservices em {new Date().toLocaleString('pt-BR')}.
        </div>
      </div>
    </div>
  );
}

// Abre a impressão logo depois de renderizar a ficha selecionada
export function imprimirFicha(setFicha, ficha) {
  setFicha(ficha);
  setTimeout(() => window.print(), 150);
}
