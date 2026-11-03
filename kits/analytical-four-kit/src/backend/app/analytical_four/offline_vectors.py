"""A vector builder that needs no model download, registered as `builtin-hash`.

The Kit's default RAG model (multilingual-e5-large-instruct) is several gigabytes and must be fetched from the internet,
which a closed factory network or a test run cannot do. This builder hashes words and character pairs into a fixed-size
vector. It matches on shared wording only, so it retrieves worse than a real embedding model; use it for demos, tests and
sites that cannot download a model, and say so in the run record (the builder name is part of the settings snapshot).
"""
from __future__ import annotations

import re
import zlib

import numpy as np

from app.analytical_four.engine.analysis.prescriptive.RAG.vector_builder import BaseVectorBuilder, VectorBuilderFactory

BUILDER_NAME = 'builtin-hash'
DIMENSIONS = 512
_WORD = re.compile(r'[a-z0-9]+')
_CJK = re.compile(r'[㐀-鿿]')


def _tokens(text: str) -> list[str]:
    lowered = text.lower()
    tokens = _WORD.findall(lowered)
    cjk = _CJK.findall(lowered)
    tokens += cjk
    tokens += [a + b for a, b in zip(cjk, cjk[1:])]
    return tokens


class HashEncoder:
    """Stands in for SentenceTransformer: `encode` takes one string or a list and returns unit vectors."""

    def encode(self, texts, normalize_embeddings: bool = True):
        single = isinstance(texts, str)
        rows = np.zeros((1 if single else len(texts), DIMENSIONS), dtype=np.float32)
        for row, text in zip(rows, [texts] if single else texts):
            for token in _tokens(text):
                digest = zlib.crc32(token.encode('utf-8'))
                row[digest % DIMENSIONS] += 1.0 if (digest >> 16) & 1 else -1.0
        if normalize_embeddings:
            norms = np.linalg.norm(rows, axis=1, keepdims=True)
            rows = rows / np.where(norms == 0, 1.0, norms)
        return rows[0] if single else rows


class HashVectorBuilder(BaseVectorBuilder):
    def __init__(self, db_path: str = './chroma_db', collection_name: str = 'knowledge_base'):
        super().__init__(model_name=BUILDER_NAME, db_path=db_path, collection_name=collection_name)

    def load_model(self, model_name: str):
        self.model = HashEncoder()

    def _prepare_texts_for_embedding(self, knowledge_data: list[str]) -> list[str]:
        return knowledge_data

    def query(self, query_text: str, top_k: int = 3) -> dict:
        embedding = self.model.encode(query_text, normalize_embeddings=True)
        return self.collection.query(query_embeddings=[embedding.tolist()], n_results=top_k)


VectorBuilderFactory.register(BUILDER_NAME, HashVectorBuilder)
