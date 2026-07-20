# =========================================================
# 364 FOOD SERVICES — GERADOR DAS FICHAS IMPRESSAS v2
# Fichas de papel espelhando os campos do sistema web
# (sistema-364-web). Uma ficha por página, A4.
#
# Para gerar novamente:  python3 gerar_fichas_v2.py
# Se a URL do sistema mudar, ajuste BASE_URL abaixo e rode de novo
# (os QR codes apontam para a página de cada módulo).
# =========================================================

import os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

BASE_URL = "https://364foodservice.vercel.app"   # <-- URL do sistema publicado

W, H = A4
M = 40                     # margem
CW = W - 2 * M             # largura útil
INK = (0.13, 0.13, 0.13)
GRAY = (0.45, 0.45, 0.45)
LINE = (0.62, 0.62, 0.62)
FILL = (0.93, 0.93, 0.93)

CATALOGO = [
    ("0364-001", "Costela Defumada 500g",      "58,50"),
    ("0364-002", "Costela Desfiada 500g",      "65,00"),
    ("0364-003", "Costelinha BBQ 500g",        "58,50"),
    ("0364-004", "Cupim Defumado 500g",        "65,00"),
    ("0364-005", "Torresmo de Rolo 500g",      "45,50"),
    ("0364-006", "Hambúrguer de Costela 140g", "52,00"),
    ("0364-007", "Escondidinho de Costela",    "52,00"),
    ("0364-008", "Croquete de Costela 500g",   "52,00"),
    ("0364-009", "Farofa Crocante 500g",       "22,90"),
    ("0364-010", "Geleia de Abacaxi Picante",  "24,90"),
]


class Ficha:
    def __init__(self, c, titulo, caminho, num, total):
        self.c = c
        self.num, self.total = num, total
        url = BASE_URL + caminho

        c.setFillColorRGB(*INK)
        c.setFont("Helvetica-Bold", 10)
        c.drawString(M, H - 48, "364 FOOD SERVICES")
        c.setFont("Helvetica-Bold", 15)
        c.drawString(M, H - 70, titulo)
        c.setFillColorRGB(*GRAY)
        c.setFont("Helvetica-Oblique", 8.5)
        c.drawString(M, H - 84, "Preencher à mão nesta ficha e depois lançar no sistema web (QR code ao lado).")

        # QR do módulo no sistema
        qsize = 78
        qx, qy = W - M - qsize, H - 58 - qsize
        widget = QrCodeWidget(url)
        b = widget.getBounds()
        d = Drawing(qsize, qsize, transform=[qsize / (b[2] - b[0]), 0, 0, qsize / (b[3] - b[1]), 0, 0])
        d.add(widget)
        renderPDF.draw(d, c, qx, qy)
        c.setFont("Helvetica", 6.5)
        c.setFillColorRGB(*GRAY)
        c.drawCentredString(qx + qsize / 2, qy - 8, "Escaneie para abrir no sistema")
        c.drawCentredString(qx + qsize / 2, qy - 16, url.replace("https://", ""))

        c.setStrokeColorRGB(*INK)
        c.setLineWidth(1)
        c.line(M, H - 94, W - M - qsize - 14, H - 94)
        self.y = H - 162          # abaixo do QR

    # ---------- blocos ----------
    def campos(self, campos, h=34):
        """Uma linha de caixas rotuladas. campos = [(label, peso), ...]"""
        c = self.c
        total = sum(p for _, p in campos)
        x = M
        self.y -= h
        for label, peso in campos:
            w = CW * peso / total
            c.setStrokeColorRGB(*LINE)
            c.setLineWidth(0.8)
            c.rect(x, self.y, w, h)
            c.setFillColorRGB(*GRAY)
            c.setFont("Helvetica", 6.3)
            c.drawString(x + 4, self.y + h - 9, label.upper())
            x += w
        self.y -= 8

    def rotulo(self, texto):
        self.y -= 12
        self.c.setFillColorRGB(*INK)
        self.c.setFont("Helvetica-Bold", 9)
        self.c.drawString(M, self.y, texto)
        self.y -= 6

    def tabela(self, headers, pesos, linhas=None, vazias=0, row_h=20):
        """linhas = lista de tuplas pré-impressas (células None ficam em branco)."""
        c = self.c
        total = sum(pesos)
        widths = [CW * p / total for p in pesos]
        # cabeçalho
        self.y -= 17
        x = M
        c.setFillColorRGB(*FILL)
        c.rect(M, self.y, CW, 17, fill=1, stroke=0)
        c.setStrokeColorRGB(*LINE)
        c.setLineWidth(0.8)
        c.rect(M, self.y, CW, 17)
        c.setFillColorRGB(*INK)
        c.setFont("Helvetica-Bold", 7.5)
        for hdr, w in zip(headers, widths):
            c.drawString(x + 4, self.y + 5.5, hdr)
            x += w
        # linhas
        todas = list(linhas or []) + [tuple([None] * len(headers))] * vazias
        for linha in todas:
            self.y -= row_h
            c.setStrokeColorRGB(*LINE)
            c.rect(M, self.y, CW, row_h)
            x = M
            c.setFillColorRGB(*INK)
            c.setFont("Helvetica", 8)
            for cell, w in zip(linha, widths):
                if x > M:
                    c.line(x, self.y, x, self.y + row_h)
                if cell:
                    c.drawString(x + 4, self.y + row_h / 2 - 3, str(cell))
                x += w
        # divisórias verticais do cabeçalho
        x = M
        for w in widths[:-1]:
            x += w
            c.line(x, self.y + row_h * len(todas) if todas else self.y, x, self.y + row_h * len(todas) + 17)
        self.y -= 8

    def checks(self, label, opcoes, marcar=None):
        c = self.c
        self.y -= 18
        x = M
        c.setFillColorRGB(*INK)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(x, self.y, label)
        x += c.stringWidth(label, "Helvetica-Bold", 9) + 12
        c.setFont("Helvetica", 9)
        for op in opcoes:
            c.setStrokeColorRGB(*INK)
            c.setLineWidth(0.9)
            c.rect(x, self.y - 1.5, 9, 9)
            x += 14
            c.drawString(x, self.y, op)
            x += c.stringWidth(op, "Helvetica", 9) + 16
        self.y -= 8

    def obs(self, linhas=3):
        c = self.c
        self.y -= 16
        c.setFillColorRGB(*INK)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(M, self.y, "Observações:")
        c.setStrokeColorRGB(*LINE)
        c.setLineWidth(0.7)
        for _ in range(linhas):
            self.y -= 17
            c.line(M, self.y, W - M, self.y)
        self.y -= 8

    def nota(self, texto):
        self.y -= 11
        self.c.setFillColorRGB(*GRAY)
        self.c.setFont("Helvetica-Oblique", 7.5)
        self.c.drawString(M, self.y, texto)
        self.y -= 4

    def rodape(self):
        c = self.c
        y = 118
        c.setStrokeColorRGB(*INK)
        c.setLineWidth(0.8)
        c.line(M, y, W - M, y)
        c.setFillColorRGB(*GRAY)
        c.setFont("Helvetica-Oblique", 8)
        c.drawString(M, y - 13, "Conferência do lançamento no sistema web (preenchido por quem digitar os dados depois):")
        boxes = [("Lançado por", 0.40), ("Data do lançamento", 0.30), ("Conferido", 0.30)]
        x = M
        for label, peso in boxes:
            w = CW * peso
            c.setStrokeColorRGB(*LINE)
            c.rect(x, y - 52, w, 32)
            c.setFillColorRGB(*GRAY)
            c.setFont("Helvetica", 6.3)
            c.drawString(x + 4, y - 29, label.upper())
            if label == "Conferido":
                c.setStrokeColorRGB(*INK)
                c.rect(x + w / 2 - 5, y - 46, 10, 10)
            x += w
        c.setFillColorRGB(*GRAY)
        c.setFont("Helvetica", 7)
        c.drawCentredString(W / 2, 28, f"Ficha {self.num}/{self.total}  ·  364 Food Services  ·  Fichas v2 — julho/2026")
        c.showPage()


def gerar(saida):
    c = canvas.Canvas(saida, pagesize=A4)
    c.setTitle("364 Food Services — Fichas de Controle v2")
    TOTAL = 8

    # ---------- 1. RECEBIMENTO ----------
    f = Ficha(c, "Ficha de Recebimento de Matéria-Prima", "/recebimentos", 1, TOTAL)
    f.campos([("Data de recebimento", 1), ("Fornecedor", 2)])
    f.campos([("Nº Nota Fiscal", 1), ("Responsável", 2)])
    f.rotulo("Itens da nota (matérias-primas — preencha só as linhas que vierem)")
    f.tabela(["#", "Matéria-prima", "Quantidade (kg)", "Custo unitário (R$)", "Validade"],
             [0.5, 4, 1.6, 1.8, 1.6],
             linhas=[(str(i), None, None, None, None) for i in range(1, 7)], row_h=22)
    f.nota("Cada item da nota gera automaticamente o próprio lote no sistema (LT-DD/MM/AA-XXX, numeração sequencial do dia).")
    f.nota("Costela: preço-alvo de compra R$ 20,00/kg — até esse valor o sistema sinaliza \"bom momento para estocar\".")
    f.obs(3)
    f.rodape()

    # ---------- 2. DEFUMAÇÃO ----------
    f = Ficha(c, "Ficha de Defumação", "/producoes", 2, TOTAL)
    f.campos([("Data da produção", 1.2), ("Início da defumação (hora)", 1), ("Fim da defumação (hora)", 1), ("Temperatura (°C)", 1)])
    f.campos([("Responsável pela defumação", 1)])
    f.rotulo("Matérias-primas defumadas nesta ficha")
    f.tabela(["Matéria-prima", "Peso bruto (kg)", "Perda na limpeza (kg)", "Sobra aproveitável (kg)", "Peso defumado (kg)"],
             [2.6, 1.3, 1.5, 1.5, 1.4],
             vazias=6, row_h=22)
    f.nota("Peso bruto = MP crua que entrou na manipulação. Peso defumado = proteína pronta que sai para a embalagem.")
    f.nota("Rendimento = peso defumado ÷ peso bruto. O sistema alerta quando o rendimento fica abaixo de 40%.")
    f.obs(3)
    f.rodape()

    # ---------- 3. EMBALAGEM ----------
    f = Ficha(c, "Ficha de Embalagem", "/embalagem", 3, TOTAL)
    f.campos([("Data da embalagem", 1), ("Responsável pela manipulação", 1.6), ("Sobra de material (kg)", 1)])
    f.rotulo("Produtos embalados nesta ficha")
    f.tabela(["Código", "Produto", "Quantidade embalada (un)", "Peso final dos produtos (kg)"],
             [1.1, 3.4, 2.1, 2.1],
             linhas=[(cod, nome, None, None) for cod, nome, _ in CATALOGO] + [(None, None, None, None)] * 2,
             row_h=20)
    f.nota("A embalagem baixa o estoque de proteína defumada conforme a ficha técnica do produto e gera o estoque de produto acabado.")
    f.obs(2)
    f.rodape()

    # ---------- 4. PEDIDO DE VENDA ----------
    f = Ficha(c, "Ficha de Pedido de Venda", "/pedidos", 4, TOTAL)
    f.campos([("Data do pedido", 1), ("Cliente", 2), ("Responsável", 1.4)])
    f.rotulo("Itens do pedido (preencha a quantidade dos produtos vendidos)")
    f.tabela(["Código", "Produto", "Varejo (R$)", "Quantidade (un)", "Preço unit. (R$)"],
             [1.1, 3.3, 1.2, 1.6, 1.6],
             linhas=[(cod, nome, preco, None, None) for cod, nome, preco in CATALOGO],
             row_h=20)
    f.nota("Preço unitário em branco → o sistema usa a tabela de preços do cliente (B2B) ou, se não houver, o preço de varejo.")
    f.checks("Status do pedido:", ["Pendente", "Faturado", "Enviado", "Cancelado"])
    f.obs(2)
    f.rodape()

    # ---------- 5. CADASTRO DE CLIENTE ----------
    f = Ficha(c, "Ficha de Cadastro de Cliente", "/clientes", 5, TOTAL)
    f.campos([("Nome / Razão social", 1)])
    f.campos([("CNPJ/CPF", 1), ("Telefone", 1)])
    f.campos([("Contato", 1)])
    f.checks("Tipo de cliente:", ["Revenda", "Distribuidor", "Food Service", "Consumidor Final"])
    f.rotulo("Tabela de preços B2B deste cliente (opcional — preencha só se houver preço especial)")
    f.tabela(["Código", "Produto", "Varejo (R$)", "Preço para este cliente (R$)"],
             [1.1, 3.6, 1.3, 2.4],
             linhas=[(cod, nome, preco, None) for cod, nome, preco in CATALOGO],
             row_h=18)
    f.nota("Com preço B2B cadastrado, os pedidos deste cliente usam esse valor automaticamente.")
    f.obs(2)
    f.rodape()

    # ---------- 6. CADASTRO DE FORNECEDOR ----------
    f = Ficha(c, "Ficha de Cadastro de Fornecedor", "/fornecedores", 6, TOTAL)
    f.campos([("Nome / Razão social", 1)])
    f.campos([("CNPJ", 1), ("Categoria", 1)])
    f.campos([("Contato", 1), ("Telefone", 1)])
    f.campos([("E-mail", 1)])
    f.nota("Categoria: ex. Proteína, Embalagens, Insumos, Transporte.")
    f.obs(4)
    f.rodape()

    # ---------- 7. DESPESAS ----------
    f = Ficha(c, "Ficha de Despesas Operacionais", "/despesas", 7, TOTAL)
    f.rotulo("Lançamentos do período (uma linha por despesa)")
    f.tabela(["Data", "Descrição", "Valor (R$)", "Responsável"],
             [1.2, 4.2, 1.4, 2],
             vazias=14, row_h=22)
    f.nota("Cada linha vira um lançamento em Despesas no sistema.")
    f.obs(2)
    f.rodape()

    # ---------- 8. ASSINATURA (BOX MENSAL) ----------
    f = Ficha(c, "Ficha de Assinatura — Box Mensal", "/assinaturas", 8, TOTAL)
    f.campos([("Cliente", 1)])
    f.checks("Plano:", ["Bronze", "Prata", "Ouro"])
    f.campos([("Valor mensal (R$)", 1), ("Dia de entrega (1–28)", 1), ("Início", 1)])
    f.rotulo("Registro de entregas mensais")
    f.tabela(["Competência (AAAA-MM)", "Data da entrega", "Status (Entregue / Pulada)", "Valor (R$)"],
             [1.6, 1.4, 2, 1.3],
             vazias=8, row_h=22)
    f.nota("Status possíveis no sistema: Pendente, Entregue, Pulada. Assinatura pode ser Ativa, Pausada ou Cancelada.")
    f.obs(2)
    f.rodape()

    c.save()


if __name__ == "__main__":
    aqui = os.path.dirname(os.path.abspath(__file__))
    saida = os.path.join(aqui, "364_Fichas_Impressas_v2.pdf")
    gerar(saida)
    print("Gerado:", saida)
