'use client';
import { formatarCnpj, cnpjValido } from '../lib/cnpj';
import { formatarTelefone, capitalizarNome } from '../lib/formatacao';
import { soDigitos } from '../lib/fiscal';
import { CATEGORIAS_FORNECEDOR } from '../lib/fornecedores';

const TIPOS_CLIENTE = ['Revenda', 'Distribuidor', 'Food Service', 'Consumidor Final'];

// Corpo da ficha de parceiro (cliente e/ou fornecedor) — sem a tag <form> nem
// o rodapé de botões, que ficam em app/clientes/page.js (só quem sabe salvar,
// excluir e desativar). Este componente só desenha os campos.
export default function FichaParceiro({
  form, setForm, papeis, setPapeis, fiscalDisponivel, pendencias,
  consultandoCnpj, erroConsultaCnpj, situacaoCnpj, onConsultarCnpj,
  cnpjCopiado, onConsultarIe,
}) {
  const querCliente = papeis.includes('cliente');
  const querFornecedor = papeis.includes('fornecedor');
  // Endereço é da empresa, não do papel — mostra pra qualquer um dos dois.
  // fiscalDisponivel só entra pro lado cliente: sem a atualização 36, a
  // coluna nem existe em `clientes` (fornecedores tem desde a 41).
  const mostrarEndereco = querFornecedor || (querCliente && fiscalDisponivel);

  function alternarPapel(papel) {
    setPapeis(atual => (atual.includes(papel) ? atual.filter(p => p !== papel) : [...atual, papel]));
  }

  return (
    <div className="modal-body">
      <div className="form-grid">
        <div className="secao">Papel</div>
        <div className="largo" style={{ display: 'flex', gap: 16 }}>
          <label className="check-line">
            <input type="checkbox" checked={querCliente} onChange={() => alternarPapel('cliente')} />
            Cliente
          </label>
          <label className="check-line">
            <input type="checkbox" checked={querFornecedor} onChange={() => alternarPapel('fornecedor')} />
            Fornecedor
          </label>
        </div>
      </div>

      {querCliente && fiscalDisponivel && (
        <div className={'pendencias' + (pendencias.length ? '' : ' completo')}>
          {pendencias.length ? (
            <>
              <b>Falta para emitir nota para este cliente:</b>
              <ul>{pendencias.map(p => <li key={p}>{p}</li>)}</ul>
            </>
          ) : <span className="tag ok">Pronto para receber nota fiscal</span>}
        </div>
      )}

      <div className="form-grid">
        <div className="secao">Identificação</div>
        <div className="largo">
          <label htmlFor="p-nome">Nome / Razão social</label>
          <input id="p-nome" required autoFocus value={form.nome} style={{ textTransform: 'capitalize' }}
                 onChange={e => setForm({ ...form, nome: e.target.value })}
                 onBlur={e => setForm(f => ({ ...f, nome: capitalizarNome(e.target.value) }))} />
        </div>
        <div className="largo">
          <label htmlFor="p-fantasia">Nome fantasia</label>
          <input id="p-fantasia" value={form.nome_fantasia || ''} style={{ textTransform: 'capitalize' }}
                 onChange={e => setForm({ ...form, nome_fantasia: e.target.value })}
                 onBlur={e => setForm(f => ({ ...f, nome_fantasia: capitalizarNome(e.target.value) }))} />
        </div>
        <div>
          <label htmlFor="p-pessoa">Pessoa</label>
          <select id="p-pessoa" value={form.tipo_pessoa || 'J'}
                  onChange={e => setForm({ ...form, tipo_pessoa: e.target.value })}>
            <option value="J">Jurídica</option><option value="F">Física</option>
          </select>
        </div>
        <div>
          <label htmlFor="p-doc">{form.tipo_pessoa === 'F' ? 'CPF' : 'CNPJ'}</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input id="p-doc" inputMode="numeric" style={{ flex: 1 }}
                   value={form.tipo_pessoa === 'F' ? (form.cpf || '') : formatarCnpj(form.cnpj)}
                   onChange={e => setForm(form.tipo_pessoa === 'F'
                     ? { ...form, cpf: soDigitos(e.target.value).slice(0, 11) }
                     : { ...form, cnpj: soDigitos(e.target.value).slice(0, 14) })} />
            {form.tipo_pessoa === 'J' && (
              <button type="button" className="btn secondary small" disabled={!cnpjValido(form.cnpj) || consultandoCnpj}
                      onClick={onConsultarCnpj}>
                {consultandoCnpj ? 'Consultando…' : 'Consultar'}
              </button>
            )}
          </div>
          {erroConsultaCnpj && <p className="ajuda erro">{erroConsultaCnpj}</p>}
          {situacaoCnpj && (
            <p className="ajuda">
              Situação na Receita: {situacaoCnpj}. Inscrição estadual não vem nessa consulta — confira na SEFIN.
            </p>
          )}
        </div>
        <div>
          <label htmlFor="p-contato">Contato</label>
          <input id="p-contato" value={form.contato} onChange={e => setForm({ ...form, contato: e.target.value })} />
        </div>
        <div>
          <label htmlFor="p-fone">Telefone</label>
          <input id="p-fone" inputMode="numeric" value={formatarTelefone(form.telefone)}
                 onChange={e => setForm({ ...form, telefone: soDigitos(e.target.value).slice(0, 11) })} />
        </div>
      </div>

      {querCliente && (
        <div className="form-grid">
          <div className="secao">Dados de cliente</div>
          <div>
            <label htmlFor="p-tipo">Tipo de cliente</label>
            <select id="p-tipo" value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
              {TIPOS_CLIENTE.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>

          {fiscalDisponivel && (
            <>
              <div>
                <label htmlFor="p-indie">Inscrição estadual</label>
                <select id="p-indie" value={form.ind_ie_dest ?? ''}
                        onChange={e => setForm({
                          ...form,
                          ind_ie_dest: e.target.value === '' ? null : Number(e.target.value),
                          ie: e.target.value === '1' ? form.ie : '',
                        })}>
                  <option value="">Selecione…</option>
                  <option value="1">Contribuinte de ICMS</option>
                  <option value="2">Isento de inscrição</option>
                  <option value="9">Não contribuinte</option>
                </select>
              </div>
              {Number(form.ind_ie_dest) === 1 && (
                <div>
                  <label htmlFor="p-ie">Número da inscrição</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input id="p-ie" inputMode="numeric" style={{ flex: 1 }} value={form.ie || ''}
                           onChange={e => setForm({ ...form, ie: soDigitos(e.target.value) })} />
                    <button type="button" className="btn secondary small" onClick={onConsultarIe}>
                      Consultar IE
                    </button>
                  </div>
                  {cnpjCopiado && <p className="ajuda">CNPJ copiado — cole no campo da consulta.</p>}
                </div>
              )}
              <div>
                <label htmlFor="p-final">Compra para</label>
                <select id="p-final" value={form.consumidor_final === null || form.consumidor_final === undefined ? '' : String(form.consumidor_final)}
                        onChange={e => setForm({ ...form, consumidor_final: e.target.value === '' ? null : e.target.value === 'true' })}>
                  <option value="">Selecione…</option>
                  <option value="false">Revender</option>
                  <option value="true">Consumo próprio</option>
                </select>
              </div>
              <div>
                <label htmlFor="p-email-nfe">E-mail para a nota</label>
                <input id="p-email-nfe" type="email" value={form.email_nfe || ''}
                       onChange={e => setForm({ ...form, email_nfe: e.target.value })} />
              </div>
            </>
          )}
        </div>
      )}

      {querFornecedor && (
        <div className="form-grid">
          <div className="secao">Dados de fornecedor</div>
          <div>
            <label htmlFor="p-categoria">Categoria</label>
            <select id="p-categoria" value={form.categoria || 'Outros'}
                    onChange={e => setForm({ ...form, categoria: e.target.value })}>
              {CATEGORIAS_FORNECEDOR.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="p-email">E-mail</label>
            <input id="p-email" type="email" value={form.email || ''}
                   onChange={e => setForm({ ...form, email: e.target.value })} />
          </div>
        </div>
      )}

      {mostrarEndereco && (
        <div className="form-grid">
          <div className="secao">Endereço</div>
          <div className="largo">
            <label htmlFor="p-log">Logradouro</label>
            <input id="p-log" value={form.logradouro || ''}
                   onChange={e => setForm({ ...form, logradouro: e.target.value })} />
          </div>
          <div>
            <label htmlFor="p-num">Número</label>
            <input id="p-num" value={form.numero || ''} onChange={e => setForm({ ...form, numero: e.target.value })} />
          </div>
          <div>
            <label htmlFor="p-comp">Complemento</label>
            <input id="p-comp" value={form.complemento || ''} onChange={e => setForm({ ...form, complemento: e.target.value })} />
          </div>
          <div>
            <label htmlFor="p-bairro">Bairro</label>
            <input id="p-bairro" value={form.bairro || ''} onChange={e => setForm({ ...form, bairro: e.target.value })} />
          </div>
          <div>
            <label htmlFor="p-cep">CEP</label>
            <input id="p-cep" inputMode="numeric" maxLength={8} value={form.cep || ''}
                   onChange={e => setForm({ ...form, cep: soDigitos(e.target.value) })} />
          </div>
          <div>
            <label htmlFor="p-mun">Município</label>
            <input id="p-mun" value={form.municipio || ''} onChange={e => setForm({ ...form, municipio: e.target.value })} />
          </div>
          <div>
            <label htmlFor="p-ibge">Código IBGE</label>
            <input id="p-ibge" inputMode="numeric" maxLength={7} value={form.codigo_municipio_ibge || ''}
                   onChange={e => setForm({ ...form, codigo_municipio_ibge: soDigitos(e.target.value) })} />
            <p className="ajuda">Ji-Paraná é 1100122; Porto Velho, 1100205.</p>
          </div>
          <div>
            <label htmlFor="p-uf">UF</label>
            <input id="p-uf" maxLength={2} value={form.uf || ''}
                   onChange={e => setForm({ ...form, uf: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} />
          </div>
        </div>
      )}
    </div>
  );
}
