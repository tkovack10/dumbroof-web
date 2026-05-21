/**
 * Retail-estimate PDF renderer.
 *
 * Isolated module — anything in here is OPTIONAL. If PDF rendering fails
 * for any reason (cold-start chromium download, memory, network, etc.),
 * callers MUST fall back to the existing HTML-only flow. Never block a
 * customer email on PDF render failure.
 *
 * Uses puppeteer-core + @sparticuz/chromium (the canonical Vercel
 * serverless Chromium pattern). The chromium binary is fetched at cold
 * start from the package's CDN; subsequent invocations on the same
 * Lambda reuse it.
 */
import chromium from "@sparticuz/chromium";
import puppeteer, { type Browser } from "puppeteer-core";

let _browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.connected) return _browser;
  const executablePath = await chromium.executablePath();
  _browser = await puppeteer.launch({
    args: chromium.args,
    executablePath,
    headless: true,
  });
  return _browser;
}

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 30000 });
    const pdf = await page.pdf({
      format: "Letter",
      printBackground: true,
      margin: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}
