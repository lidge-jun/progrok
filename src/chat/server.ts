import { CHAT_DEFAULT_PORT, PROXY_DEFAULT_HOST } from "../auth/constants.js";
import { startWebApp } from "../web/server.js";

export async function startChat(
  port = CHAT_DEFAULT_PORT,
  host = PROXY_DEFAULT_HOST,
): Promise<void> {
  await startWebApp(port, host);
}
