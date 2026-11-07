import { describe, expect, it } from "vitest";
import { idsKey } from "@/features/opportunities/engine";

describe("Clé de dédoublonnage des opportunités", () => {
  it("lisible pour quelques produits, empreinte bornée pour les très grands réassorts (index PostgreSQL ≤ 8 191 octets)", () => {
    expect(idsKey("reorder", "c", ["a", "b"])).toBe("reorder:c:a,b");
    const ids = Array.from({ length: 240 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`);
    const k = idsKey("reorder", "c", ids);
    expect(k.length).toBeLessThan(100);
    expect(idsKey("reorder", "c", [...ids])).toBe(k); // stable
    expect(idsKey("reorder", "c", ids.slice(1))).not.toBe(k);
  });
});
