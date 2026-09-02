import { schnorr } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { z } from "zod";

export const nostrEventSchema = z.object({
  id: z.string().length(64),
  pubkey: z.string().length(64),
  created_at: z.number().int(),
  kind: z.number().int(),
  tags: z.array(z.array(z.string())),
  content: z.string(),
  sig: z.string().length(128),
});

export type NostrEvent = z.infer<typeof nostrEventSchema>;

export function serializeEvent(event: Omit<NostrEvent, "id" | "sig">): string {
  return JSON.stringify([0, event.pubkey, event.created_at, event.kind, event.tags, event.content]);
}

export function computeEventId(event: Omit<NostrEvent, "id" | "sig">): string {
  const serialized = serializeEvent(event);
  return bytesToHex(sha256(new TextEncoder().encode(serialized)));
}

export function verifyNostrEvent(event: NostrEvent): boolean {
  const computedId = computeEventId(event);
  if (computedId !== event.id) return false;

  try {
    const pubkeyBytes = hexToBytes(event.pubkey);
    const sigBytes = hexToBytes(event.sig);
    const idBytes = hexToBytes(event.id);
    return schnorr.verify(sigBytes, idBytes, pubkeyBytes);
  } catch {
    return false;
  }
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex length");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
