'use client';
import { useState } from 'react';
import { camposCopiaFiscal, diferencasCopiaFiscal, CAMPOS_COPIA_FISCAL } from '../lib/fiscal.js';

// "Trazer a configuração fiscal de outro produto", dentro do cadastro do
// produto que vai receber. É o mesmo trabalho da tela em lote (/fiscal/produtos),
// visto do outro lado: lá se escolhe uma origem e se marcam vários destinos;
// aqui a pessoa já está no destino e busca a origem.
//
// Não grava nada: preenche o formulário aberto. Quem salva é o botão "Salvar
// dados fiscais" que já existe, com as validações que já existem — um segundo
// caminho de escrita para os mesmos campos seria um lugar a mais para divergir.
//
// ativo_fiscal não vem junto (não está em CAMPOS_COPIA_FISCAL): liberar para
// emissão é declarar que alguém conferiu a classificação, e continua sendo o
// botão separado, depois de conferir.

const ROTULOS = {
  ncm: 'NCM',
  ex_tipi: 'EX da TIPI',
  cest: 'CEST',
  origem_mercadoria: 'origem da mercadoria',
  sujeito_st: 'sujeito a substituição tributária',
  unidade_tributavel: 'unidade tributável',
  fator_conversao_tributavel: 'fator de conversão',
  grupo_tributario_id: 'grupo tributário',
  ind_escala: 'indicador de escala',
  cnpj_fabricante: 'CNPJ do fabricante',
  cst_ibs_cbs: 'CST de IBS/CBS',
};

function mostrar(valor, campo, grupos) {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (campo === 'grupo_tributario_id') {
    return grupos.find(g => g.id === valor)?.codigo || valor;
  }
  if (typeof valor === 'boolean') return valor ? 'sim' : 'não';
  return String(valor);
}

export default function CopiarFiscalDeProduto({ form, setForm, produtos = [], grupos = [], produtoAtualId }) {
  const [origemId, setOrigemId] = useState('');

  // O próprio produto fora da lista: copiar de si mesmo não faz nada e só
  // atrapalha quem procura o nome parecido logo abaixo na lista.
  const candidatos = produtos.filter(p => p.id !== produtoAtualId);
  const fonte = candidatos.find(p => p.id === origemId) || null;
  const payload = fonte ? camposCopiaFiscal(fonte) : null;
  const mudancas = fonte ? diferencasCopiaFiscal(form, payload) : [];

  function aplicar() {
    setForm({ ...form, ...payload });
    setOrigemId('');
  }

  if (!candidatos.length) return null;

  return (
    <div className="pendencias" style={{ marginBottom: 12 }}>
      <b>Trazer a configuração fiscal de outro produto</b>
      <p className="ajuda">
        Copia {CAMPOS_COPIA_FISCAL.length} campos de classificação. Não copia código de barras,
        peso, unidade de venda nem a liberação para emissão.
      </p>

      <select value={origemId} onChange={e => setOrigemId(e.target.value)} style={{ maxWidth: 420 }}>
        <option value="">Escolha o produto de origem…</option>
        {candidatos.map(p => (
          <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>
        ))}
      </select>

      {fonte && mudancas.length === 0 && (
        <p className="ajuda">
          Este produto já está igual a {fonte.codigo} em todos os campos fiscais copiáveis.
        </p>
      )}

      {fonte && mudancas.length > 0 && (
        <>
          <table className="tabela" style={{ marginTop: 8 }}>
            <thead><tr><th>Campo</th><th>Hoje</th><th>Fica</th></tr></thead>
            <tbody>
              {mudancas.map(m => (
                <tr key={m.campo}>
                  <td>{ROTULOS[m.campo] || m.campo}</td>
                  <td style={m.apaga ? { color: 'var(--red, #d66)' } : undefined}>
                    {mostrar(m.atual, m.campo, grupos)}
                  </td>
                  <td>{mostrar(m.novo, m.campo, grupos)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {mudancas.some(m => m.apaga) && (
            <p className="ajuda">
              Os campos em vermelho ficam vazios: {fonte.codigo} não tem valor neles, e copiar é
              espelhar a origem, não completar o que falta.
            </p>
          )}
          <button className="btn small" type="button" onClick={aplicar} style={{ marginTop: 8 }}>
            Trazer estes dados para o formulário
          </button>
          <p className="ajuda">
            Os campos são preenchidos aqui na tela; nada é gravado até você salvar.
          </p>
        </>
      )}
    </div>
  );
}
