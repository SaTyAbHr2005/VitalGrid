import os
from functools import lru_cache

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()


@lru_cache(maxsize=1)
def get_db():
    uri = os.environ.get("MONGODB_URI")
    if not uri:
        raise RuntimeError("MONGODB_URI is not set (copy .env.example to .env and fill it in)")
    client = MongoClient(uri, serverSelectionTimeoutMS=10_000)
    return client[os.environ.get("MONGODB_DB", "aethersphere")]  # Atlas database keeps its original name
