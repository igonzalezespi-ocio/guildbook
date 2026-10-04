/** A user-facing failure (bad state, conflict) as opposed to a bug. */
export class DomainError extends Error {
  /** The form field the failure is about, shown next to that field and in the form's error summary. */
  readonly field?: string;
  /** Other values the user can pick instead, such as free subdomains. */
  readonly suggestions?: string[];

  constructor(message: string, opts: { field?: string; suggestions?: string[] } = {}) {
    super(message);
    this.name = "DomainError";
    this.field = opts.field;
    this.suggestions = opts.suggestions;
  }
}

/** Spanish wording for the things callers name in English. */
const NOT_FOUND_ES: Record<string, string> = {
  Account: "la cuenta",
  Addon: "el addon",
  Application: "la solicitud",
  "Battle.net link": "el vínculo con Battle.net",
  Boss: "el jefe",
  Character: "el personaje",
  Device: "el dispositivo",
  Domain: "el dominio",
  Guild: "la hermandad",
  Import: "la importación",
  Kill: "la muerte de jefe",
  "Loot entry": "la entrada de botín",
  Member: "el miembro",
  Page: "la página",
  "Pending application": "la solicitud pendiente",
  Rank: "el rango",
  Report: "el informe",
  "Schedule slot": "el horario",
};

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super(`No se ha encontrado ${NOT_FOUND_ES[what] ?? what}`);
    this.name = "NotFoundError";
  }
}
