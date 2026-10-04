import { describe, expect, it } from "vitest";
import { guildWording } from "@/lib/guild-wording";

const ORDER_SPECIFIC = /\bthe Order\b|Order of|\bla Orden\b|Orden de|Catholic|católic|pray|\brez[ao]|Saint|San Miguel|Grand Master|Gran Maestro|brothers?\b|sisters?\b|hermanos|hermanas|knight|caballero/i;

function strings(w: ReturnType<typeof guildWording>) {
  return Object.values(w).flatMap((v) => (typeof v === "function" ? [v(1), v(12)] : [v]));
}

describe("guildWording", () => {
  it("keeps the Order's wording exactly", () => {
    const w = guildWording({ preset: "order", name: "Order of Saint Michael" });
    expect(w.ranksHeading).toBe("Rangos de la Orden");
    expect(w.progressionEyebrow).toBe("Hazañas de la Orden");
    expect(w.joined).toBe("Se unió a la Orden");
    expect(w.lootEyebrow).toBe("El botín de la Orden");
    expect(w.addonsTitle).toBe("Addons de la Orden");
    expect(w.addonsIntro).toBe("Herramientas que escriben nuestros miembros para ayudar a la Orden a prepararse, ejecutar y mejorar.");
    expect(w.rosterEyebrow(20)).toBe("20 hermanos y hermanas de armas");
    expect(w.characterOf).toBe("de Order of Saint Michael");
  });

  it("names any other guild and says nothing of the Order", () => {
    const w = guildWording({ preset: "standard", name: "Silver Dawn" });
    for (const s of strings(w)) expect(s).not.toMatch(ORDER_SPECIFIC);
    expect(w.ranksHeading).toBe("Rangos de Silver Dawn");
    expect(w.joined).toBe("Se unió a Silver Dawn");
    expect(w.addonsTitle).toBe("Addons de la hermandad");
    expect(w.rosterEyebrow(1)).toBe("1 miembro de Silver Dawn");
    expect(w.rosterEyebrow(12)).toBe("12 miembros de Silver Dawn");
    expect(w.characterOf).toBe("de Silver Dawn");
  });
});
