'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// A gestão de usuários migrou para o cadastro de colaboradores
// (Ponto → Colaboradores → botão "Acesso"). Esta rota permanece só
// para não quebrar links/bookmarks antigos.
export default function UsuariosPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/ponto/colaboradores'); }, [router]);
  return <p style={{ padding: 30 }} className="muted">A gestão de usuários agora fica em Ponto → Colaboradores. Redirecionando…</p>;
}
