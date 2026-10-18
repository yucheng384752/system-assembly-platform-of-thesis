// SHA-256 of the exact UTF-8 bytes of a text (D29, A22). Lives in libs so the integration layer needs no app module for hashing.
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
