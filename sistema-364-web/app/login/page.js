'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { usuarioParaEmail } from '../../lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState(null);
  const [entrando, setEntrando] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setErro(null);
    setEntrando(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: usuarioParaEmail(usuario),
      password: senha,
    });
    setEntrando(false);
    if (error) setErro('Usuário ou senha inválidos.');
    else router.replace('/');
  }

  const inputStyle = { width: '100%', padding: 10, marginBottom: 10, background: '#2f2921', border: '1px solid #413a2f', color: '#f4efe6', borderRadius: 4 };

  return (
    <main style={{ maxWidth: 380, margin: '80px auto', padding: 24 }}>
      <h1 style={{ fontSize: 22 }}>364 Foodservices</h1>
      <p style={{ color: '#c9c0af', fontSize: 13 }}>Entre com seu usuário e senha.</p>
      <form onSubmit={handleLogin}>
        <input
          required
          placeholder="Usuário"
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password"
          required
          placeholder="Senha"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          style={inputStyle}
        />
        <button type="submit" disabled={entrando} style={{ width: '100%', padding: 10, background: '#c68a2e', border: 'none', borderRadius: 4, fontWeight: 700 }}>
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>
        {erro && <p style={{ color: '#e5806c', fontSize: 12 }}>{erro}</p>}
      </form>
    </main>
  );
}
