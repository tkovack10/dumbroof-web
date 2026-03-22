interface Window {
  fbq?: (...args: unknown[]) => void;
  ttq?: { track: (...args: unknown[]) => void; page: () => void; identify: (...args: unknown[]) => void };
}
