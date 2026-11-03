from .base_vectorbuilder  import BaseVectorBuilder

class IntFloatVectorBuilder(BaseVectorBuilder):

    def __init__(
        self, 
        db_path: str = "./chroma_db", 
        collection_name: str = "knowledge_base"):
        
        super().__init__(
            model_name="intfloat/multilingual-e5-large-instruct",
            db_path=db_path,
            collection_name=collection_name
        )
        
    def _prepare_texts_for_embedding(self, knowledge_data: list[str]) -> list[str]:
        """
        實作 E5-instruct 的 'passage:' 前綴。
        """
        self.logger.info("正在為 E5-instruct 模型加上 'passage:' 前綴...")
        return [f"passage: {chunk}" for chunk in knowledge_data]

    def query(self, query_text: str, top_k: int = 3) -> dict:
        """
        實作 E5-instruct 的 'query:' 查詢。
        """
        self.logger.info(f"收到 E5 查詢: '{query_text}'")
        # 【關鍵】為 E5-instruct 加上 'query: ' 前綴
        query_with_prefix = f"query: {query_text}"
        
        # 1. 將查詢轉換為向量
        query_embedding = self.model.encode(query_with_prefix, normalize_embeddings=True)
        
        # 2. 查詢 ChromaDB
        try:
            results = self.collection.query(
                query_embeddings=[query_embedding.tolist()], # 轉換為 list
                n_results=top_k
            )
            self.logger.info("查詢完成。")
            return results
        except Exception as e:
            self.logger.error(f"查詢 ChromaDB 失敗: {e}")
            return {}