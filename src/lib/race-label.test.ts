import { describe, expect, it } from "vitest";
import { raceLabel } from "./game";

describe("raceLabel", () => {
  it("shows Battle.net's English race names with the es-ES client names", () => {
    expect(raceLabel("Human")).toBe("Humano");
    expect(raceLabel("Night Elf")).toBe("Elfo de la noche");
    expect(raceLabel("Undead")).toBe("No-muerto");
  });
  it("keeps an unknown race as Battle.net sent it", () => {
    expect(raceLabel("Vulpera")).toBe("Vulpera");
  });
});
