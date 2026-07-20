"""User models: Usuario, UsuarioPerfil"""
from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, Table
from sqlalchemy.orm import relationship
from datetime import datetime
from app.models.base import Base, BaseModel


class Usuario(Base, BaseModel):
    """Sistema de usuários com acesso às empresas/unidades"""
    __tablename__ = "usuarios"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), nullable=False, unique=True, index=True)
    nome_completo = Column(String(255), nullable=False)
    senha_hash = Column(String(255), nullable=False)
    ativo = Column(Boolean, default=True, nullable=False)
    ultimo_login = Column(DateTime, nullable=True)

    perfis = relationship("UsuarioPerfil", back_populates="usuario", cascade="all, delete-orphan")


class UsuarioPerfil(Base, BaseModel):
    """Associação de usuário com perfil em uma empresa/unidade"""
    __tablename__ = "usuarios_perfis"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=False)
    empresa_id = Column(Integer, ForeignKey("empresas.id"), nullable=False)
    unidade_id = Column(Integer, ForeignKey("unidades.id"), nullable=True)
    perfil = Column(String(50), nullable=False)  # admin, diretor, gestor, financeiro, etc

    usuario = relationship("Usuario", back_populates="perfis")


class Perfil:
    """Enum de perfis disponíveis no sistema"""
    ADMIN = "admin"
    DIRETOR = "diretor"
    GESTOR_UNIDADE = "gestor_unidade"
    FINANCEIRO = "financeiro"
    COMPRAS_ESTOQUE = "compras_estoque"
    PRODUCAO = "producao"
    COMERCIAL_CRM = "comercial_crm"
    RH = "rh"
    OPERADOR = "operador"
    AUDITOR = "auditor"
    AGENTE_IA = "agente_ia"

    ALL = [
        ADMIN,
        DIRETOR,
        GESTOR_UNIDADE,
        FINANCEIRO,
        COMPRAS_ESTOQUE,
        PRODUCAO,
        COMERCIAL_CRM,
        RH,
        OPERADOR,
        AUDITOR,
        AGENTE_IA,
    ]
