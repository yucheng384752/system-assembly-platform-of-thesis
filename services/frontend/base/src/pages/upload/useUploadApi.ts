import { useMemo } from "react";
import { TENANT_STORAGE_KEY } from "../../services/tenant";
import { getApiKeyHeaderName, getApiKeyValue } from "../../services/auth";
import { createUploadApiClient } from "./uploadApiClient";

type TranslationFn = (key: string) => string;

function buildTenantHeaders(): HeadersInit {
  const tenantId = window.localStorage.getItem(TENANT_STORAGE_KEY) || "";
  const apiKey = getApiKeyValue();
  const h: Record<string, string> = {};
  if (tenantId) h["X-Tenant-Id"] = tenantId;
  // Was missing entirely: every upload-page request (fetchAvailableForms,
  // createImportJob, ...) went out unauthenticated when AUTH_MODE=api_key is
  // enforced. GET /api/forms then 401s, fetchAvailableForms() swallows it and
  // returns [], so availableForms is always empty -> the "please pick manually"
  // dropdown never renders, and detectTableCode() falls back to guessing a
  // code from the filename instead of matching a real registered form.
  if (apiKey) h[getApiKeyHeaderName()] = apiKey;
  return h;
}

export function useUploadApi(t: TranslationFn) {
  return useMemo(
    () => createUploadApiClient({ t, getTenantHeaders: buildTenantHeaders }),
    [t]
  );
}
