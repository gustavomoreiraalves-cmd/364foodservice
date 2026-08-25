'use client';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { validarLogo } from '../lib/logo';
import { uploadLogoEmpresa, urlLogoEmpresa, removerLogoEmpresa } from '../lib/storage';

// Logo da marca (atualização 42): preview + envio + remoção, dentro do bloco
// "Operações vinculadas" do cadastro da empresa. O arquivo vai para o bucket
// público 'logos' e o caminho fica em empresas.logo_path — quem lê é o
// cabeçalho da barra lateral (components/AppShell.js).
//
// `marca` = { id, nome, logo_path }. `aoMudar` recarrega a lista no pai.
export default function LogoEmpresa({ marca, aoMudar }) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  async function enviar(e) {
    const file = e.target.files?.[0] || null;
    // Zera o input: sem isso, escolher o mesmo arquivo depois de um erro não
    // dispara onChange de novo.
    e.target.value = '';
    const { ok, erro: motivo } = validarLogo(file);
    if (!ok) { setErro(motivo); return; }

    setErro('');
    setEnviando(true);
    const anterior = marca.logo_path;
    try {
      const path = await uploadLogoEmpresa(marca.id, file);
      const { error } = await supabase.from('empresas').update({ logo_path: path }).eq('id', marca.id);
      if (error) {
        // O cadastro não aceitou o caminho — tira o arquivo órfão do bucket.
        await removerLogoEmpresa(path);
        throw error;
      }
      // Só depois de o cadastro apontar para a nova é que a antiga pode sair.
      await removerLogoEmpresa(anterior);
      await aoMudar();
    } catch (erroEnvio) {
      setErro('Não foi possível enviar a logo: ' + (erroEnvio.message || erroEnvio));
    } finally {
      setEnviando(false);
    }
  }

  async function remover() {
    if (!confirm(`Remover a logo de ${marca.nome}?`)) return;
    setErro('');
    setEnviando(true);
    try {
      const { error } = await supabase.from('empresas').update({ logo_path: null }).eq('id', marca.id);
      if (error) throw error;
      await removerLogoEmpresa(marca.logo_path);
      await aoMudar();
    } catch (erroRemocao) {
      setErro('Não foi possível remover a logo: ' + (erroRemocao.message || erroRemocao));
    } finally {
      setEnviando(false);
    }
  }

  const url = urlLogoEmpresa(marca.logo_path);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      {url
        ? <img src={url} alt={`Logo de ${marca.nome}`} style={{ height: 34, width: 'auto', maxWidth: 140, objectFit: 'contain' }} />
        : <span className="muted" style={{ fontSize: 12 }}>Sem logo</span>}
      <label className="btn secondary small" style={{ cursor: enviando ? 'default' : 'pointer', marginBottom: 0 }}>
        {enviando ? 'Enviando…' : (url ? 'Trocar logo' : 'Enviar logo')}
        <input type="file" accept="image/png" onChange={enviar} disabled={enviando} style={{ display: 'none' }} />
      </label>
      {url && <button className="btn secondary small" type="button" onClick={remover} disabled={enviando}>Remover logo</button>}
      {erro && <span className="erro" style={{ fontSize: 12 }}>{erro}</span>}
    </div>
  );
}
