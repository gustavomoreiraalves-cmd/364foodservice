// Fusos horários brasileiros em identificador IANA. Texto livre nessa coluna já
// produziu "MANAUS" em produção, que não é fuso nenhum: `at time zone` no
// Postgres e `Intl.DateTimeFormat` no Node rejeitam, e o erro só aparece na
// hora de usar o valor, longe do cadastro que o gravou.
//
// São dezesseis zonas, não quatro: estados com o mesmo offset hoje têm zonas
// separadas porque tiveram históricos de horário de verão diferentes, e é o
// identificador — não o offset — que faz a conversão de datas passadas sair
// certa. Por isso a lista não colapsa Recife em São Paulo.
//
// Mesma lista do CHECK em supabase/atualizacao_44_fuso_iana.sql. Mexeu num,
// mexa no outro. Ordenada de leste para oeste; o rótulo cita cidade e estados
// porque é assim que quem cadastra pensa, o valor é o que vai para o banco.
export const FUSOS_BRASIL = [
  ['America/Noronha', 'Fernando de Noronha (UTC-2)'],
  ['America/Sao_Paulo', 'Brasília (UTC-3) — SP, RJ, MG, ES, PR, SC, RS, GO, DF'],
  ['America/Bahia', 'Salvador (UTC-3) — BA'],
  ['America/Maceio', 'Maceió (UTC-3) — AL, SE'],
  ['America/Recife', 'Recife (UTC-3) — PE'],
  ['America/Fortaleza', 'Fortaleza (UTC-3) — CE, RN, PB, PI, MA'],
  ['America/Belem', 'Belém (UTC-3) — PA (leste), AP'],
  ['America/Santarem', 'Santarém (UTC-3) — PA (oeste)'],
  ['America/Araguaina', 'Araguaína (UTC-3) — TO'],
  ['America/Campo_Grande', 'Campo Grande (UTC-4) — MS'],
  ['America/Cuiaba', 'Cuiabá (UTC-4) — MT'],
  ['America/Porto_Velho', 'Porto Velho (UTC-4) — RO'],
  ['America/Boa_Vista', 'Boa Vista (UTC-4) — RR'],
  ['America/Manaus', 'Manaus (UTC-4) — AM (leste)'],
  ['America/Eirunepe', 'Eirunepé (UTC-5) — AM (oeste)'],
  ['America/Rio_Branco', 'Rio Branco (UTC-5) — AC'],
];

export const FUSO_PADRAO = 'America/Sao_Paulo';

// Rótulo para exibição. Devolve o próprio valor quando não é conhecido, para
// um registro legado aparecer como está em vez de sumir da tela.
export function rotuloFuso(valor) {
  return FUSOS_BRASIL.find(([v]) => v === valor)?.[1] || valor || '—';
}
