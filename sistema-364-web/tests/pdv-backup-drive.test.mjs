import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { urlDownload, dataDoCabecalhoGbak, arquivoDoDia, DIAS_SEMANA } from '../lib/pdvBackup/drive.js';

// Cabeçalho real: os 4096 primeiros bytes do backup domingo.fbconsumer.
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/pdv-backup/gbak-header.json', import.meta.url), 'utf8'));
const CABECALHO = Buffer.from(FIXTURE.bytes_base64, 'base64');

// Mapa igual ao seed da migração 33 (chaves com acento e hífen).
const ARQUIVOS = {
  'domingo': 'id-domingo',
  'segunda-feira': 'id-segunda',
  'terça-feira': 'id-terca',
  'quarta-feira': 'id-quarta',
  'quinta-feira': 'id-quinta',
  'sexta-feira': 'id-sexta',
  'sábado': 'id-sabado',
};

// ------------------------------------------------------------------ url

test('urlDownload monta o link de download direto do Drive', () => {
  assert.equal(
    urlDownload('1OpuFkwZd8LHj4qwbR57YmihqMi7YmitW'),
    'https://drive.usercontent.google.com/download?id=1OpuFkwZd8LHj4qwbR57YmihqMi7YmitW&export=download&confirm=t',
  );
});

test('urlDownload recusa file id vazio ou com caractere estranho', () => {
  assert.throws(() => urlDownload(''), /file id/i);
  assert.throws(() => urlDownload('id&export=download#outro'), /file id/i);
});

// -------------------------------------------------------- cabeçalho gbak

test('dataDoCabecalhoGbak lê a data do backup real e soma as 4 h de Porto Velho', () => {
  // "Sun Aug 23 09:20:09 2026" é hora local; o instante real é +4 h.
  assert.deepEqual(dataDoCabecalhoGbak(CABECALHO), new Date('2026-08-23T13:20:09Z'));
});

test('dataDoCabecalhoGbak só olha os primeiros 4 KB', () => {
  const longe = Buffer.concat([Buffer.alloc(5000, 0x20), Buffer.from('Mon Aug 24 10:00:00 2026', 'latin1')]);
  assert.equal(dataDoCabecalhoGbak(longe), null);
});

test('dataDoCabecalhoGbak aceita dia com um algarismo', () => {
  const buf = Buffer.from('Wed Aug  5 07:04:59 2026 ', 'latin1');
  assert.deepEqual(dataDoCabecalhoGbak(buf), new Date('2026-08-05T11:04:59Z'));
});

test('dataDoCabecalhoGbak devolve null para lixo, vazio ou nada', () => {
  assert.equal(dataDoCabecalhoGbak(Buffer.alloc(4096, 0xff)), null);
  assert.equal(dataDoCabecalhoGbak(Buffer.from('não é um backup', 'utf8')), null);
  assert.equal(dataDoCabecalhoGbak(Buffer.alloc(0)), null);
  assert.equal(dataDoCabecalhoGbak(null), null);
});

test('dataDoCabecalhoGbak ignora mês inexistente', () => {
  assert.equal(dataDoCabecalhoGbak(Buffer.from('Sun Xxx 23 09:20:09 2026', 'latin1')), null);
});

// ------------------------------------------------------- arquivo do dia

test('DIAS_SEMANA são as chaves do seed da migração 33, de domingo a sábado', () => {
  assert.deepEqual(DIAS_SEMANA, ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']);
});

test('arquivoDoDia usa o dia da semana local de Porto Velho, não o UTC', () => {
  // 2026-08-24T02:30Z ainda é domingo 22:30 em Porto Velho (UTC-4).
  assert.deepEqual(arquivoDoDia(ARQUIVOS, new Date('2026-08-24T02:30:00Z')), { dia: 'domingo', fileId: 'id-domingo' });
  // Já 04:00Z é segunda-feira 00:00 local.
  assert.deepEqual(arquivoDoDia(ARQUIVOS, new Date('2026-08-24T04:00:00Z')), { dia: 'segunda-feira', fileId: 'id-segunda' });
});

test('arquivoDoDia com diasAtras=1 devolve o arquivo de ontem (fallback)', () => {
  assert.deepEqual(arquivoDoDia(ARQUIVOS, new Date('2026-08-24T04:00:00Z'), 1), { dia: 'domingo', fileId: 'id-domingo' });
  // Vira a semana para trás sem estourar o índice.
  assert.deepEqual(arquivoDoDia(ARQUIVOS, new Date('2026-08-23T13:00:00Z'), 1), { dia: 'sábado', fileId: 'id-sabado' });
});

test('arquivoDoDia devolve fileId null quando a loja não tem o dia configurado', () => {
  assert.deepEqual(arquivoDoDia({ domingo: 'id-domingo' }, new Date('2026-08-24T04:00:00Z')), { dia: 'segunda-feira', fileId: null });
  assert.deepEqual(arquivoDoDia(null, new Date('2026-08-24T04:00:00Z')), { dia: 'segunda-feira', fileId: null });
});
