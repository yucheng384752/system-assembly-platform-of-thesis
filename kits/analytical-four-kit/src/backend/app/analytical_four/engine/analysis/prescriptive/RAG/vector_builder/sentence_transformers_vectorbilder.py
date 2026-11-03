from .base_vectorbuilder  import BaseVectorBuilder

class SenTransVectorBuilder(BaseVectorBuilder):

    def __init__(
        self, 
        db_path: str = "./chroma_db", 
        collection_name: str = "knowledge_base"):
        
        super().__init__(
            model_name="paraphrase-multilingual-MiniLM-L12-v2", # 注意：您的工廠用的是這個名字
            db_path=db_path,
            collection_name=collection_name
        )
        
    def _prepare_texts_for_embedding(self, knowledge_data: list[str]) -> list[str]:
        """
        標準模型，不需要前綴，直接回傳原文。
        """
        self.logger.info("使用原始文本進行 embedding...")
        return knowledge_data

    def query(self, query_text: str, top_k: int = 3) -> dict:
        """
        實作標準模型的查詢
        """
        self.logger.info(f"收到標準查詢: '{query_text}'")
        
        # 1. 將查詢轉換為向量
        query_embedding = self.model.encode(query_text, normalize_embeddings=True)
        
        # 2. 查詢 ChromaDB
        try:
            results = self.collection.query(
                query_embeddings=[query_embedding.tolist()],
                n_results=top_k
            )
            self.logger.info("查詢完成。")
            return results
        except Exception as e:
            self.logger.error(f"查詢 ChromaDB 失敗: {e}")
            return {}