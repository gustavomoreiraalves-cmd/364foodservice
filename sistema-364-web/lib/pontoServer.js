// Helpers de servidor do módulo Ponto (usados só em app/api/ponto/*).
// Nunca importar em componentes client — usa service role key e crypto do Node.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function clienteAdmin() {
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function sha256Hex(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex');
}

// Confere que quem chama está logado e tem o módulo informado (ou é admin).
export async function autorizarModulo(request, modulo) {
  if (!serviceKey) {
    return { erro: NextResponse.json({ error: 'Configure SUPABASE_SERVICE_ROLE_KEY no .env.local.' }, { status: 500 }) };
  }
  const token = (request.headers.get('authorization') || '').replace('Bearer ', '');
  if (!token) return { erro: NextResponse.json({ error: 'Não autenticado.' }, { status: 401 }) };

  const sb = clienteAdmin();
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) return { erro: NextResponse.json({ error: 'Sessão inválida.' }, { status: 401 }) };

  const { data: perms } = await sb.from('permissoes').select('modulo').eq('user_id', user.id).in('modulo', [modulo, 'admin']);
  if (!perms?.length) return { erro: NextResponse.json({ error: 'Sem permissão para o módulo ' + modulo + '.' }, { status: 403 }) };

  return { sb, user, isAdmin: perms.some(p => p.modulo === 'admin') };
}

// Autentica um tablet quiosque pelo token de device (header x-device-token).
export async function autenticarDispositivo(request) {
  if (!serviceKey) {
    return { erro: NextResponse.json({ error: 'Configure SUPABASE_SERVICE_ROLE_KEY no .env.local.' }, { status: 500 }) };
  }
  const token = request.headers.get('x-device-token');
  if (!token) return { erro: NextResponse.json({ error: 'Dispositivo não autenticado.' }, { status: 401 }) };

  const sb = clienteAdmin();
  const { data: disp } = await sb.from('ponto_dispositivos')
    .select('*').eq('token_hash', sha256Hex(token)).maybeSingle();
  if (!disp) return { erro: NextResponse.json({ error: 'Dispositivo não reconhecido.' }, { status: 401 }) };
  if (disp.status !== 'ativo') return { erro: NextResponse.json({ error: 'Dispositivo bloqueado.' }, { status: 403 }) };

  return { sb, disp };
}

// ---------- Criptografia dos descritores biométricos (AES-256-GCM) ----------
// PONTO_BIOMETRIA_CHAVE: 32 bytes em base64 (gerar com:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
// ATENÇÃO: perder a chave = biometrias irrecuperáveis (será preciso recadastrar).

function chaveBiometria() {
  const b64 = process.env.PONTO_BIOMETRIA_CHAVE;
  if (!b64) throw new Error('Configure PONTO_BIOMETRIA_CHAVE no .env.local (32 bytes em base64).');
  const chave = Buffer.from(b64, 'base64');
  if (chave.length !== 32) throw new Error('PONTO_BIOMETRIA_CHAVE deve ter 32 bytes (base64).');
  return chave;
}

// descritor: array de 128 floats -> "iv:tag:cipher" (base64)
export function cifrarDescritor(descritor) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chaveBiometria(), iv);
  const plano = Buffer.from(Float32Array.from(descritor).buffer);
  const cifrado = Buffer.concat([cipher.update(plano), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), cifrado.toString('base64')].join(':');
}

export function decifrarDescritor(texto) {
  const [ivB64, tagB64, dadoB64] = texto.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', chaveBiometria(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plano = Buffer.concat([decipher.update(Buffer.from(dadoB64, 'base64')), decipher.final()]);
  return Array.from(new Float32Array(plano.buffer, plano.byteOffset, plano.byteLength / 4));
}

// ---------- E-mail (comprovante de marcação via Gmail/Google Workspace SMTP) ----------
let transporterEmail = null;
function transporter() {
  if (transporterEmail) return transporterEmail;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) throw new Error('Configure GMAIL_USER e GMAIL_APP_PASSWORD no .env.local.');
  transporterEmail = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });
  return transporterEmail;
}

export async function enviarEmail({ to, assunto, html }) {
  await transporter().sendMail({
    from: `"364 Grupo — Ponto" <${process.env.GMAIL_USER}>`,
    to,
    subject: assunto,
    html,
  });
}

export function mascararEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!user || !domain) return email;
  const mask = s => (s.length <= 2 ? s[0] + '*' : s[0] + '*'.repeat(s.length - 2) + s.slice(-1));
  const [domNome, ...domResto] = domain.split('.');
  return `${mask(user)}@${mask(domNome)}${domResto.length ? '.' + domResto.join('.') : ''}`;
}

// Auditoria de eventos aplicativos (não-DML), ex.: geração de token de device.
export async function auditar(sb, campos) {
  await sb.from('ponto_audit_logs').insert([{
    ator_tipo: 'sistema',
    ...campos,
    hash: sha256Hex(JSON.stringify(campos)),
  }]);
}
