import { createHmac, timingSafeEqual } from "node:crypto";

const SLACK_SIGNATURE_VERSION = "v0";
const SLACK_SIGNATURE_MAX_AGE_SECONDS = 60 * 5;

export const verifySlackRequestSignature = (
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  signingSecret: string,
  nowMs = Date.now()
): boolean => {
  if (!timestampHeader || !signatureHeader?.startsWith(`${SLACK_SIGNATURE_VERSION}=`)) {
    return false;
  }

  const timestampSeconds = Number(timestampHeader);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }

  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - timestampSeconds);
  if (ageSeconds > SLACK_SIGNATURE_MAX_AGE_SECONDS) {
    return false;
  }

  const base = `${SLACK_SIGNATURE_VERSION}:${timestampHeader}:${rawBody}`;
  const expected = `${SLACK_SIGNATURE_VERSION}=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
};
