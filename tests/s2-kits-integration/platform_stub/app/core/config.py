"""測試用的平台設定替身（契約 platform.settings）。只在整合測試載入，不隨任何 Kit 交付。"""


class _Settings:
    jwt_secret = "integration-test-only"
    jwt_algorithm = "HS256"
    access_token_expire_minutes = 60
    password_min_length = 7
    login_max_attempts = 3
    login_lockout_minutes = 15


settings = _Settings()
