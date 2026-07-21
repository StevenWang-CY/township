/** Browser-held credential for relationship and journal state.
 *
 * The capability is deliberately separate from the user profile: profile IDs
 * can appear in request bodies and URLs, while this value travels only in a
 * request header.  There is no weak-randomness fallback; private persistence
 * is disabled if the Web Crypto API is unavailable.
 */

export const PLAYER_CAPABILITY_HEADER = "X-Township-Player-Capability";
const STORAGE_KEY = "township-player-capability-v1";
const CAPABILITY_RE = /^[A-Za-z0-9_-]{43,128}$/;

let memoryCapability: string | null = null;
let fallbackPreparation: Promise<boolean> | null = null;

function generateCapability(): string | null {
  try {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  } catch {
    return null;
  }
}

export function getPlayerCapability(): string | null {
  // Storage is authoritative across tabs. Reading it before the module cache
  // lets a losing tab immediately adopt the credential that won registration.
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && CAPABILITY_RE.test(stored)) {
      memoryCapability = stored;
      return stored;
    }
  } catch {
    // A memory-only capability still protects this tab when storage is denied.
  }

  if (memoryCapability) return memoryCapability;

  const generated = generateCapability();
  if (!generated) return null;
  memoryCapability = generated;
  try {
    localStorage.setItem(STORAGE_KEY, generated);
  } catch {
    // Keep the memory copy for the lifetime of this tab.
  }
  return generated;
}

function persistCapability(capability: string) {
  memoryCapability = capability;
  try {
    localStorage.setItem(STORAGE_KEY, capability);
  } catch {
    // Memory-only mode cannot coordinate tabs or survive a reload.
  }
}

async function withCapabilityLock<T>(work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request("township-player-capability-v1", { mode: "exclusive" }, work);
  }
  return work();
}

/** Establish one durable cross-tab credential before a profile is published. */
export async function preparePlayerCapability(): Promise<boolean> {
  const prepare = async () => withCapabilityLock(async () => {
    const capability = getPlayerCapability();
    if (!capability) return false;
    // Reassert the value while holding the browser-wide lock. Every profile
    // creation path does this before writing the shared player id.
    persistCapability(capability);
    return true;
  });
  if (!fallbackPreparation) {
    fallbackPreparation = prepare().finally(() => {
      fallbackPreparation = null;
    });
  }
  return fallbackPreparation;
}

export function playerCapabilityHeaders(): Record<string, string> {
  const capability = getPlayerCapability();
  return capability ? { [PLAYER_CAPABILITY_HEADER]: capability } : {};
}

/** Bind a new/legacy browser profile before its first private-state read.
 * Repeated calls simply verify the already-bound capability. */
export async function registerPlayerCapability(playerId: string): Promise<boolean> {
  return withCapabilityLock(async () => {
    const capability = getPlayerCapability();
    if (!capability) return false;
    try {
      const response = await fetch("/api/chat/relationships/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [PLAYER_CAPABILITY_HEADER]: capability,
        },
        body: JSON.stringify({ user_id: playerId }),
      });
      if (!response.ok) return false;
      // A concurrent uncoordinated read may have generated another value
      // during the request. The server-accepted winner is made durable last.
      persistCapability(capability);
      return true;
    } catch {
      return false;
    }
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    memoryCapability = event.newValue && CAPABILITY_RE.test(event.newValue)
      ? event.newValue
      : null;
  });
}
