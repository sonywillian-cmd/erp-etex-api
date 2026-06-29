# -*- coding: utf-8 -*-
"""Genera el formulario PDF de datos del empleado (E-Tex 360)."""
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER

OUT = r"C:\Users\sony_\Downloads\Formulario_Datos_Empleado_ETEX.pdf"

NAVY = colors.HexColor("#1e3a8a")
ORANGE = colors.HexColor("#F97316")
GREY = colors.HexColor("#64748b")
LINE = colors.HexColor("#94a3b8")
LIGHT = colors.HexColor("#eef2ff")

styles = getSampleStyleSheet()
P = ParagraphStyle("p", parent=styles["Normal"], fontSize=8.5, leading=11, textColor=colors.HexColor("#0f172a"))
LBL = ParagraphStyle("lbl", parent=P, fontSize=7.5, textColor=GREY)
SECT = ParagraphStyle("sect", parent=styles["Normal"], fontSize=9.5, leading=12, textColor=colors.white, fontName="Helvetica-Bold")
H1 = ParagraphStyle("h1", parent=styles["Title"], fontSize=16, leading=18, textColor=colors.HexColor("#0f172a"))
SUB = ParagraphStyle("sub", parent=P, fontSize=8, textColor=GREY)
DECL = ParagraphStyle("decl", parent=P, fontSize=7.8, leading=10.5, textColor=GREY)

story = []

def encabezado():
    t = Table([[Paragraph("SONY ROSARIO PUBLICIDAD TEXTIL S.R.L.", H1)],
               [Paragraph("Formulario de datos del colaborador  ·  E-Tex 360", SUB)]],
              colWidths=[180*mm])
    t.setStyle(TableStyle([("LEFTPADDING",(0,0),(-1,-1),0),("BOTTOMPADDING",(0,0),(-1,-1),1),("TOPPADDING",(0,0),(-1,-1),0)]))
    story.append(t)
    story.append(HRFlowable(width="100%", thickness=2.2, color=ORANGE, spaceBefore=4, spaceAfter=8))

def seccion(titulo):
    t = Table([[Paragraph(titulo, SECT)]], colWidths=[180*mm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),NAVY),("LEFTPADDING",(0,0),(-1,-1),6),
                           ("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3)]))
    story.append(Spacer(1,5)); story.append(t); story.append(Spacer(1,4))

def campos(filas):
    """filas: lista de filas; cada fila = lista de (label, ancho_mm)."""
    data = []
    styl = [("VALIGN",(0,0),(-1,-1),"BOTTOM"),("TOPPADDING",(0,0),(-1,-1),8),
            ("BOTTOMPADDING",(0,0),(-1,-1),2),("LEFTPADDING",(0,0),(-1,-1),1),("RIGHTPADDING",(0,0),(-1,-1),6)]
    cw = []
    for r, fila in enumerate(filas):
        celdas = []
        for c,(lbl,_) in enumerate(fila):
            celdas.append(Paragraph(lbl, LBL))
            styl.append(("LINEBELOW",(c,r),(c,r),0.6,LINE))
        data.append(celdas)
        if not cw:
            cw = [w*mm for (_,w) in fila]
    t = Table(data, colWidths=cw, rowHeights=[15*mm]*len(filas) if False else None)
    t.setStyle(TableStyle(styl))
    story.append(t)

def checks(items, cols=3):
    data=[]; row=[]
    for i,it in enumerate(items):
        row.append(Paragraph(u"[    ]  "+it, P))
        if len(row)==cols: data.append(row); row=[]
    if row:
        while len(row)<cols: row.append(Paragraph("",P))
        data.append(row)
    w=180/cols
    t=Table(data,colWidths=[w*mm]*cols)
    t.setStyle(TableStyle([("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3),("LEFTPADDING",(0,0),(-1,-1),1)]))
    story.append(t)

encabezado()
story.append(Paragraph("Por favor complete con letra clara. Los campos marcados (RRHH) los llena la empresa.", SUB))

seccion("1 · DATOS PERSONALES")
campos([
    [("Nombre completo",118),("Cédula / Pasaporte",62)],
    [("Fecha de nacimiento",58),("Sexo (M/F)",30),("Estado civil",40),("Nacionalidad",46)],
    [("Dirección",120),("Sector / Ciudad",60)],
    [("Teléfono personal",60),("Teléfono alternativo",60),("Correo electrónico",60)],
])

seccion("2 · CONTACTO DE EMERGENCIA")
campos([
    [("Nombre",100),("Parentesco",80)],
    [("Tel. principal",60),("Tel. secundario",60),("Dirección",60)],
])

seccion("3 · FAMILIA Y EDUCACIÓN")
campos([
    [("¿Tiene hijos? (Sí/No)",55),("Cantidad de hijos",40),("Nivel educativo",85)],
    [("Profesión",60),("Carrera estudiada",60),("Institución educativa",60)],
    [("Cursos / certificaciones",180)],
])

seccion("4 · INFORMACIÓN BANCARIA (para pago de nómina)")
campos([
    [("Banco",70),("Tipo de cuenta (Ahorro/Corriente)",60),("No. de cuenta",50)],
    [("Titular de la cuenta",180)],
])

seccion("5 · SALUD Y SEGURIDAD SOCIAL")
campos([
    [("Tipo de sangre",40),("ARS",70),("AFP",70)],
    [("¿Condición médica? ¿Cuál?",90),("¿Alergias? ¿Cuáles?",90)],
])

seccion("6 · HABILIDADES (califica de 1 a 5)")
campos([
    [("Excel",34),("Word",34),("PowerPoint",38),("Sistema/ERP",36),("Diseño gráfico",38)],
    [("Otros conocimientos",180)],
])

seccion("7 · TALLAS (uniforme)")
campos([
    [("Camisa",55),("Pantalón",55),("Zapatos",55)],
])

seccion("8 · INTERESES")
campos([
    [("Pasatiempos",90),("Deportes favoritos",90)],
    [("Metas profesionales",180)],
    [("Expectativas con la empresa",180)],
])

seccion("9 · DOCUMENTOS ENTREGADOS  (uso RRHH)")
checks(["Copia de cédula","Currículum","Certificado médico","Buena conducta",
        "Certif. académicas","Foto 2x2","Cuenta bancaria","Contrato firmado"], cols=4)

seccion("10 · USO INTERNO RRHH")
campos([
    [("Fecha de ingreso",50),("Departamento",65),("Cargo",65)],
    [("Supervisor inmediato",60),("Tipo de contrato",60),("Horario",60)],
    [("Sucursal",60),("Salario (RD$)",60),("Código empleado",60)],
])

story.append(Spacer(1,8))
story.append(Paragraph(
    "Declaro que la información suministrada es verídica y autorizo a SONY ROSARIO PUBLICIDAD TEXTIL S.R.L. "
    "a usarla para fines laborales y de nómina, conforme a la Ley 172-13 de protección de datos.", DECL))
story.append(Spacer(1,14))
firma = Table([[Paragraph("Firma del colaborador", LBL), Paragraph("Fecha", LBL)]],
              colWidths=[110*mm,70*mm])
firma.setStyle(TableStyle([("LINEABOVE",(0,0),(0,0),0.6,LINE),("LINEABOVE",(1,0),(1,0),0.6,LINE),
                           ("TOPPADDING",(0,0),(-1,-1),3),("LEFTPADDING",(0,0),(-1,-1),1),("RIGHTPADDING",(0,0),(-1,-1),20)]))
story.append(Spacer(1,16)); story.append(firma)

doc = SimpleDocTemplate(OUT, pagesize=letter, leftMargin=15*mm, rightMargin=15*mm, topMargin=12*mm, bottomMargin=12*mm,
                        title="Formulario de datos del colaborador")
doc.build(story)
print("OK ->", OUT)
