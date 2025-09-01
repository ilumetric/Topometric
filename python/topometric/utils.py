from __future__ import annotations

import os
from typing import Optional


def is_houdini() -> bool:
    """Возвращает True, если код выполняется внутри Houdini."""
    try:
        import hou  # type: ignore
        return bool(hou)
    except Exception:
        return False


def get_repo_root() -> Optional[str]:
    """Возвращает путь к корню репозитория из переменной окружения TOPOMETRIC_ROOT."""
    # читаем путь из переменной окружения, если она задана
    return os.environ.get("TOPOMETRIC_ROOT")


def show_info(message: str) -> None:
    """Показывает информационное сообщение через UI Houdini или печатает в консоль."""
    # пытаемся показать окно в houdini, иначе печатаем
    if is_houdini():
        try:
            import hou  # type: ignore
            hou.ui.displayMessage(str(message))
            return
        except Exception:
            pass
    print(str(message))


