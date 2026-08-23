// Certificado digital A1: cifra, decifra e lê o .pfx. Só servidor (rotas de
// app/api/empresas/*): usa a chave CERTIFICADO_CHAVE e crypto do Node.
// Nunca importar em componente client.
//
// CERTIFICADO_CHAVE: 32 bytes em base64, separada da chave de biometria para
// que o vazamento de uma não exponha a outra. Gerar com:
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// ATENÇÃO: perder a chave = certificados irrecuperáveis (reenviar os .pfx).
import crypto from 'crypto';
import forge from 'node-forge';
import { somenteDigitos } from './cnpj.js';

const OID_CNPJ_ICP_BRASIL = '2.16.76.1.3.3';

function chave() {
  const b64 = process.env.CERTIFICADO_CHAVE;
  if (!b64) throw new Error('Configure CERTIFICADO_CHAVE no .env.local (32 bytes em base64).');
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('CERTIFICADO_CHAVE deve ter 32 bytes (base64).');
  return k;
}

// Buffer -> "iv:tag:cipher" (base64). IV novo a cada chamada: repetir IV em GCM
// quebra a cifra.
export function cifrar(plano) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const cifrado = Buffer.concat([cipher.update(plano), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), cifrado.toString('base64')].join(':');
}

export function decifrar(texto) {
  const [ivB64, tagB64, dadoB64] = String(texto).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', chave(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dadoB64, 'base64')), decipher.final()]);
}

// O CNPJ no certificado ICP-Brasil vem no otherName 2.16.76.1.3.3 do
// subjectAltName; alguns emissores só põem no CN ("RAZAO SOCIAL:CNPJ").
function cnpjDoCertificado(cert) {
  const ext = cert.getExtension('subjectAltName');
  if (ext?.value) {
    const seq = forge.asn1.fromDer(forge.util.createBuffer(ext.value));
    for (const gn of seq.value) {
      // otherName = [0] { OID, [0] EXPLICIT valor }
      if (gn.tagClass !== forge.asn1.Class.CONTEXT_SPECIFIC || gn.type !== 0 || !Array.isArray(gn.value)) continue;
      const [oidNode, valorNode] = gn.value;
      if (!oidNode || forge.asn1.derToOid(oidNode.value) !== OID_CNPJ_ICP_BRASIL) continue;
      const folha = Array.isArray(valorNode?.value) ? valorNode.value[0] : valorNode;
      const digitos = somenteDigitos(folha?.value);
      if (digitos.length >= 14) return digitos.slice(0, 14);
    }
  }
  const cn = cert.subject.getField('CN')?.value || '';
  const m = cn.match(/(\d{14})\s*$/);
  return m ? m[1] : '';
}

export function inspecionarPfx(buffer, senha) {
  let p12;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(buffer.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha || '');
  } catch (e) {
    const msg = String(e?.message || e);
    if (/Invalid password|MAC|authenticate|PKCS#12 MAC/i.test(msg)) throw new Error('Senha do certificado incorreta.');
    throw new Error('Arquivo não é um certificado PKCS#12 válido.');
  }
  const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  const chaves = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [];
  // O certificado do titular é o que casa com a chave privada; o resto é cadeia.
  const idChave = chaves[0]?.attributes?.localKeyId?.[0];
  const bag = bags.find(b => idChave && b.attributes?.localKeyId?.[0] === idChave)
    || bags.find(b => b.cert && !b.cert.isIssuer(b.cert))
    || bags[0];
  if (!bag?.cert) throw new Error('Arquivo não é um certificado PKCS#12 válido.');
  const cert = bag.cert;
  return {
    cnpj: cnpjDoCertificado(cert),
    titular: cert.subject.getField('CN')?.value || '',
    emissor: cert.issuer.getField('CN')?.value || '',
    numeroSerie: cert.serialNumber,
    validoDe: cert.validity.notBefore,
    validoAte: cert.validity.notAfter,
  };
}

export function statusCertificado(validoAte, agora = new Date()) {
  const fim = new Date(validoAte);
  const diasParaVencer = Math.floor((fim - agora) / 86400000);
  const status = diasParaVencer < 0 ? 'vencido' : diasParaVencer <= 30 ? 'vence_em_30_dias' : 'vigente';
  return { status, diasParaVencer };
}

// Linha de certificados_digitais -> objeto da API. Fica aqui (e não na rota)
// porque arquivos de route.js do Next não podem exportar helpers, e duas rotas
// de app/api/empresas/* precisam do mesmo formato. Nunca inclui pfx nem senha.
export function resumoCertificado(linha) {
  const { status, diasParaVencer } = statusCertificado(linha.valido_ate);
  return {
    id: linha.id,
    titular: linha.titular,
    emissor: linha.emissor,
    cnpj: linha.cnpj_certificado,
    numeroSerie: linha.numero_serie,
    validoDe: linha.valido_de,
    validoAte: linha.valido_ate,
    status,
    diasParaVencer,
    criadoEm: linha.created_at,
  };
}

// Única porta de saída do pfx decifrado. As fases 2 e 3 da NF-e (assinatura e
// consulta à SEFAZ) chamam isto e usam o buffer em memória.
export async function obterCertificadoAtivo(empregadorId) {
  // Import tardio: pontoServer puxa `next/server`, que só resolve dentro do
  // bundler do Next. Com import estático este módulo (e portanto cifrar/
  // inspecionarPfx) não carregaria em `node --test`.
  const { clienteAdmin } = await import('./pontoServer.js');
  const sb = clienteAdmin();
  const { data, error } = await sb.from('certificados_digitais').select('*')
    .eq('empregador_id', empregadorId).eq('ativo', true).maybeSingle();
  if (error) throw new Error('Falha ao buscar o certificado: ' + error.message);
  if (!data) return null;
  const { pfx_cifrado, senha_cifrada, ...meta } = data;
  return { pfx: decifrar(pfx_cifrado), senha: decifrar(senha_cifrada).toString('utf8'), meta };
}
