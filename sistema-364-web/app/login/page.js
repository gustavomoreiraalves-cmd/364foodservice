'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { usuarioParaEmail } from '../../lib/auth';
import { dataPorExtenso } from '../../lib/formatacao';

const MARCAS = 'Steakhouse · Afya · Foodservices · Buffet & Eventos';

export default function LoginPage() {
  const router = useRouter();
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState(null);
  const [entrando, setEntrando] = useState(false);
  const [hoje, setHoje] = useState('');

  // A data é do relógio do usuário, não do servidor: preenchida depois da
  // montagem para o HTML servido e o renderizado baterem (o servidor está em
  // outro fuso e, perto da virada do dia, mostraria outra data).
  useEffect(() => { setHoje(dataPorExtenso(new Date())); }, []);

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
    <main className="centro login">
      {/* Logo do grupo servida do próprio repositório: a tela de login não tem
          sessão, e a logo cadastrada por marca (empresas.logo_path) só é
          legível autenticado. */}
      <img className="login-logo" src="/logo-364.png" alt="Grupo 364" />
      <h1>Bem-vindo ao Grupo 364</h1>
      <p className="login-marcas">{MARCAS}</p>
      <p className="login-data">{hoje || ' '}</p>
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
