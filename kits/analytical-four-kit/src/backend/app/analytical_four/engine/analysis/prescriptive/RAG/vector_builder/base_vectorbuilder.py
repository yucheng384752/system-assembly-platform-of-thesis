import numpy as np
from sentence_transformers import SentenceTransformer
import logging
from abc import ABC, abstractmethod
import chromadb  # 匯入 chromadb

class BaseVectorBuilder(ABC):
    
    def __init__(self, 
                 model_name: str, 
                 db_path: str = "./chroma_db", 
                 collection_name: str = "knowledge_base"):
        """
        初始化 BaseVectorBuilder。
        
        Args:
            model_name (str): 要載入的 SentenceTransformer 模型名稱。
            db_path (str): ChromaDB 實體檔案的儲存路徑。
            collection_name (str): ChromaDB 中的集合名稱 (類似資料表)。
        """
        logging.basicConfig(level=logging.INFO)
        self.logger = logging.getLogger(self.__class__.__name__)
        
        self.load_model(model_name)
        
        # 初始化 ChromaDB (持久化儲存)
        self.logger.info(f"正在初始化/載入 ChromaDB，路徑: {db_path}，集合: {collection_name}")
        try:
            # 建立一個持久化的 Client，將資料儲存到 db_path
            self.client = chromadb.PersistentClient(path=db_path)
            # 獲取或建立一個 collection
            self.collection = self.client.get_or_create_collection(name=collection_name)
            self.logger.info("ChromaDB 載入完成。")
        except Exception as e:
            self.logger.error(f"ChromaDB 初始化失敗: {e}")
            raise e
    
    def load_model(self, model_name: str):
        """
        載入 SentenceTransformer 模型。
        """
        self.logger.info(f"正在載入 '{model_name}' 模型...")
        try:
            self.model = SentenceTransformer(model_name)
            self.logger.info("模型載入完成。")
        except Exception as e:
            self.logger.error(f"模型載入失敗: {e}")
            raise e
    
    def load_csv_knowledge(self, file_path: str) -> list[str]:
        """
        從 CSV/TXT 檔案載入知識資料。(假設一行一筆)
        """
        self.logger.info(f"正在從 '{file_path}' 載入知識資料...")
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                knowledge_data = [line.strip() for line in f if line.strip()]
            self.logger.info(f"成功載入 {len(knowledge_data)} 條知識資料。")
            return knowledge_data
        except Exception as e:
            self.logger.error(f"載入知識資料失敗: {e}")
            raise e
    
    @abstractmethod
    def _prepare_texts_for_embedding(self, knowledge_data: list[str]) -> list[str]:
        """
        【新】準備用於 embedding 的文本。
        子類別必須實作此方法，以處理特定模型的前綴 (例如 'passage: ')。
        """
        pass
        
    def build_vector_database(self, knowledge_data: list[str]):
        """
        【修改】建立向量資料庫的通用邏輯。
        """
        self.logger.info("正在建立向量資料庫...")
        try:
            # 1. 呼叫子類別的方法來準備文本
            prepared_texts = self._prepare_texts_for_embedding(knowledge_data)
            
            # 2. 產生 Embeddings
            self.logger.info("正在產生 Embeddings...")
            embeddings = self.model.encode(prepared_texts, normalize_embeddings=True)
            
            # 3. 準備要存入 ChromaDB 的資料
            documents = knowledge_data  # 儲存原始文本
            ids = [f"doc_{i}" for i in range(len(documents))] # 建立唯一的 ID
            
            # 4. 整批加入 ChromaDB
            self.collection.add(
                embeddings=embeddings,
                documents=documents,
                ids=ids
            )
            self.logger.info(f"向量資料庫建立完成。已新增 {len(ids)} 筆文件。")
            
        except Exception as e:
            self.logger.error(f"建立向量資料庫失敗: {e}")
            raise e

    def build_vector_database_if_needed(self, knowledge_data: list[str]) -> bool:
        """
        Args:
            knowledge_data (list[str]): 知識資料列表
            
        Returns:
            bool: True 表示執行了構建，False 表示已跳過
        """
        try:
            # 1. 檢查是否已有資料
            existing_count = self.collection.count()
            new_count = len(knowledge_data)
            
            # 2. 若資料數量相同，跳過重建
            if existing_count == new_count and existing_count > 0:
                self.logger.info(
                    f"向量庫已存在 ({existing_count} 筆文件)，"
                    f"知識庫無變更，跳過重建階段 → 直接進入查詢階段"
                )
                return False
            
            # 3. 否則執行完整構建（首次或知識庫有變更）
            if existing_count != new_count:
                self.logger.info(
                    f"偵測到知識庫變更 (現有: {existing_count}, 新增: {new_count})，"
                    f"執行向量庫重建..."
                )
            else:
                self.logger.info("首次初始化向量庫...")
            
            self.build_vector_database(knowledge_data)
            return True
            
        except Exception as e:
            self.logger.error(f"條件性構建失敗: {e}")
            raise e

    @abstractmethod
    def query(self, query_text: str, top_k: int = 3) -> dict:
        """
        子類別必須實作此方法以處理特定模型的查詢前綴 (例如 'query: ')。
        """
        pass
    
    