export class LocalKeyInputError extends Error {
  constructor() {
    super("Enter one 32-byte hexadecimal private key.");
    this.name = "LocalKeyInputError";
  }
}

export function takeEphemeralPrivateKeyBytes(input: {
  value: string;
}): Uint8Array {
  let rawValue = input.value;
  input.value = "";
  let normalized = rawValue.startsWith("0x")
    ? rawValue.slice(2)
    : rawValue;
  rawValue = "";

  if (!/^[a-fA-F0-9]{64}$/.test(normalized)) {
    normalized = "";
    throw new LocalKeyInputError();
  }

  const bytes = new Uint8Array(32);
  try {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Number.parseInt(
        normalized.slice(index * 2, index * 2 + 2),
        16,
      );
    }
    return bytes;
  } catch {
    bytes.fill(0);
    throw new LocalKeyInputError();
  } finally {
    normalized = "";
  }
}
