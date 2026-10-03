/** Runs once when the server starts; the checks live in a Node-only module so the edge bundle never sees them. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { refuseTestModesInProduction } = await import("./server/startup-checks");
    refuseTestModesInProduction();
  }
}
