import {
  PeerId,
  StorageAdapterInterface,
} from "@automerge/automerge-repo/slim";
import {
  ContactCard,
  Individual,
  Keyhive,
  Signer,
} from "@keyhive/keyhive/slim";
import { peerIdFromSigner } from "../utilities";

const ACTIVE_DB_KEY: string = "active-key-pair-2";

async function serializeKeyPair(keyPair: CryptoKeyPair): Promise<Uint8Array> {
  const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const stringified = JSON.stringify({ publicKey, privateKey });
  return new TextEncoder().encode(stringified);
}

async function deserializeKeyPair(bytes: Uint8Array): Promise<CryptoKeyPair> {
  const decoded = new TextDecoder().decode(bytes);
  const { publicKey: publicKeyStr, privateKey: privateKeyStr } =
    JSON.parse(decoded);
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    publicKeyStr,
    "Ed25519",
    true,
    publicKeyStr.key_ops
  );
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateKeyStr,
    "Ed25519",
    true,
    privateKeyStr.key_ops
  );
  return { publicKey, privateKey };
}

export type Active = {
  keyPair: CryptoKeyPair;
  peerId: PeerId;
  individual: Individual;
  contactCard: ContactCard;
  signer: Signer;
};

export async function loadOrCreateSigner(db: StorageAdapterInterface): Promise<{
  keyPair: CryptoKeyPair;
  signer: Signer;
}> {
  let keyPair: CryptoKeyPair;
  let signer: Signer;

  console.log('[keyhive] db.load key pair...');
  const maybeKeyPairBytes = await db.load([ACTIVE_DB_KEY]);
  if (maybeKeyPairBytes) {
    console.log('[keyhive] deserializing existing key pair...');
    keyPair = await deserializeKeyPair(maybeKeyPairBytes);
    console.log('[keyhive] creating signer from existing key...');
    signer = await Signer.webCryptoSigner(keyPair);
  } else {
    try {
      console.log('[keyhive] generating new Ed25519 key pair...');
      keyPair = await crypto.subtle.generateKey(
        {
          name: "Ed25519",
        },
        true,
        ["sign", "verify"]
      );
      console.log('[keyhive] key pair generated, creating signer...');
      signer = await Signer.webCryptoSigner(keyPair);
      console.log('[keyhive] storing key pair...');
      await storeActiveKeyPair(keyPair, db);
    } catch (error) {
      console.error("[AMRepoKeyhive] Error creating signer: ", error);
      throw error;
    }
  }
  console.log('[keyhive] signer ready');
  return {
    keyPair: keyPair,
    signer: signer,
  };
}

export async function createActive(
  keyPair: CryptoKeyPair,
  signer: Signer,
  keyhive: Keyhive
): Promise<Active> {
  const contactCard = await keyhive.getExistingContactCard();
  // TODO: We can now just get this off of Keyhive. We probably don't need it here anymore
  const individual: Individual = await keyhive.individual;
  const peerId = peerIdFromSigner(signer);
  return {
    keyPair: keyPair,
    peerId: peerId,
    signer: signer,
    individual: individual,
    contactCard: contactCard,
  };
}

export async function storeActiveKeyPair(
  keyPair: CryptoKeyPair,
  db: StorageAdapterInterface
): Promise<void> {
  db.save([ACTIVE_DB_KEY], await serializeKeyPair(keyPair));
}
