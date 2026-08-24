// CSV de banco não tem padrão: muda o separador, o nome das colunas e a
// ordem. Aqui a gente tenta reconhecer o cabeçalho; quando não dá, devolve
// reconhecido: false e quem chamou manda o arquivo para a IA. Preferir a IA a
// adivinhar errado — lançamento errado no financeiro custa mais que a chamada.
import { numeroBr, dataIso } from './numero.js';

const SEPARADORES = [';', ',', '\t', '|'];

const COLUNAS = {
  data: /^(data|data\s*(do)?\s*(mov|lan|opera).*|date|dt)$/i,
  valor: /^(valor|vlr|value|amount|montante|valor\s*\(r\$\))$/i,
  documento: /(documento|^doc$|n[uú]mero|checknum)/i,
  descricao: /(hist[oó]rico|descri|lan[çc]amento|memo|detalhe|description|narrative)/i,
};

function dividirLinha(linha, separador) {
  const campos = [];
  let atual = '';
  let dentroDeAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (dentroDeAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroDeAspas = !dentroDeAspas;
    } else if (c === separador && !dentroDeAspas) {
      campos.push(atual.trim()); atual = '';
    } else atual += c;
  }
  campos.push(atual.trim());
  return campos;
}

function acharCabecalho(linhas) {
  for (let i = 0; i < Math.min(linhas.length, 25); i++) {
    for (const separador of SEPARADORES) {
      const campos = dividirLinha(linhas[i], separador);
      if (campos.length < 2) continue;
      const mapa = {};
      campos.forEach((campo, indice) => {
        for (const [chave, re] of Object.entries(COLUNAS)) {
          if (mapa[chave] === undefined && re.test(campo)) {
            mapa[chave] = indice;
            break; // Cada coluna reivindica no máximo UM papel
          }
        }
      });
      if (mapa.data !== undefined && mapa.valor !== undefined) {
        return { linhaCabecalho: i, separador, mapa };
      }
    }
  }
  return null;
}

const VAZIO = {
  reconhecido: false, periodoInicio: null, periodoFim: null,
  saldoInicial: null, saldoFinal: null, total: null, lancamentos: [],
};

export function parseCsv(texto) {
  const linhas = String(texto ?? '').split(/\r?\n/).filter(l => l.trim());
  const cabecalho = acharCabecalho(linhas);
  if (!cabecalho) return { ...VAZIO };

  const { linhaCabecalho, separador, mapa } = cabecalho;
  const lancamentos = [];
  for (const linha of linhas.slice(linhaCabecalho + 1)) {
    const campos = dividirLinha(linha, separador);
    const data = dataIso(campos[mapa.data]);
    const valor = numeroBr(campos[mapa.valor]);
    if (!data || Number.isNaN(valor) || valor === 0) continue;
    const descricao = (mapa.descricao !== undefined ? campos[mapa.descricao] : '').trim();
    // Linha de saldo (do dia, anterior, final) é resumo, não movimento.
    if (/^saldo/i.test(descricao)) continue;
    lancamentos.push({
      data,
      descricao: descricao || 'SEM DESCRIÇÃO',
      valor: Math.abs(valor),
      tipo: valor < 0 ? 'saida' : 'entrada',
      documento: mapa.documento !== undefined ? (campos[mapa.documento] || null) : null,
      fitid: null,
    });
  }

  if (!lancamentos.length) return { ...VAZIO };
  const datas = lancamentos.map(l => l.data).sort();
  return {
    reconhecido: true,
    periodoInicio: datas[0],
    periodoFim: datas[datas.length - 1],
    saldoInicial: null,
    saldoFinal: null,
    total: null,
    lancamentos,
  };
}
