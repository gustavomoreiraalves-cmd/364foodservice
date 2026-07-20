---
type: checkpoint
---

# Step 11: Aprovação Final ✅

Checkpoint de encerramento — apresentar ao usuário:
1. O **parecer executivo** aprovado pela revisão (`output/parecer-executivo.md`), na íntegra ou resumido com link para o arquivo.
2. O **veredito da revisão** (`output/revisao.md`) em 1 linha (ex.: "APROVA, média 8,1").

Perguntar via AskUserQuestion:

1. **O parecer está aprovado?**
   - **Aprovado — encerrar a rodada** → PMO atualiza `_memory/runs.md` (data, tema, output, resultado) e `_memory/memories.md` (aprendizados da rodada); rodada concluída.
   - **Aprovar com ajustes** → usuário descreve os ajustes ("Other"); PMO aplica diretamente no parecer e reapresenta este checkpoint.
   - **Rejeitar e refazer** → usuário explica o motivo; pipeline retorna ao passo 9 com o feedback como mudança obrigatória.

2. **Deseja abrir uma nova pauta na sequência?** (opcional)
   - Sim → reiniciar o pipeline no passo 1.
   - Não → encerrar.

Regra: a rodada só é registrada como concluída em `runs.md` após a aprovação explícita do usuário.
