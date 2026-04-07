// scrapeJob.js
import { chromium } from "playwright";

export const scrapeJobPage = async (url) => {
  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
    });

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    // 🔥 better navigation strategy
    await page.goto(url, {
      waitUntil: "domcontentloaded", // more reliable than networkidle
      timeout: 30000,
    });

    // 🔥 wait for content to load
    await page.waitForTimeout(3000);

    // 🔥 try to extract structured job description
    const jobText = await page.evaluate(() => {
      const selectors = [
        '[class*="description"]',
        '[class*="job"]',
        '[id*="description"]',
        "article",
        "main",
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el && el.innerText.length > 200) {
          return el.innerText;
        }
      }

      // fallback
      return document.body.innerText;
    });

    return {
      success: true,
      text: jobText,
    };
  } catch (err) {
    console.error("Scraping error:", err.message);

    return {
      success: false,
      error: "Failed to fetch job description",
    };
  } finally {
    if (browser) await browser.close();
  }
};