/** Keep the first advertised number and translate North American vanity digits. */
export function yardPhoneHref(phone: string | null): string | null {
  if (!phone) return null;
  const first = phone.split("/")[0] ?? "";
  const extension = /(?:\s+|(?<=\d))(?:ext\.?|x)\s*(\d+)$/i.exec(first);
  const main = extension ? first.slice(0, extension.index) : first;
  if (!/^\s*[+\d(]/.test(main) || (main.match(/\d/g)?.length ?? 0) < 3)
    return null;
  const number = main
    .toUpperCase()
    .replace(/[A-Z]/g, (letter) => {
      const group = [
        "ABC",
        "DEF",
        "GHI",
        "JKL",
        "MNO",
        "PQRS",
        "TUV",
        "WXYZ",
      ].findIndex((letters) => letters.includes(letter));
      return String(group + 2);
    })
    .replace(/[^+\d]/g, "");
  if (!/^\+?\d{10,15}$/.test(number)) return null;
  return `tel:${number}${extension ? `;ext=${extension[1]}` : ""}`;
}
