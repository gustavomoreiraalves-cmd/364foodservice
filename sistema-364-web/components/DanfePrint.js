'use client';
import { code128c } from '../lib/nfe/code128.js';

// DANFE — o documento que acompanha a mercadoria em trânsito. Fica oculto na
// tela e aparece só na impressão, mesma mecânica de components/FichaPrint.js.
//
// Sai como HTML impresso pelo navegador, e não como PDF gerado no servidor,
// porque o DANFE é feito para virar papel: quem precisa dele imprime, e a
// caixa de impressão já oferece "Salvar como PDF" para mandar por e-mail. Um
// puppeteer baixaria um Chromium inteiro para produzir a mesma folha.
//
// O modelo vem de lib/nfe/danfe.js, que lê o nfeProc autorizado.

// Código de barras da chave, em SVG. SVG e não canvas porque isto vai para o
// papel: vetor escala sem borrar, bitmap serrilha e o leitor da fiscalização
// erra. As larguras vêm de code128c; aqui só se desenha.
function CodigoBarras({ chave, altura = 42 }) {
  let larguras;
  try {
    larguras = code128c(chave);
  } catch {
    // Chave inválida não pode impedir o resto do papel de sair — o operador
    // ainda precisa do documento, e a chave também vai impressa por extenso.
    return null;
  }
  const total = larguras.reduce((s, n) => s + n, 0);
  const barras = [];
  let x = 0;
  larguras.forEach((w, i) => {
    if (i % 2 === 0) barras.push(<rect key={i} x={x} y="0" width={w} height={altura} />);
    x += w;
  });
  return (
    <svg className="danfe-barras" viewBox={`0 0 ${total} ${altura}`} preserveAspectRatio="none"
         role="img" aria-label={`Código de barras da chave ${chave}`}>
      {barras}
    </svg>
  );
}

function Campo({ rot, children, largo }) {
  return (
    <div style={largo ? { flex: 3 } : undefined}>
      <span>{rot}</span>
      {children}
    </div>
  );
}

export default function DanfePrint({ danfe }) {
  if (!danfe) return null;
  const d = danfe;
  const end = d.destinatario.endereco;
  const endEmit = d.emitente.endereco;

  return (
    <div className="print-area">
      <div className="danfe">
        {d.semValorFiscal && <div className="danfe-marca">SEM VALOR FISCAL</div>}

        <div className="danfe-canhoto">
          <div style={{ flex: 4 }}>
            <div className="danfe-canhoto-texto">
              RECEBEMOS DE {d.emitente.nome} OS PRODUTOS CONSTANTES DA NOTA FISCAL INDICADA AO LADO
            </div>
            <div className="danfe-canhoto-assin">
              <span>DATA DE RECEBIMENTO</span>
              <span>IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR</span>
            </div>
          </div>
          <div className="danfe-canhoto-nf">
            <b>NF-e</b>
            <div>Nº {d.numero}</div>
            <div>SÉRIE {d.serie}</div>
          </div>
        </div>

        <div className="danfe-cab">
          <div className="danfe-emit">
            <b>{d.emitente.nome}</b>
            <div>{endEmit.logradouro}, {endEmit.numero}</div>
            <div>{endEmit.bairro} — {endEmit.municipio}/{endEmit.uf}</div>
            <div>CEP {endEmit.cep}{endEmit.fone ? ` — Fone ${endEmit.fone}` : ''}</div>
          </div>
          <div className="danfe-titulo">
            <b>DANFE</b>
            <div>Documento Auxiliar da<br />Nota Fiscal Eletrônica</div>
            <div className="danfe-es">
              <span>0 - ENTRADA<br />1 - SAÍDA</span>
              <span className="danfe-es-box">{d.indicadorOperacao}</span>
            </div>
            <div><b>Nº {d.numero}</b></div>
            <div>SÉRIE {d.serie}</div>
          </div>
          <div className="danfe-chave">
            <CodigoBarras chave={d.chave} />
            <div className="danfe-chave-rot">CHAVE DE ACESSO</div>
            <div className="danfe-chave-num">{d.chaveFormatada}</div>
            <div className="danfe-chave-txt">
              Consulta de autenticidade no portal nacional da NF-e
              www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora
            </div>
          </div>
        </div>

        <div className="danfe-linha">
          <Campo rot="Natureza da operação" largo>{d.naturezaOperacao}</Campo>
          <Campo rot="Protocolo de autorização de uso" largo>
            {d.protocolo.numero} — {d.protocolo.recebidoEm}
          </Campo>
        </div>
        <div className="danfe-linha">
          <Campo rot="Inscrição estadual">{d.emitente.ie}</Campo>
          <Campo rot="Inscrição estadual do subst. trib.">&nbsp;</Campo>
          <Campo rot="CNPJ">{d.emitente.cnpj}</Campo>
        </div>

        <div className="danfe-sec">Destinatário / Remetente</div>
        <div className="danfe-linha">
          <Campo rot="Nome / Razão social" largo>{d.destinatario.nome}</Campo>
          <Campo rot="CNPJ / CPF">{d.destinatario.documento}</Campo>
          <Campo rot="Data da emissão">{d.emitidaEm}</Campo>
        </div>
        <div className="danfe-linha">
          <Campo rot="Endereço" largo>
            {end.logradouro}{end.numero ? `, ${end.numero}` : ''}{end.complemento ? ` — ${end.complemento}` : ''}
          </Campo>
          <Campo rot="Bairro">{end.bairro}</Campo>
          <Campo rot="CEP">{end.cep}</Campo>
        </div>
        <div className="danfe-linha">
          <Campo rot="Município">{end.municipio}</Campo>
          <Campo rot="UF">{end.uf}</Campo>
          <Campo rot="Fone">{end.fone || ' '}</Campo>
          <Campo rot="Inscrição estadual">{d.destinatario.ie || ' '}</Campo>
        </div>

        <div className="danfe-sec">Cálculo do imposto</div>
        <div className="danfe-linha">
          <Campo rot="Base de cálc. do ICMS">{d.totais.vBC}</Campo>
          <Campo rot="Valor do ICMS">{d.totais.vICMS}</Campo>
          <Campo rot="Base de cálc. ICMS S.T.">{d.totais.vBCST}</Campo>
          <Campo rot="Valor do ICMS subst.">{d.totais.vST}</Campo>
          <Campo rot="V. total produtos">{d.totais.vProd}</Campo>
        </div>
        <div className="danfe-linha">
          <Campo rot="Valor do frete">{d.totais.vFrete}</Campo>
          <Campo rot="Valor do seguro">{d.totais.vSeg}</Campo>
          <Campo rot="Desconto">{d.totais.vDesc}</Campo>
          <Campo rot="Outras despesas">{d.totais.vOutro}</Campo>
          <Campo rot="V. total da nota"><b>{d.totais.vNF}</b></Campo>
        </div>

        <div className="danfe-sec">Dados dos produtos / serviços</div>
        <table className="danfe-itens">
          <thead>
            <tr>
              <th>CÓDIGO</th><th>DESCRIÇÃO</th><th>NCM/SH</th><th>O/CSOSN</th><th>CFOP</th>
              <th>UN</th><th className="num">QUANT</th><th className="num">V. UNIT</th>
              <th className="num">V. TOTAL</th><th className="num">B.CÁLC ICMS</th><th className="num">V. ICMS</th>
            </tr>
          </thead>
          <tbody>
            {d.itens.map(i => (
              <tr key={i.numero}>
                <td>{i.codigo}</td>
                <td>
                  {i.descricao}
                  {i.informacaoAdicional && <div className="danfe-item-inf">{i.informacaoAdicional}</div>}
                </td>
                <td>{i.ncm}</td>
                <td>{i.origem}{i.csosn || i.cstIcms}</td>
                <td>{i.cfop}</td>
                <td>{i.unidade}</td>
                <td className="num">{i.quantidade}</td>
                <td className="num">{i.valorUnitario}</td>
                <td className="num">{i.valorTotal}</td>
                <td className="num">{i.baseIcms}</td>
                <td className="num">{i.valorIcms}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="danfe-sec">Dados adicionais</div>
        <div className="danfe-adic">{d.informacoesComplementares}</div>
      </div>
    </div>
  );
}

// Mesma mecânica de imprimirFicha: monta o documento, deixa o React pintar,
// manda imprimir e limpa quando a caixa de impressão fecha.
export function imprimirDanfe(setDanfe, danfe) {
  setDanfe(danfe);
  setTimeout(() => {
    window.addEventListener('afterprint', () => setDanfe(null), { once: true });
    window.print();
  }, 150);
}
