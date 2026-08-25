import test from 'node:test';
import assert from 'node:assert/strict';

process.env.CSC_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const { cifrarCsc, decifrarCsc } = await import('../lib/fiscalSecretServer.js');

test('round-trip íntegro', () => {
  const original = Buffer.from('869A687D-32CB-4CD9-90B1-880846340CE0', 'utf8');
  const cifrado = cifrarCsc(original);
  assert.deepEqual(decifrarCsc(cifrado), original);
});

test('adulterar a tag quebra a decifra', () => {
  const cifrado = cifrarCsc(Buffer.from('segredo', 'utf8'));
  const [iv, tag, dado] = cifrado.split(':');
  const tagAdulterada = [iv, Buffer.from(Buffer.from(tag, 'base64').map((b, i) => i === 0 ? b ^ 1 : b)).toString('base64'), dado].join(':');
  assert.throws(() => decifrarCsc(tagAdulterada));
});
