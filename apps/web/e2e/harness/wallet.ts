/**
 * ── page-side wallet control (plan I-5a) ─────────────────────────────────────
 * Drives the anvil-backed wagmi `mock` connector through the in-app bridge
 * (`window.__ROBBED_E2E__`, mounted only when NEXT_PUBLIC_E2E=true). No browser-
 * extension automation — the standard anti-flake pattern. Account indexes match
 * `ROLE_INDEX` in config.ts (0=creator, 1=treasury, 2=trader, 3=trader2).
 */
import type { Page } from "@playwright/test";

import { ROLE_INDEX } from "./config";

type Role = keyof typeof ROLE_INDEX;

async function bridgeReady(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as any).__ROBBED_E2E__), null, {
    timeout: 10_000,
  });
}

export async function connectAs(page: Page, role: Role): Promise<string> {
  await bridgeReady(page);
  const idx = ROLE_INDEX[role];
  return page.evaluate((i) => (window as any).__ROBBED_E2E__.connect(i), idx);
}

export async function switchTo(page: Page, role: Role): Promise<string> {
  await bridgeReady(page);
  const idx = ROLE_INDEX[role];
  return page.evaluate((i) => (window as any).__ROBBED_E2E__.switchAccount(i), idx);
}

export async function disconnect(page: Page): Promise<void> {
  await bridgeReady(page);
  await page.evaluate(() => (window as any).__ROBBED_E2E__.disconnect());
}

export async function connectedAddress(page: Page): Promise<string | undefined> {
  await bridgeReady(page);
  return page.evaluate(() => (window as any).__ROBBED_E2E__.address());
}
