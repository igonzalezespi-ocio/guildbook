/** Page wording the Order of Saint Michael words its own way; every other guild gets neutral copy naming the guild. */
export function guildWording(guild: { preset: string; name: string }) {
  const order = guild.preset === "order";
  const name = guild.name;
  return {
    ranksHeading: order ? "Rangos de la Orden" : `Rangos de ${name}`,
    progressionEyebrow: order ? "Hazañas de la Orden" : `Hazañas de ${name}`,
    joined: order ? "Se unió a la Orden" : `Se unió a ${name}`,
    lootEyebrow: order ? "El botín de la Orden" : `El botín de ${name}`,
    addonsTitle: order ? "Addons de la Orden" : "Addons de la hermandad",
    addonsIntro: order
      ? "Herramientas que escriben nuestros miembros para ayudar a la Orden a prepararse, ejecutar y mejorar."
      : `Herramientas que escriben nuestros miembros para ayudar a ${name} a prepararse, ejecutar y mejorar.`,
    rosterEyebrow: (count: number) =>
      order ? `${count} hermanos y hermanas de armas` : `${count} ${count === 1 ? "miembro" : "miembros"} de ${name}`,
    /** "Level 60 Holy Paladin" + this, for a character's page description. */
    characterOf: `de ${name}`,
  };
}
