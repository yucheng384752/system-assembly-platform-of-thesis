FROM python:3.12.8-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /system/backend
COPY deployment/backend/requirements.txt /system/requirements.txt
RUN pip install --no-cache-dir -r /system/requirements.txt
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app
COPY backend/ /system/backend/
COPY kits/ /system/kits/
COPY permissions/ /system/permissions/
RUN mkdir -p /system/data/uploads /system/data/logs && chown -R app:app /system/data /system/permissions
USER 10001:10001
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
