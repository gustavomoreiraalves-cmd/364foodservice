'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// O cadastro de funcionários foi unificado ao de colaboradores
// (Ponto → Colaboradores). Esta rota permanece só para não quebrar
// links/bookmarks antigos.
export default function FuncionariosPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/ponto/colaboradores'); }, [router]);
  return <p style={{ padding: 30 }} className="muted">O cadastro de equipe agora fica em Ponto → Colaboradores. Redirecionando…</p>;
}
