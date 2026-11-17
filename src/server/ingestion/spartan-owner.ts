import { prattText } from "./pratt-html";
import { shopifyYardDocument } from "./shopify-yard-html";

export const SpartanOwner = {
  parse(raw: string) {
    const text = prattText(shopifyYardDocument(raw));
    if (
      !text.includes("Spartan Auto") ||
      !text.includes("1555 Bishop Rd, Inman, SC 29349") ||
      !text.includes("529-9400")
    )
      throw new Error(
        "Spartan catalog no longer establishes the Inman yard; prior inventory is preserved. Inspect the native owner page.",
      );
  },
} as const;
