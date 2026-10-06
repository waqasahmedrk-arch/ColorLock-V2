from __future__ import annotations

from functools import lru_cache

from .services.storage import LocalStorage, S3Storage, make_storage
from .settings import get_settings


@lru_cache
def get_storage() -> LocalStorage | S3Storage:
    return make_storage(get_settings())
