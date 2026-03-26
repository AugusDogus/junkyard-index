import { createCipheriv, pbkdf2Sync } from "node:crypto";

/** Bubble-hosted AutoRecycler app id (Bubble `appname`). */
export const AUTORECYCLER_BUBBLE_APP_NAME = "autoscrapzen";

export interface BubbleObfuscatedBody {
  z: string;
  y: string;
  x: string;
}

function encryptAesCbcPkcs7(
  keyMaterial: string,
  ivMaterial: string,
  plaintext: string,
  appname: string,
): string {
  const derivedKey = pbkdf2Sync(keyMaterial, appname, 7, 32, "md5");
  const derivedIv = pbkdf2Sync(ivMaterial, appname, 7, 16, "md5");
  const cipher = createCipheriv("aes-256-cbc", derivedKey, derivedIv);
  return Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]).toString("base64");
}

/**
 * Build `{ z, y, x }` for JSON-serializable payload (Bubble `/elasticsearch/*` requests).
 */
export function encryptBubbleObfuscatedBody(
  data: unknown,
  appname: string,
  options: { timestampMs: number; randomIv?: number },
): BubbleObfuscatedBody {
  const version = "1";
  const curTs = String(options.timestampMs);
  const timestampVersion = `${curTs}_${version}`;
  const key = appname + curTs;
  const iv = String(options.randomIv ?? Math.random());
  return {
    z: encryptAesCbcPkcs7(key, iv, JSON.stringify(data), appname),
    y: encryptAesCbcPkcs7(appname, "po9", timestampVersion, appname),
    x: encryptAesCbcPkcs7(appname, "fl1", iv, appname),
  };
}
