/**
 * The in-game tabard designer's fixed palettes, from the client's GuildColorBackground, GuildColorBorder and
 * GuildColorEmblem tables (51, 17 and 17 entries; indexes are the game's colour IDs).
 *
 * Background colours are used as the game stores them. Border and emblem colours are tint multipliers the game
 * applies to bright metallic textures, so the raw values are dark (a white emblem is stored as 177, 184, 177).
 * Each `hex` here is the tuned swatch as it reads on a tabard: the raw colour scaled up, hue preserved, until its
 * brightest channel is near full (at most doubled). `raw` keeps the game's value for reference.
 */
export interface Swatch {
  id: number;
  name: string;
  hex: string;
  raw: string;
}

const swatch = (id: number, name: string, hex: string, raw = hex): Swatch => ({ id, name, hex, raw });

export const BACKGROUND_COLORS: readonly Swatch[] = [
  swatch(0, "Rosa", "#ff2088"),
  swatch(1, "Frambuesa", "#bd005b"),
  swatch(2, "Carmesí", "#9e0036"),
  swatch(3, "Mandarina", "#ff891b"),
  swatch(4, "Bermellón", "#e14500"),
  swatch(5, "Rojo sangre", "#b1002e"),
  swatch(6, "Caléndula", "#ffb317"),
  swatch(7, "Naranja", "#f68700"),
  swatch(8, "Óxido", "#ae4b00"),
  swatch(9, "Limón", "#fffc14"),
  swatch(10, "Vara de oro", "#f3ca00"),
  swatch(11, "Oro viejo", "#c49b00"),
  swatch(12, "Canario", "#ffff14"),
  swatch(13, "Cidra", "#d8dd00"),
  swatch(14, "Oliva", "#a6ac00"),
  swatch(15, "Lima", "#e3f618"),
  swatch(16, "Pera", "#b7c003"),
  swatch(17, "Musgo", "#8e9700"),
  swatch(18, "Chartreuse", "#bcf61b"),
  swatch(19, "Hoja", "#88ba03"),
  swatch(20, "Helecho", "#588000"),
  swatch(21, "Verde primavera", "#1eff68"),
  swatch(22, "Esmeralda", "#04c347"),
  swatch(23, "Bosque", "#00820f"),
  swatch(24, "Aguamarina", "#1ef7c1"),
  swatch(25, "Jade", "#04b78f"),
  swatch(26, "Pino", "#009061"),
  swatch(27, "Cielo", "#21dcff"),
  swatch(28, "Cerúleo", "#009dc5"),
  swatch(29, "Mar profundo", "#006391"),
  swatch(30, "Aciano", "#4d8eda"),
  swatch(31, "Azur", "#2c6aae"),
  swatch(32, "Azul marino", "#003582"),
  swatch(33, "Orquídea", "#d34ac8"),
  swatch(34, "Violeta", "#ad29ac"),
  swatch(35, "Púrpura real", "#860f9a"),
  swatch(36, "Fucsia", "#ff38fa"),
  swatch(37, "Magenta", "#c900c3"),
  swatch(38, "Ciruela", "#9b00a6"),
  swatch(39, "Rosa intenso", "#ff1fbf"),
  swatch(40, "Cereza", "#d30087"),
  swatch(41, "Mora", "#a30068"),
  swatch(42, "Canela", "#c58132"),
  swatch(43, "Sombra", "#875513"),
  swatch(44, "Marrón oscuro", "#4f2300"),
  swatch(45, "Carbón", "#232323"),
  swatch(46, "Pizarra", "#646464"),
  swatch(47, "Ceniza", "#b4bba8"),
  swatch(48, "Hueso", "#d7ddcb"),
  swatch(49, "Blanco", "#ffffff"),
  swatch(50, "Salmón", "#fc6891"),
];

export const BORDER_COLORS: readonly Swatch[] = [
  swatch(0, "Carmesí", "#ce0042", "#670021"),
  swatch(1, "Cobre", "#ce4600", "#672300"),
  swatch(2, "Ámbar", "#ce8a00", "#674500"),
  swatch(3, "Oro", "#ceac00", "#675600"),
  swatch(4, "Chartreuse", "#abff00", "#639400"),
  swatch(5, "Lima", "#9bff00", "#63a300"),
  swatch(6, "Verde", "#8dff00", "#63b300"),
  swatch(7, "Esmeralda", "#00ce3e", "#00671f"),
  swatch(8, "Cian", "#00fbff", "#008e90"),
  swatch(9, "Cielo", "#00b3ff", "#006793"),
  swatch(10, "Azul real", "#0062f8", "#00317c"),
  swatch(11, "Violeta", "#da00ee", "#6d0077"),
  swatch(12, "Magenta", "#f600ce", "#7b0067"),
  swatch(13, "Bronce", "#a86e14", "#54370a"),
  swatch(14, "Plata", "#ffffff"),
  swatch(15, "Hierro", "#1e282a", "#0f1415"),
  swatch(16, "Oro brillante", "#f9cc30"),
];

export const EMBLEM_COLORS: readonly Swatch[] = [
  swatch(0, "Carmesí", "#ce0042", "#670021"),
  swatch(1, "Cobre", "#ce4600", "#672300"),
  swatch(2, "Ámbar", "#ce8a00", "#674500"),
  swatch(3, "Oro", "#ceac00", "#675600"),
  swatch(4, "Cidra", "#c6ce00", "#636700"),
  swatch(5, "Lima", "#a2ce00", "#516700"),
  swatch(6, "Verde", "#6ece00", "#376700"),
  swatch(7, "Esmeralda", "#00ce3e", "#00671f"),
  swatch(8, "Verde azulado", "#00ceae", "#006757"),
  swatch(9, "Cielo", "#0090ce", "#004867"),
  swatch(10, "Azul real", "#1254ba", "#092a5d"),
  swatch(11, "Púrpura", "#ac12ba", "#56095d"),
  swatch(12, "Magenta", "#ba129e", "#5d094f"),
  swatch(13, "Bronce", "#a86e14", "#54370a"),
  swatch(14, "Blanco", "#f5fff5", "#b1b8b1"),
  swatch(15, "Negro", "#202a2e", "#101517"),
  swatch(16, "Canela", "#dfa55a"),
];

export type PaletteKind = "background" | "border" | "emblem";

export const PALETTES: Record<PaletteKind, readonly Swatch[]> = {
  background: BACKGROUND_COLORS,
  border: BORDER_COLORS,
  emblem: EMBLEM_COLORS,
};

/** The swatch at `id`, or the palette's first entry for an unknown id. */
export function swatchOf(kind: PaletteKind, id: number): Swatch {
  const list = PALETTES[kind];
  return list[id] ?? list[0]!;
}
