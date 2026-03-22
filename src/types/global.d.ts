interface Window {
  fbq?: (...args: unknown[]) => void;
  ttq?: {
    track: (event: string, params?: Record<string, unknown>) => void;
    page: () => void;
    identify: (params: Record<string, string>) => void;
  };
}
