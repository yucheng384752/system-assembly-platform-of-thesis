FROM node:22.14.0-bookworm-slim AS assembly
WORKDIR /source
COPY kits/ kits/
COPY services/preview/ services/preview/
RUN node services/preview/assemble.mjs /assembled

FROM python:3.12.8-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /preview
COPY services/preview/requirements.txt /preview/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=assembly /assembled/ /preview/
COPY services/preview/check_tree.py /preview/check_tree.py
RUN python check_tree.py /preview
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
