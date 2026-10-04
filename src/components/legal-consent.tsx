/** "By signing in you agree..." for login pages. `apexOrigin` is "" on the apex itself. */
export function LegalConsent({ apexOrigin = "" }: { apexOrigin?: string }) {
  return (
    <p className="mt-4 text-xs leading-relaxed text-muted" data-testid="legal-consent">
      Al iniciar sesión aceptas los{" "}
      <a href={`${apexOrigin}/terms`} className="link">
        Términos del servicio
      </a>{" "}
      y la{" "}
      <a href={`${apexOrigin}/privacy`} className="link">
        Política de privacidad
      </a>{" "}
      de Guildbook.
    </p>
  );
}
