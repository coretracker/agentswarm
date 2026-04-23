import type { CreateTaskPromptAttachmentInput } from "@agentswarm/shared-types";

export interface SelectedTaskPromptImageFile {
  id: string;
  file: File;
}

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error(`Could not read ${file.name}.`));
    };
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });

export const encodeTaskPromptImageFiles = async (
  files: SelectedTaskPromptImageFile[]
): Promise<CreateTaskPromptAttachmentInput[]> =>
  Promise.all(
    files.map(async ({ file }) => {
      const dataUrl = await readFileAsDataUrl(file);
      const commaIndex = dataUrl.indexOf(",");
      if (commaIndex === -1) {
        throw new Error(`Could not encode ${file.name}.`);
      }

      return {
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        dataBase64: dataUrl.slice(commaIndex + 1)
      };
    })
  );

export const formatAttachmentSize = (sizeBytes: number): string => {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
};
