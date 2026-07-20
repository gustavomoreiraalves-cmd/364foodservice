---
type: checkpoint
---

# Step 03: Aprovar Enquadramento ✅

Checkpoint — apresentar ao usuário o enquadramento produzido por Vicente Visão (`output/enquadramento.md`) e coletar a decisão via AskUserQuestion:

1. **O enquadramento está correto?**
   - **Aprovado, seguir para a pesquisa** — o pipeline continua (Samuel Sonda roda em background).
   - **Ajustar** — usuário descreve o ajuste ("Other"); Vicente refaz o enquadramento e este checkpoint se repete.
   - **Trocar especialistas convocados** — usuário indica quem entra/sai; Vicente atualiza e segue.

Regras:
- Nunca prosseguir sem aprovação explícita.
- Se a pesquisa foi dispensada no enquadramento, informar isso claramente ao usuário neste checkpoint ("a rodada seguirá direto para a mesa de especialistas").
- Registrar qualquer ajuste solicitado no próprio `enquadramento.md` (seção "Ajustes do usuário").
