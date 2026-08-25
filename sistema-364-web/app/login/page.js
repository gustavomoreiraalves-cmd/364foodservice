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

  const campoStyle = { marginBottom: 10 };

  return (
    <main className="centro">
      <h1 style={{ fontSize: 22 }}>364 Foodservices</h1>
      <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Entre com seu usuário e senha.</p>
      <form onSubmit={handleLogin}>
        <input
          required
          placeholder="Usuário"
          value={usuario}
          onChange={(e) => setUsuario(e.target.value)}
          style={campoStyle}
        />
        <input
          type="password"
          required
          placeholder="Senha"
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          style={campoStyle}
        />
        <button className="btn" type="submit" disabled={entrando} style={{ width: '100%', padding: 10 }}>
          {entrando ? 'Entrando…' : 'Entrar'}
        </button>
        {erro && <p className="erro" style={{ fontSize: 12 }}>{erro}</p>}
      </form>
    </main>
  );
}
