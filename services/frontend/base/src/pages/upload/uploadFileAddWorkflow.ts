import type { UploadedFile } from "./uploadTypes";
import { buildUploadFilesToAdd } from "./uploadFileAddUtils";
import { showFileAddResultToasts } from "./uploadFileAddToastUtils";

type ToastType = "success" | "error" | "info";
type ShowToast = (type: ToastType, message: string, options?: { key?: string; durationMs?: number | null }) => void;
type TranslationFn = (key: string, values?: Record<string, unknown>) => string;

interface AddUploadFilesWorkflowOptions {
  fileList: FileList | null;
  existingFiles: UploadedFile[];
  setFiles: (updater: (files: UploadedFile[]) => UploadedFile[]) => void;
  confirmLikelyDuplicate: (file: File) => boolean;
  showToast: ShowToast;
  t: TranslationFn;
  availableCodes?: string[];
}

export function runAddUploadFilesWorkflow({
  fileList,
  existingFiles,
  setFiles,
  confirmLikelyDuplicate,
  showToast,
  t,
  availableCodes,
}: AddUploadFilesWorkflowOptions): void {
  // availableCodes was previously declared on this options type but never
  // destructured/forwarded, so buildUploadFilesToAdd() always fell back to its
  // default `[]` regardless of what the caller passed. That silently disabled
  // registry-based table-code detection for every upload, no matter how
  // correctly the caller populated availableCodes.
  const result = buildUploadFilesToAdd({
    fileList,
    existingFiles,
    confirmLikelyDuplicate,
    availableCodes,
  });

  showFileAddResultToasts({
    notices: result.notices,
    addedCount: result.files.length,
    showToast,
    t,
  });

  if (result.files.length) {
    setFiles((prev) => [...prev, ...result.files]);
  }
}
