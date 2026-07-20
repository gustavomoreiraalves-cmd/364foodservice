"""Organization models: Grupo, Empresa, Unidade"""
from sqlalchemy import Column, Integer, String, Boolean, ForeignKey, DateTime, func
from sqlalchemy.orm import relationship
from datetime import datetime
from app.models.base import Base, BaseModel


class Grupo(Base, BaseModel):
    """Grupo empresarial (ex: Grupo 364)"""
    __tablename__ = "grupos"

    id = Column(Integer, primary_key=True, index=True)
    nome = Column(String(255), nullable=False, unique=True)
    descricao = Column(String(1000), nullable=True)
    ativo = Column(Boolean, default=True, nullable=False)

    empresas = relationship("Empresa", back_populates="grupo", cascade="all, delete-orphan")


class Empresa(Base, BaseModel):
    """Empresa dentro do Grupo (ex: 364 Steakhouse)"""
    __tablename__ = "empresas"

    id = Column(Integer, primary_key=True, index=True)
    grupo_id = Column(Integer, ForeignKey("grupos.id"), nullable=False)
    nome = Column(String(255), nullable=False)
    cnpj = Column(String(18), nullable=True, unique=True)
    descricao = Column(String(1000), nullable=True)
    ativo = Column(Boolean, default=True, nullable=False)

    grupo = relationship("Grupo", back_populates="empresas")
    unidades = relationship("Unidade", back_populates="empresa", cascade="all, delete-orphan")


class Unidade(Base, BaseModel):
    """Unidade operacional dentro de uma Empresa (ex: Filial, Operação)"""
    __tablename__ = "unidades"

    id = Column(Integer, primary_key=True, index=True)
    empresa_id = Column(Integer, ForeignKey("empresas.id"), nullable=False)
    nome = Column(String(255), nullable=False)
    descricao = Column(String(1000), nullable=True)
    tipo = Column(String(50), nullable=True)  # filial, matriz, operacao, etc
    ativo = Column(Boolean, default=True, nullable=False)

    empresa = relationship("Empresa", back_populates="unidades")
