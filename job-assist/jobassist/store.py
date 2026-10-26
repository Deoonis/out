"""Хранилище состояния приложения в SQLite: одна строка на раздел, запись в транзакции."""
import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path

APP_NAME = "JobAssist"


def data_dir() -> Path:
    """Стандартная папка данных пользователя: %APPDATA% в Windows, ~/.local/share в Linux/macOS."""
    base = os.environ.get("APPDATA") or os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    d = Path(base) / APP_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


class Store:
    def __init__(self, path: Path | None = None):
        self.path = Path(path) if path else data_dir() / "jobassist.db"
        with closing(self._db()) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)")

    def _db(self):
        return sqlite3.connect(self.path)

    def load(self) -> dict:
        with closing(self._db()) as db:
            return {k: json.loads(v) for k, v in db.execute("SELECT key, value FROM kv")}

    def save(self, state: dict) -> None:
        if not isinstance(state, dict):
            raise ValueError("state must be an object")
        with closing(self._db()) as db, db:
            db.execute("DELETE FROM kv")
            db.executemany("INSERT INTO kv VALUES (?, ?)",
                           [(k, json.dumps(v, ensure_ascii=False)) for k, v in state.items()])
