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
    if (error) { alert('Não foi possível mudar a situação: ' + error.message); return; }
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
