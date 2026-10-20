FROM node:22.14.0-bookworm-slim AS assembly
FROM python:3.12.8-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /preview
COPY services/preview/requirements.txt /preview/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=assembly /usr/local/bin/node /usr/local/bin/node
COPY kits/ /source/kits/
COPY config/registry/ /source/config/registry/
COPY config/kits/overlay.json /source/config/kits/overlay.json
COPY schemas/recipe.schema.json /source/schemas/recipe.schema.json
COPY services/preview/ /source/services/preview/
ARG PREVIEW_RECIPE_JSON=
RUN if [ -n "$PREVIEW_RECIPE_JSON" ]; then \
      printf '%s' "$PREVIEW_RECIPE_JSON" > /source/recipe.json && \
      node /source/services/preview/assemble.mjs /assembled --recipe /source/recipe.json; \
    else node /source/services/preview/assemble.mjs /assembled; fi
RUN cp -a /assembled/. /preview/
COPY services/preview/check_tree.py /preview/check_tree.py
RUN python check_tree.py /preview
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
