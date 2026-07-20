"""Application configuration"""
from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    app_name: str = "364 OS"
    app_version: str = "0.0.1"
    environment: str = "development"
    debug: bool = True

    database_url: str = "postgresql://364_user:364_secure_dev_password_change_in_prod@localhost:5432/364_os"

    secret_key: str = "dev-secret-key-change-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30

    cors_origins: List[str] = ["http://localhost:3000", "http://localhost:8000"]

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
