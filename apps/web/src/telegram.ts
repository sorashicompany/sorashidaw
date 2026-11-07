export type TelegramWebApp = {
  initData: string;
  initDataUnsafe: {
    user?: { id: number };
    chat?: { id: number };
  };
  ready(): void;
  expand(): void;
};

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }
}

export function getTelegramWebApp(): TelegramWebApp {
  const webApp = window.Telegram?.WebApp;

  if (!webApp) {
    throw new Error("Telegram WebApp API is unavailable");
  }

  return webApp;
}
