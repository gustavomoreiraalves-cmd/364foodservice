'use client';
// As rotas do financeiro usam service role e exigem o token da sessão no
// header. Mesmo padrão do comToken de components/ImportarNota.js, extraído
// aqui porque agora são três telas chamando.
import { supabase } from '../supabase';

async function token() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sua sessão expirou. Saia e entre novamente.');
  return session.access_token;
}

export async function chamarApi(url, opcoes = {}) {
  return fetch(url, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await token()}`,
      ...(opcoes.headers || {}),
    },
  });
}

// FormData define o próprio Content-Type (com o boundary) — não sobrescrever.
export async function enviarArquivo(url, formData) {
  return fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await token()}` },
    body: formData,
  });
}
