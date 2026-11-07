import { getTelegramWebApp } from "./telegram";

export type AuthenticatedSession = {
  authenticated: true;
  user: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  chat: {
    id: number;
    type?: string;
    title?: string;
    username?: string;
  };
};

export async function authenticateWithTelegram(
  apiBaseUrl: string,
): Promise<AuthenticatedSession> {
  const webApp = getTelegramWebApp();

  webApp.ready();
  webApp.expand();

  const response = await fetch(`${apiBaseUrl}/api/auth/telegram`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      initData: webApp.initData,
    }),
  });

  if (!response.ok) {
    throw new Error("Telegram authentication failed");
  }

  return (await response.json()) as AuthenticatedSession;
}
