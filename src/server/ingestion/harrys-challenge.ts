/** Interpret only Sucuri's qualified literal-concatenation challenge. Remote
 * JavaScript is data here, never evaluated or executed. */
export function harrysChallengeCookie(html: string): string {
  if (html.length > 16_384)
    throw new Error("Harry's Sucuri challenge exceeds 16 KiB");
  const payloads = [...html.matchAll(/\bS='([A-Za-z0-9+/]+={0,2})';/g)];
  const encoded = payloads[0]?.[1];
  if (payloads.length !== 1 || !encoded)
    throw new Error("Harry's Sucuri base64 challenge shape changed");
  const script = atob(encoded);
  const match =
    /^([a-z])=(.*?);document\.cookie=(.*?) \+ ([a-z]) \+ ';path=\/;max-age=86400;SameSite=Lax;Secure'; location\.reload\(\);$/.exec(
      script,
    );
  if (!match || match[1] !== match[4])
    throw new Error("Harry's Sucuri cookie assignment shape changed");
  const concatenate = (expression: string): string => {
    const terms = expression.split(/\s*\+\s*/);
    if (terms.length > 100)
      throw new Error("Harry's Sucuri expression is oversized");
    return terms
      .map((term) => {
        const character = /^String\.fromCharCode\((\d{1,3})\)$/.exec(term);
        if (character) {
          const code = Number(character[1]);
          if (code >= 32 && code <= 126) return String.fromCharCode(code);
        }
        const literal = /^(?:'([A-Za-z0-9_=]*)'|"([A-Za-z0-9_=]*)")$/.exec(
          term,
        );
        if (literal) return literal[1] ?? literal[2] ?? "";
        throw new Error(
          "Harry's Sucuri expression contains an unsupported term",
        );
      })
      .join("");
  };
  const cookie = concatenate(match[3] ?? "") + concatenate(match[2] ?? "");
  if (!/^sucuri_cloudproxy_uuid_[a-f0-9]{9}=[a-f0-9]{32}$/.test(cookie))
    throw new Error("Harry's Sucuri cookie name or value changed");
  return cookie;
}
