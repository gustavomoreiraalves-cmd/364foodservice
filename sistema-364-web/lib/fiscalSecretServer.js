// Cifra do CSC (Código de Segurança do Contribuinte, NFC-e). Chave própria
// (CSC_ENCRYPTION_KEY), separada de CERTIFICADO_CHAVE — vazamento de uma não
// expõe a outra, mesma convenção já usada entre CERTIFICADO_CHAVE e a chave
// de biometria do ponto. Só servidor.
import { cifrarCom, decifrarCom } from './certificadoServer.js';

function chave() {
  const b64 = process.env.CSC_ENCRYPTION_KEY;
  if (!b64) throw new Error('Configure CSC_ENCRYPTION_KEY no .env.local (32 bytes em base64).');
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('CSC_ENCRYPTION_KEY deve ter 32 bytes (base64).');
  return k;
}

export function cifrarCsc(plano) {
  return cifrarCom(chave(), plano);
}

export function decifrarCsc(texto) {
  return decifrarCom(chave(), texto);
}
