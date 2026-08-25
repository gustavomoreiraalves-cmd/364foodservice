'use client';
import {
  ST_RESPONSAVEL, ST_RESPONSAVEL_OPCOES, CSOSN_OPCOES, MOD_BC_OPCOES, MOD_BC_ST_OPCOES,
  cfopSugerido, validarRegraTributaria,
} from '../lib/fiscalRegras.js';
import { soDigitos } from '../lib/fiscal.js';

// Formulário de uma regra tributária. A ordem das perguntas é a ordem em que
// alguém decide: para qual operação, para quem, e só então como tributa.

export default function RegraTributariaForm({ form, setForm, naturezas, cfops, produtos, onSalvar, onCancelar, salvando }) {
  const set = campos => setForm({ ...form, ...campos });
  const natureza = naturezas.find(n => n.id === form.natureza_operacao_id);
  const erros = validarRegraTributaria({ ...form, tipo_operacao: natureza?.tipo_operacao });
  const retemSt = form.st_responsavel === ST_RESPONSAVEL.SUBSTITUTO;
  const jaRetido = form.st_responsavel === ST_RESPONSAVEL.SUBSTITUIDO;

  function sugerirCfop() {
    set({
      cfop: cfopSugerido({
        producaoPropria: form.producao_propria !== false,
        stResponsavel: form.st_responsavel,
        mesmaUf: !form.uf_destino || form.uf_destino === '*' || form.uf_destino === 'RO',
      }),
    });
  }

  return (
    <form onSubmit={e => { e.preventDefault(); onSalvar(); }}>
      <label style={{ marginBottom: 6 }}>Quando esta regra vale</label>
      <div className="form-grid">
        <div>
          <label>Natureza da operação</label>
          <select required value={form.natureza_operacao_id || ''}
                  onChange={e => set({ natureza_operacao_id: e.target.value })}>
            <option value="">Selecione…</option>
            {naturezas.map(n => (
              <option key={n.id} value={n.id}>{n.descricao} ({n.tipo_operacao})</option>
            ))}
          </select>
        </div>
        <div>
          <label>UF de destino</label>
          <input value={form.uf_destino ?? '*'} maxLength={2}
                 onChange={e => set({ uf_destino: e.target.value.toUpperCase().replace(/[^A-Z*]/g, '') || '*' })} />
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
            * vale para qualquer UF. A 364 vende só dentro de Rondônia, então RO ou * dão no mesmo hoje.
          </p>
        </div>
        <div>
          <label>Destinatário é contribuinte?</label>
          <select value={valorTri(form.destinatario_contribuinte)}
                  onChange={e => set({ destinatario_contribuinte: leTri(e.target.value) })}>
            <option value="">Tanto faz</option>
            <option value="sim">Sim — revendedor com inscrição</option>
            <option value="nao">Não — pessoa física ou isento</option>
          </select>
        </div>
        <div>
          <label>É consumidor final?</label>
          <select value={valorTri(form.destinatario_consumidor_final)}
                  onChange={e => set({ destinatario_consumidor_final: leTri(e.target.value) })}>
            <option value="">Tanto faz</option>
            <option value="sim">Sim — consome, não revende</option>
            <option value="nao">Não — compra para revender</option>
          </select>
        </div>
      </div>

      <label style={{ margin: '12px 0 6px' }}>Como tributa</label>
      <div className="form-grid">
        <div>
          <label>Substituição tributária</label>
          <select value={form.st_responsavel || ST_RESPONSAVEL.NAO_APLICAVEL}
                  onChange={e => set({ st_responsavel: e.target.value })}>
            {ST_RESPONSAVEL_OPCOES.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label>CFOP</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input required list="lista-cfop" value={form.cfop || ''} style={{ flex: 1 }}
                   onChange={e => set({ cfop: soDigitos(e.target.value).slice(0, 4) })} />
            <button className="btn secondary small" type="button" onClick={sugerirCfop}>Sugerir</button>
          </div>
          <datalist id="lista-cfop">
            {cfops.map(c => <option key={c.cfop} value={c.cfop}>{c.descricao}</option>)}
          </datalist>
          {cfopDescricao(cfops, form.cfop) && (
            <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>{cfopDescricao(cfops, form.cfop)}</p>
          )}
        </div>
        <div>
          <label>CSOSN</label>
          <select value={form.csosn || ''} onChange={e => set({ csosn: e.target.value || null })}>
            <option value="">Selecione…</option>
            {CSOSN_OPCOES.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.permite_credito_simples}
                   onChange={e => set({ permite_credito_simples: e.target.checked })} />
            Permite crédito ao cliente
          </label>
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
            A alíquota vem dos parâmetros do Simples da competência, e a frase do art. 23 entra nas informações
            complementares. Não se fixa percentual aqui: ele muda todo mês com o RBT12.
          </p>
        </div>
      </div>

      <label style={{ margin: '12px 0 6px' }}>Base de cálculo</label>
      <div className="form-grid">
        <div>
          <label>Modalidade da base</label>
          <select value={form.mod_bc ?? ''} onChange={e => set({ mod_bc: numero(e.target.value) })}>
            <option value="">Não informar</option>
            {MOD_BC_OPCOES.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label>Redução da base (%)</label>
          <input type="number" step="0.01" value={form.reducao_base_percentual ?? ''}
                 onChange={e => set({ reducao_base_percentual: e.target.value })} />
        </div>
        {retemSt && (
          <>
            <div>
              <label>MVA (%)</label>
              <input type="number" step="0.01" required value={form.mva_percentual ?? ''}
                     onChange={e => set({ mva_percentual: e.target.value })} />
              <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
                Sai do Anexo VI do RICMS/RO. Carne bovina do item 84.0 usa 35%.
              </p>
            </div>
            <div>
              <label>Modalidade da base de ST</label>
              <select value={form.mod_bc_st ?? ''} onChange={e => set({ mod_bc_st: numero(e.target.value) })}>
                <option value="">Não informar</option>
                {MOD_BC_ST_OPCOES.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label>Redução da base de ST (%)</label>
              <input type="number" step="0.01" value={form.reducao_base_st_percentual ?? ''}
                     onChange={e => set({ reducao_base_st_percentual: e.target.value })} />
            </div>
            <div>
              <label>Alíquota interna do destino (%)</label>
              <input type="number" step="0.01" value={form.aliquota_interna_destino ?? ''}
                     onChange={e => set({ aliquota_interna_destino: e.target.value })} />
              <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
                A nota do frigorífico mostra carne com 12%, não com a modal de 19,5%. Confirme com o contador.
              </p>
            </div>
          </>
        )}
        {jaRetido && (
          <div>
            <label>Alíquota já suportada (pST, %)</label>
            <input type="number" step="0.01" value={form.aliquota_st_retido ?? ''}
                   onChange={e => set({ aliquota_st_retido: e.target.value })} />
            <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
              Vai na nota junto de vBCSTRet e vICMSSubstituto.
            </p>
          </div>
        )}
      </div>

      <label style={{ margin: '12px 0 6px' }}>PIS, COFINS e observações</label>
      <div className="form-grid">
        <div>
          <label>CST do PIS</label>
          <input value={form.cst_pis || ''} maxLength={2}
                 onChange={e => set({ cst_pis: soDigitos(e.target.value).slice(0, 2) })} />
        </div>
        <div>
          <label>CST da COFINS</label>
          <input value={form.cst_cofins || ''} maxLength={2}
                 onChange={e => set({ cst_cofins: soDigitos(e.target.value).slice(0, 2) })} />
        </div>
        <div>
          <label>Vigência (início)</label>
          <input type="date" value={form.vigencia_inicio || ''}
                 onChange={e => set({ vigencia_inicio: e.target.value })} />
        </div>
        <div>
          <label>Vigência (fim)</label>
          <input type="date" value={form.vigencia_fim || ''}
                 onChange={e => set({ vigencia_fim: e.target.value || null })} />
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
            Em branco = vale até segunda ordem. Quando a norma mudar, encerre a regra aqui em vez de editá-la:
            as notas já emitidas continuam explicáveis.
          </p>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Base legal</label>
          <input placeholder="RICMS-RO Anexo VI, Tabela XVII, item 84.0" value={form.base_legal || ''}
                 onChange={e => set({ base_legal: e.target.value })} />
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label>Observação impressa no item da nota</label>
          <input value={form.observacao_fiscal || ''}
                 onChange={e => set({ observacao_fiscal: e.target.value })} />
        </div>
      </div>

      {erros.length > 0 && (
        <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12 }}>
          {erros.map(e => <li key={e} style={{ color: 'var(--red, #d66)' }}>{e}</li>)}
        </ul>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn" type="submit" disabled={salvando || erros.length > 0}>
          {salvando ? 'Salvando…' : 'Salvar regra'}
        </button>
        <button className="btn secondary" type="button" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

// Os três estados do "tanto faz" viram string no select e voltam a booleano ou
// null aqui: `null` no banco significa "esta regra não olha para isso".
function valorTri(v) {
  if (v === true) return 'sim';
  if (v === false) return 'nao';
  return '';
}

function leTri(v) {
  if (v === 'sim') return true;
  if (v === 'nao') return false;
  return null;
}

function numero(v) {
  return v === '' ? null : Number(v);
}

function cfopDescricao(cfops, cfop) {
  return cfops.find(c => c.cfop === cfop)?.descricao || '';
}
