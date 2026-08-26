import test from 'node:test';
import assert from 'node:assert/strict';
import { endpointSefaz, tpAmb, CUF_RONDONIA, namespaceServico, acaoSoapServico } from '../lib/sefaz/endpoints.js';

test('cUF de Rondônia', () => {
  assert.equal(CUF_RONDONIA, '11');
});

test('tpAmb traduz o ambiente da configuração para o código do XML', () => {
  assert.equal(tpAmb('producao'), '1');
  assert.equal(tpAmb('homologacao'), '2');
});

test('tpAmb recusa ambiente desconhecido em vez de devolver undefined', () => {
  assert.throws(() => tpAmb('teste'), /ambiente/i);
  assert.throws(() => tpAmb(undefined), /ambiente/i);
});

test('produção e homologação são hosts diferentes', () => {
  const prod = endpointSefaz('statusServico', 'producao');
  const homo = endpointSefaz('statusServico', 'homologacao');
  assert.notEqual(prod, homo);
  assert.match(prod, /^https:\/\/nfe\.svrs\.rs\.gov\.br\//);
  assert.match(homo, /^https:\/\/nfe-homologacao\.svrs\.rs\.gov\.br\//);
});

test('os seis serviços têm endpoint nos dois ambientes', () => {
  for (const servico of ['statusServico', 'autorizacao', 'retAutorizacao', 'recepcaoEvento', 'consultaProtocolo', 'inutilizacao']) {
    for (const ambiente of ['producao', 'homologacao']) {
      assert.match(endpointSefaz(servico, ambiente), /^https:\/\/.+\.asmx$/, `${servico}/${ambiente}`);
    }
  }
});

// A máquina de estados da próxima etapa recupera de timeout consultando o
// protocolo, e a numeração inutiliza número queimado — os dois só existem se
// o endpoint apontar para o serviço certo, não para qualquer .asmx.
test('consultaProtocolo e inutilizacao apontam para os serviços certos', () => {
  assert.match(endpointSefaz('consultaProtocolo', 'producao'), /NfeConsultaProtocolo4\.asmx$/);
  assert.match(endpointSefaz('inutilizacao', 'producao'), /NfeInutilizacao4\.asmx$/);
});

test('serviço desconhecido lança em vez de devolver undefined', () => {
  assert.throws(() => endpointSefaz('inexistente', 'producao'), /servi/i);
});

test('namespaceServico devolve a URI wsdl correta por serviço', () => {
  assert.equal(namespaceServico('statusServico'), 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4');
  assert.equal(namespaceServico('autorizacao'), 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4');
  assert.equal(namespaceServico('retAutorizacao'), 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4');
  assert.equal(namespaceServico('consultaProtocolo'), 'http://www.portalfiscal.inf.br/nfe/wsdl/NfeConsultaProtocolo4');
  assert.equal(namespaceServico('inutilizacao'), 'http://www.portalfiscal.inf.br/nfe/wsdl/NfeInutilizacao4');
  assert.equal(namespaceServico('recepcaoEvento'), 'http://www.portalfiscal.inf.br/nfe/wsdl/recepcaoevento4');
});

test('namespaceServico lança para serviço desconhecido', () => {
  assert.throws(() => namespaceServico('inexistente'), /servi/i);
});

test('acaoSoapServico devolve a SOAPAction verificada de statusServico', () => {
  assert.equal(
    acaoSoapServico('statusServico'),
    'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
  );
});

// Verificadas contra o WSDL real via mTLS na Task 6 do motor de emissão
// (2026-08-25) — não são mais chute nem pendência, ao contrário das que
// seguem abaixo ainda sem verificação.
test('acaoSoapServico devolve a SOAPAction verificada de autorizacao e retAutorizacao', () => {
  assert.equal(
    acaoSoapServico('autorizacao'),
    'http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote',
  );
  assert.equal(
    acaoSoapServico('retAutorizacao'),
    'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4/nfeRetAutorizacaoLote',
  );
});

test('acaoSoapServico lança para serviço sem SOAPAction verificada, em vez de adivinhar', () => {
  for (const servico of ['recepcaoEvento', 'consultaProtocolo', 'inutilizacao']) {
    assert.throws(() => acaoSoapServico(servico), /verificad/i, servico);
  }
});
