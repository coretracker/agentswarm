import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import {
  TASK_PROMPT_ATTACHMENT_MAX_COUNT,
  TASK_PROMPT_ATTACHMENT_MAX_SIZE_BYTES,
  TASK_PROMPT_ATTACHMENT_TOTAL_MAX_BYTES,
  type CreateTaskPromptAttachmentInput,
  type TaskPromptAttachment
} from "@agentswarm/shared-types";
import { env } from "../config/env.js";

const ATTACHMENT_ROOT_DIRNAME = ".prompt-attachments";
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/apng",
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/tiff",
  "image/webp",
  "image/x-icon"
]);

const normalizeBase64 = (value: string): string => value.replace(/\s+/g, "");

const decodeBase64 = (value: string): Buffer => {
  const normalized = normalizeBase64(value);
  if (normalized.length === 0 || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    throw new Error("Attachment data is not valid base64.");
  }
  return Buffer.from(normalized, "base64");
};

const sanitizeAttachmentName = (value: string, mimeType: string): string => {
  const trimmed = value.trim();
  const originalExtension = path.extname(trimmed);
  const fallbackExtension = mimeType === "image/svg+xml" ? ".svg" : mimeType === "image/jpeg" ? ".jpg" : mimeType === "image/png" ? ".png" : "";
  const extension = (originalExtension || fallbackExtension).slice(0, 12).replace(/[^a-z0-9.]/gi, "").toLowerCase();
  const baseName = path
    .basename(trimmed, originalExtension)
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${baseName || "image"}${extension}`;
};

export const normalizeTaskPromptAttachment = (value: unknown): TaskPromptAttachment | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const attachment = value as Partial<TaskPromptAttachment>;
  if (
    typeof attachment.id !== "string" ||
    attachment.id.trim().length === 0 ||
    typeof attachment.name !== "string" ||
    attachment.name.trim().length === 0 ||
    typeof attachment.mimeType !== "string" ||
    !ALLOWED_IMAGE_MIME_TYPES.has(attachment.mimeType) ||
    typeof attachment.sizeBytes !== "number" ||
    !Number.isFinite(attachment.sizeBytes) ||
    attachment.sizeBytes <= 0 ||
    attachment.sizeBytes > TASK_PROMPT_ATTACHMENT_MAX_SIZE_BYTES ||
    typeof attachment.relativePath !== "string" ||
    attachment.relativePath.trim().length === 0
  ) {
    return null;
  }

  const relativePath = attachment.relativePath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
  if (
    relativePath.length === 0 ||
    relativePath.includes("../") ||
    relativePath.startsWith("..") ||
    relativePath.includes("/..")
  ) {
    return null;
  }

  return {
    id: attachment.id,
    name: attachment.name.trim(),
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    relativePath
  };
};

export const resolveTaskPromptAttachmentRoot = (taskId: string): string =>
  path.join(env.TASK_WORKSPACE_ROOT, ATTACHMENT_ROOT_DIRNAME, taskId);

export const resolveTaskPromptAttachmentServerPath = (taskId: string, relativePath: string): string | null => {
  const rootPath = resolveTaskPromptAttachmentRoot(taskId);
  const normalizedRelativePath = relativePath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
  if (
    normalizedRelativePath.length === 0 ||
    normalizedRelativePath.includes("../") ||
    normalizedRelativePath.startsWith("..") ||
    normalizedRelativePath.includes("/..")
  ) {
    return null;
  }

  const fullPath = path.resolve(rootPath, normalizedRelativePath);
  return fullPath === rootPath || fullPath.startsWith(`${rootPath}${path.sep}`) ? fullPath : null;
};

export async function persistTaskPromptAttachments(
  taskId: string,
  uploads: CreateTaskPromptAttachmentInput[] | undefined
): Promise<TaskPromptAttachment[]> {
  const attachments = uploads ?? [];
  if (attachments.length === 0) {
    return [];
  }
  if (attachments.length > TASK_PROMPT_ATTACHMENT_MAX_COUNT) {
    throw new Error(`You can attach up to ${TASK_PROMPT_ATTACHMENT_MAX_COUNT} images per prompt.`);
  }

  const rootPath = resolveTaskPromptAttachmentRoot(taskId);
  await mkdir(rootPath, { recursive: true });

  let totalBytes = 0;
  const persisted: TaskPromptAttachment[] = [];
  for (const upload of attachments) {
    const name = String(upload.name ?? "").trim();
    const mimeType = String(upload.mimeType ?? "").trim().toLowerCase();
    if (!name) {
      throw new Error("Each attachment needs a file name.");
    }
    if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
      throw new Error(`Unsupported image type for ${name}.`);
    }

    const bytes = decodeBase64(String(upload.dataBase64 ?? ""));
    if (bytes.length === 0) {
      throw new Error(`Attachment ${name} is empty.`);
    }
    if (bytes.length > TASK_PROMPT_ATTACHMENT_MAX_SIZE_BYTES) {
      throw new Error(`Attachment ${name} is larger than ${Math.round(TASK_PROMPT_ATTACHMENT_MAX_SIZE_BYTES / (1024 * 1024))} MB.`);
    }

    totalBytes += bytes.length;
    if (totalBytes > TASK_PROMPT_ATTACHMENT_TOTAL_MAX_BYTES) {
      throw new Error(`Attached images must stay under ${Math.round(TASK_PROMPT_ATTACHMENT_TOTAL_MAX_BYTES / (1024 * 1024))} MB total.`);
    }

    const attachmentId = nanoid();
    const safeName = sanitizeAttachmentName(name, mimeType);
    const relativePath = `${attachmentId}-${safeName}`;
    const fullPath = resolveTaskPromptAttachmentServerPath(taskId, relativePath);
    if (!fullPath) {
      throw new Error(`Attachment path for ${name} is invalid.`);
    }

    await writeFile(fullPath, bytes);
    persisted.push({
      id: attachmentId,
      name: safeName,
      mimeType,
      sizeBytes: bytes.length,
      relativePath
    });
  }

  return persisted;
}

export async function readTaskPromptAttachmentBuffer(taskId: string, attachment: TaskPromptAttachment): Promise<Buffer> {
  const fullPath = resolveTaskPromptAttachmentServerPath(taskId, attachment.relativePath);
  if (!fullPath) {
    throw new Error("Attachment path is invalid.");
  }
  return readFile(fullPath);
}
