'use client';
import { useState } from 'react';
import { supabase } from './supabase.js';

// Pega do registro só as chaves que o formulário conhece.
//
// Duas armadilhas que isto evita: uma coluna a mais (empresa_id, created_at)
// iria junto no update e o PostgREST recusaria; e `value={null}` transforma um
// input controlado em não-controlado no meio do caminho, que o React reclama
// no console e faz o campo parar de responder.
//
// `null` cai no padrão do formulário — não em string vazia — porque campos como
// `unidade: 'kg'` ou `validade_dias: 90` têm um padrão que faz sentido. `false`
// e `0` são valores legítimos e passam intactos.
export function camposDoFormulario(registro, formVazio) {
  const saida = {};
  for (const chave of Object.keys(formVazio)) {
    const valor = registro?.[chave];
    saida[chave] = valor === null || valor === undefined ? formVazio[chave] : valor;
  }
  return saida;
}

// O botão Desativar é o único lugar onde o estado pré-migração fica visível para
// o operador: sem a atualização 26 o PostgREST devolve PGRST204 ("Could not find
// the 'ativo' column of 'clientes' in the schema cache") ou 42703, em inglês e
// sem dizer o que fazer. Aqui isso vira uma instrução em português; qualquer
// outro erro continua aparecendo como veio, que é o que ajuda a diagnosticar.
//
// A detecção por mensagem é larga de propósito — qualquer erro que cite `ativo`
// entra no ramo da migração. Por isso o texto original vai junto mesmo quando o
// padrão casa: num falso positivo a frase erra o palpite, mas a única pista do
// que de fato aconteceu continua na tela.
export function mensagemAoAlternarAtivo(erro) {
  const codigo = erro?.code || '';
  const mensagem = erro?.message || '';
  const colunaAusente = codigo === 'PGRST204' || codigo === '42703' || /\bativo\b/i.test(mensagem);
  if (colunaAusente) {
    return 'Não foi possível mudar a situação: provavelmente a atualização 26 ainda não foi '
      + 'aplicada neste banco, então a coluna "ativo" não existe. Fale com o administrador '
      + 'do sistema.' + (mensagem ? '\n\nErro original: ' + mensagem : '');
  }
  return 'Não foi possível mudar a situação: ' + mensagem;
}

// Todo Excluir de cadastro esbarra, mais cedo ou mais tarde, numa chave
// estrangeira: o registro já tem movimento e o Postgres recusa apagá-lo. O texto
// cru ("update or delete on table \"produtos\" violates foreign key constraint
// \"producoes_internas_produto_id_fkey\" on table \"producoes_internas\"") não diz
// nem o que travou nem o que fazer. Aqui o nome da tabela que segura vira o nome
// do movimento em português, e a saída é sempre a mesma: Desativar tira o
// cadastro das listas sem apagar o histórico, que é o que a contabilidade e a
// rastreabilidade exigem que continue existindo.
const MOVIMENTO_POR_TABELA = {
  producoes_internas: 'produções internas',
  producoes: 'produções',
  producao_consumo: 'consumo de produção',
  pedido_itens: 'itens de pedido',
  pedidos: 'pedidos',
  nfe_saida_itens: 'itens de nota fiscal emitida',
  embalagem_itens: 'itens de embalagem',
  defumacao_itens: 'itens de defumação',
  recebimento_itens: 'itens de recebimento',
  recebimentos: 'recebimentos',
  contas_a_pagar: 'contas a pagar',
  stock_movements: 'movimentos de estoque',
  stock_balances: 'saldos de estoque',
  conciliacao_padroes: 'regras de conciliação bancária',
};

// A tabela que bloqueia é a última citada por `on table "..."` — a primeira é a
// do próprio cadastro que se tentou excluir.
export function movimentoQueBloqueia(mensagem) {
  const tabelas = [...String(mensagem ?? '').matchAll(/on table "([^"]+)"/g)].map(m => m[1]);
  const tabela = tabelas[tabelas.length - 1];
  return tabela ? (MOVIMENTO_POR_TABELA[tabela] || tabela.replace(/_/g, ' ')) : null;
}

// `oQue` é o nome do cadastro na tela ("produto", "cliente"), só para a frase
// sair legível. Erro que não é de FK volta como veio: o texto original é a única
// pista do que aconteceu, e um palpite errado atrapalharia mais que ajudaria.
export function mensagemAoExcluir(erro, oQue = 'cadastro') {
  const mensagem = erro?.message || '';
  const ehChaveEstrangeira = erro?.code === '23503' || /foreign key constraint/i.test(mensagem);
  if (!ehChaveEstrangeira) return `Não foi possível excluir: ${mensagem}`;
  const movimento = movimentoQueBloqueia(mensagem);
  return `Não foi possível excluir: este ${oQue} já tem ${movimento || 'movimento'} registrado, `
    + 'e o histórico não pode ser apagado. Use Desativar para tirá-lo das listas sem perder o registro.'
    + (mensagem ? '\n\nErro original: ' + mensagem : '');
}

// O PostgREST monta `?columns=` a partir das chaves do objeto enviado ao
// insert, mesmo quando o valor da chave é `undefined` — ela sobrevive ao
// JSON.stringify porque a lista de colunas é montada antes da serialização.
// Por isso `{ ...dados, empresa_id: undefined }` não "some" a coluna: vira uma
// coluna pedida que não existe em tabelas sem empresa_id (ex.: empregadores),
// e o insert falha com erro de coluna ausente. Só inclui a chave quando há um
// empresaId de fato — telas sem empresa (como Empresas/pessoa jurídica) passam
// `empresaId: undefined` a propósito.
export function linhaParaInserir(dados, empresaId) {
  return empresaId === undefined ? dados : { ...dados, empresa_id: empresaId };
}

// Comportamento comum das telas de cadastro: o mesmo formulário do topo serve
// para criar e para editar, e `editando` é o que decide entre insert e update.
//
// `paraGravar` é o ponto de extensão de cada tela — é onde número vira número e
// campo opcional em branco vira null. Sem ele, grava-se o form como está.
export function useCadastro({ tabela, formVazio, empresaId, aoTerminar, paraGravar }) {
  const [form, setForm] = useState(formVazio);
  const [editando, setEditando] = useState(null);
  const [salvando, setSalvando] = useState(false);

  function iniciarEdicao(registro) {
    setForm(camposDoFormulario(registro, formVazio));
    setEditando(registro.id);
    // O formulário fica no topo; sem rolar até ele, o clique em Editar numa
    // lista longa parece não ter feito nada.
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelarEdicao() {
    setForm(formVazio);
    setEditando(null);
  }

  async function salvar(e) {
    e.preventDefault();
    if (salvando) return;
    setSalvando(true);
    try {
      const dados = paraGravar ? paraGravar(form) : form;
      const { error } = editando
        ? await supabase.from(tabela).update(dados).eq('id', editando)
        : await supabase.from(tabela).insert([linhaParaInserir(dados, empresaId)]);
      if (error) {
        alert((editando ? 'Erro ao salvar as alterações: ' : 'Erro ao salvar: ') + error.message);
        return;
      }
      cancelarEdicao();
      await aoTerminar();
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo(registro) {
    const { error } = await supabase.from(tabela)
      .update({ ativo: !(registro.ativo !== false) }).eq('id', registro.id);
    if (error) { alert(mensagemAoAlternarAtivo(error)); return; }
    await aoTerminar();
  }

  async function excluir(registro, pergunta) {
    if (!confirm(pergunta)) return;
    const { error } = await supabase.from(tabela).delete().eq('id', registro.id);
    if (error) { alert(mensagemAoExcluir(error)); return; }
    if (editando === registro.id) cancelarEdicao();
    await aoTerminar();
  }

  return { form, setForm, editando, salvando, iniciarEdicao, cancelarEdicao, salvar, alternarAtivo, excluir };
}
