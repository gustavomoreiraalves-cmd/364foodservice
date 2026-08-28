'use client';
import {
  SEM_GTIN, soDigitos, gtinValido, cestsDoNcm, pendenciasFiscaisProduto,
  ORIGENS_MERCADORIA, UNIDADES_PADRAO,
} from '../lib/fiscal.js';
import { resumoRegra, descreverDestinatario } from '../lib/fiscalRegras.js';
import Icone from './Icone';
import CopiarFiscalDeProduto from './CopiarFiscalDeProduto';

// Bloco fiscal do cadastro de produto. Só o que é intrínseco à mercadoria mora
// aqui: NCM, CEST, origem, unidades, código de barras. A tributação (CFOP,
// CSOSN, MVA) depende também da operação e do destinatário, e por isso vive no
// grupo tributário, escolhido no fim do formulário.

const AVISO_SEM_MIGRACAO = 'O cadastro fiscal precisa da atualização 36 aplicada no banco. '
  + 'Enquanto ela não roda, os campos abaixo ficam indisponíveis.';

export default function ProdutoFiscal({ form, setForm, tabelas, disponivel, editando, onLiberar,
  naturezas = [], regras = [], onAbrirConfiguracao, produtos = [], produtoAtualId = null }) {
  const set = campos => setForm({ ...form, ...campos });
  const { ncms = [], cests = [], unidades = [], grupos = [] } = tabelas || {};

  if (!disponivel) return <p className="muted" style={{ fontSize: 12 }}>{AVISO_SEM_MIGRACAO}</p>;

  const pendencias = pendenciasFiscaisProduto(form);
  const cestsOferecidos = cestsDoNcm(cests, form.ncm);
  const ncmEscolhido = ncms.find(n => n.ncm === soDigitos(form.ncm));
  const unidadesDisponiveis = unidades.length ? unidades.map(u => u.codigo) : UNIDADES_PADRAO;
  const unidadesDiferem = form.unidade && form.unidade_tributavel
    && String(form.unidade).toUpperCase() !== String(form.unidade_tributavel).toUpperCase();

  return (
    <>
      <CopiarFiscalDeProduto form={form} setForm={setForm} produtos={produtos}
                             grupos={grupos} produtoAtualId={produtoAtualId} />

      <div className={'pendencias' + (pendencias.length ? '' : ' completo')}>
        {pendencias.length ? (
          <>
            <b>Falta para este produto poder entrar numa nota:</b>
            <ul>
              {pendencias.map(p => <li key={p}>{p}</li>)}
            </ul>
          </>
        ) : (
          <>
            <span className="tag ok">Cadastro fiscal completo</span>
            {editando && !form.ativo_fiscal && (
              <button className="btn small" type="button" onClick={onLiberar}>Liberar para emissão</button>
            )}
            {form.ativo_fiscal && <span className="muted" style={{ fontSize: 11.5 }}>Liberado para emissão de NF-e.</span>}
          </>
        )}
        {form.sugerido_automaticamente && (
          <p className="ajuda">
            Estes dados vieram de uma NF-e de fornecedor e ainda não foram conferidos por ninguém.
          </p>
        )}
      </div>

      <div className="form-grid">
        <div className="secao">Classificação</div>
        <div>
          <label>NCM</label>
          <input list="lista-ncm" placeholder="02102000" value={form.ncm || ''}
                 onChange={e => set({ ncm: soDigitos(e.target.value).slice(0, 8) })} />
          <datalist id="lista-ncm">
            {ncms.map(n => <option key={n.ncm} value={n.ncm}>{n.descricao}</option>)}
          </datalist>
          {ncmEscolhido && <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>{ncmEscolhido.descricao}</p>}
        </div>
        <div>
          <label>Exceção da TIPI</label>
          <input placeholder="opcional" value={form.ex_tipi || ''}
                 onChange={e => set({ ex_tipi: soDigitos(e.target.value).slice(0, 2) })} />
        </div>
        <div>
          <label>CEST</label>
          {cestsOferecidos.length ? (
            <select value={form.cest || ''} onChange={e => set({ cest: e.target.value })}>
              <option value="">Sem CEST</option>
              {cestsOferecidos.map(c => (
                <option key={`${c.cest}-${c.ncm}`} value={c.cest}>{c.cest} — {c.descricao}</option>
              ))}
            </select>
          ) : (
            <input placeholder="1708300" value={form.cest || ''}
                   onChange={e => set({ cest: soDigitos(e.target.value).slice(0, 7) })} />
          )}
          {soDigitos(form.ncm).length === 8 && !cestsOferecidos.length && (
            <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
              Nenhum CEST cadastrado para este NCM. Digite se o contador indicar um.
            </p>
          )}
        </div>
        <div>
          <label>Origem da mercadoria</label>
          <select value={form.origem_mercadoria ?? ''}
                  onChange={e => set({ origem_mercadoria: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">Selecione…</option>
            {ORIGENS_MERCADORIA.map(o => <option key={o.valor} value={o.valor}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.sujeito_st}
                   onChange={e => set({ sujeito_st: e.target.checked })} />
            Sujeito a substituição tributária
          </label>
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
            Marque conforme a orientação do contador. Quem decide se há retenção nesta nota é o grupo tributário.
          </p>
        </div>
      </div>

      <div className="form-grid">
        <div className="secao">Medidas</div>
        <div>
          <label>Unidade tributável</label>
          <select value={form.unidade_tributavel || ''}
                  onChange={e => set({ unidade_tributavel: e.target.value })}>
            <option value="">Selecione…</option>
            {unidadesDisponiveis.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
            A unidade de venda é {form.unidade || '—'}. Se tributa em outra, escolha aqui.
          </p>
        </div>
        {unidadesDiferem && (
          <div>
            <label>Fator de conversão</label>
            <input type="number" step="0.0001" placeholder="1,2000"
                   value={form.fator_conversao_tributavel ?? ''}
                   onChange={e => set({ fator_conversao_tributavel: e.target.value })} />
            <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
              Quantos {form.unidade_tributavel} tem 1 {form.unidade}.
            </p>
          </div>
        )}
        <div>
          <label>Peso líquido (kg)</label>
          <input type="number" step="0.0001" value={form.peso_liquido_kg ?? ''}
                 onChange={e => set({ peso_liquido_kg: e.target.value })} />
        </div>
        <div>
          <label>Peso bruto (kg)</label>
          <input type="number" step="0.0001" value={form.peso_bruto_kg ?? ''}
                 onChange={e => set({ peso_bruto_kg: e.target.value })} />
        </div>
      </div>

      <div className="form-grid">
        <div className="secao">Código de barras</div>
        <CampoGtin rotulo="GTIN comercial" campo="gtin" form={form} set={set} />
        <CampoGtin rotulo="GTIN tributável" campo="gtin_tributavel" form={form} set={set} />
      </div>

      <div className="form-grid">
        <div className="secao">Produção</div>
        <div>
          <label>Escala de produção</label>
          <select value={form.ind_escala || ''} onChange={e => set({ ind_escala: e.target.value || null })}>
            <option value="">Não informar</option>
            <option value="S">Escala relevante</option>
            <option value="N">Escala NÃO relevante</option>
          </select>
        </div>
        {form.ind_escala === 'N' && (
          <div>
            <label>CNPJ do fabricante</label>
            <input value={form.cnpj_fabricante || ''}
                   onChange={e => set({ cnpj_fabricante: soDigitos(e.target.value).slice(0, 14) })} />
            <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
              Obrigatório quando a escala não é relevante.
            </p>
          </div>
        )}
        <div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.rastro_obrigatorio}
                   onChange={e => set({ rastro_obrigatorio: e.target.checked })} />
            Enviar lote e validade na nota
          </label>
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
            Não é exigido para carnes — só para medicamentos. Ligue se quiser rastreabilidade no documento.
          </p>
        </div>
      </div>

      <div className="form-grid">
        <div className="secao">Tributação</div>
        <div className="largo">
          <label htmlFor="pf-grupo">Configuração fiscal</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select id="pf-grupo" style={{ flex: '1 1 220px' }} value={form.grupo_tributario_id || ''}
                    onChange={e => set({ grupo_tributario_id: e.target.value || null })}>
              <option value="">Selecione…</option>
              {grupos.map(g => <option key={g.id} value={g.id}>{g.codigo} — {g.descricao}</option>)}
            </select>
            {form.grupo_tributario_id && (
              <button className="btn secondary small" type="button"
                      onClick={() => onAbrirConfiguracao(form.grupo_tributario_id)}>
                <Icone nome="lapis" tamanho={13} /> Editar
              </button>
            )}
            <button className="btn secondary small" type="button" onClick={() => onAbrirConfiguracao(null)}>
              <Icone nome="mais" tamanho={13} /> Nova
            </button>
          </div>
          <p className="ajuda">
            É a configuração que decide CFOP, CSOSN e MVA de cada operação. Ela é compartilhada:
            corrigir aqui corrige todos os produtos que apontam para ela.
          </p>
          <ResumoDaConfiguracao grupoId={form.grupo_tributario_id} regras={regras} naturezas={naturezas} />
        </div>
        <div>
          <label>Alíquota da transparência (%)</label>
          <input type="number" step="0.01" placeholder="12,00" value={form.aliquota_transparencia ?? ''}
                 onChange={e => set({ aliquota_transparencia: e.target.value })} />
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
            Lei 12.741/2012. Vai impressa como valor aproximado dos tributos.
          </p>
        </div>
        <div>
          <label>Classificação do IBS/CBS</label>
          <input placeholder="000001" value={form.cclasstrib || ''}
                 onChange={e => set({ cclasstrib: soDigitos(e.target.value).slice(0, 6) })} />
          <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
            Só passa a ser exigido do Simples Nacional em 04/01/2027. Deixe em branco por enquanto.
          </p>
        </div>
      </div>
    </>
  );
}

// O que a configuração escolhida faz, listado dentro da ficha do produto: sem
// isso, escolher uma configuração é escolher um nome sem saber o que ele causa.
function ResumoDaConfiguracao({ grupoId, regras, naturezas }) {
  if (!grupoId) return null;
  const minhas = regras.filter(r => r.grupo_tributario_id === grupoId && r.ativo !== false);
  if (!minhas.length) {
    return (
      <p className="ajuda" style={{ color: 'var(--warn)' }}>
        Esta configuração ainda não tem nenhuma regra. Enquanto não tiver, o produto não libera para emissão.
      </p>
    );
  }
  return (
    <div className="items-list" style={{ marginTop: 8 }}>
      {minhas.map(r => {
        const n = naturezas.find(x => x.id === r.natureza_operacao_id);
        return (
          <div className="item-line" key={r.id} style={{ fontSize: 11.5, flexWrap: 'wrap', gap: 6 }}>
            <span style={{ flex: '1 1 150px' }}>
              <b>{n?.descricao || 'natureza removida'}</b>
              <span className="muted" style={{ display: 'block' }}>{descreverDestinatario(r)}</span>
            </span>
            <span className="muted" style={{ flex: '1 1 160px' }}>{resumoRegra(r)}</span>
          </div>
        );
      })}
    </div>
  );
}

function CampoGtin({ rotulo, campo, form, set }) {
  const valor = form[campo] || '';
  const invalido = valor && !gtinValido(valor);
  return (
    <div>
      <label>{rotulo}</label>
      <input value={valor} placeholder="7891910000197"
             onChange={e => set({ [campo]: e.target.value.trim().toUpperCase() })} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
        <button className="btn secondary small" type="button" onClick={() => set({ [campo]: SEM_GTIN })}>
          Sem código de barras
        </button>
        {invalido && <span className="tag bad">dígito verificador não confere</span>}
        {valor === SEM_GTIN && <span className="muted" style={{ fontSize: 11 }}>vai como {SEM_GTIN} na nota</span>}
      </div>
    </div>
  );
}
