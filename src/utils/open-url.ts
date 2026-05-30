import open from "open";

export async function openUrl(url: string): Promise<void> {
  try {
    await open(url);
  } catch {
    // Silently fail — URL is already printed to terminal
  }
}
