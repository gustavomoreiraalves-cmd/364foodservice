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
        : await supabase.from(tabela).insert([{ ...dados, empresa_id: empresaId }]);
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
    if (error) {
      alert('Não foi possível excluir: ' + error.message
        + '\n\nSe este cadastro já tem movimento, use Desativar em vez de Excluir.');
      return;
    }
    if (editando === registro.id) cancelarEdicao();
    await aoTerminar();
  }

  return { form, setForm, editando, salvando, iniciarEdicao, cancelarEdicao, salvar, alternarAtivo, excluir };
}
