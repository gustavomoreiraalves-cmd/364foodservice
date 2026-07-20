"""Audit logging model"""
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, JSON
from datetime import datetime
from app.models.base import Base


class AuditLog(Base):
    """Registro completo de todas as ações críticas no sistema"""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    usuario_id = Column(Integer, ForeignKey("usuarios.id"), nullable=True)
    acao = Column(String(100), nullable=False)  # create, update, delete, login, etc
    tabela = Column(String(100), nullable=False)  # qual tabela foi afetada
    registro_id = Column(Integer, nullable=True)  # qual registro (ID)
    descricao = Column(Text, nullable=True)
    valor_anterior = Column(JSON, nullable=True)  # para updates
    valor_novo = Column(JSON, nullable=True)  # para updates
    ip_address = Column(String(45), nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
