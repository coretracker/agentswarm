import { createHmac, timingSafeEqual } from "node:crypto";

const SLACK_SIGNATURE_VERSION = "v0";
const SLACK_SIGNATURE_MAX_AGE_SECONDS = 60 * 5;

export type SlackSignatureFailureReason =
  | "missing_headers"
  | "timestamp_invalid"
  | "timestamp_skew"
  | "signature_mismatch";

export type SlackSignatureVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason: SlackSignatureFailureReason;
    };

export const verifySlackRequestSignatureDetailed = (
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  signingSecret: string,
  nowMs = Date.now()
): SlackSignatureVerificationResult => {
  if (!timestampHeader || !signatureHeader?.startsWith(`${SLACK_SIGNATURE_VERSION}=`)) {
    return { ok: false, reason: "missing_headers" };
  }

  const timestampSeconds = Number(timestampHeader);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, reason: "timestamp_invalid" };
  }

  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - timestampSeconds);
  if (ageSeconds > SLACK_SIGNATURE_MAX_AGE_SECONDS) {
    return { ok: false, reason: "timestamp_skew" };
  }

  const base = `${SLACK_SIGNATURE_VERSION}:${timestampHeader}:${rawBody}`;
  const expected = `${SLACK_SIGNATURE_VERSION}=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);
  if (expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    return { ok: false, reason: "signature_mismatch" };
  }
  return { ok: true };
};

export const verifySlackRequestSignature = (
  rawBody: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  signingSecret: string,
  nowMs = Date.now()
): boolean => verifySlackRequestSignatureDetailed(rawBody, timestampHeader, signatureHeader, signingSecret, nowMs).ok;
