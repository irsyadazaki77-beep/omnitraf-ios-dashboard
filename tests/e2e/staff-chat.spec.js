import { test, expect } from '@playwright/test';
import { authenticateAs } from './fixtures/auth.fixture.js';
import { waitForViewReady } from './fixtures/simulation.fixture.js';

test.describe('Staff chat panel regression', () => {
  test.beforeEach(async ({ page }) => {
    await authenticateAs(page, 'OPERATOR');
    await page.goto('/#dashboard');
    await waitForViewReady(page, 'view-dashboard');
  });

  test('keeps chat content inside its panel and opens, closes, and restores focus', async ({ page }) => {
    const panel = page.locator('#staffChatPanel');
    const input = page.locator('#chatInputText');
    const opener = page.locator('#btnTopMobileChat');
    const overflow = page.locator('.topbar-overflow');
    const openChat = async () => {
      await overflow.evaluate((element) => { element.open = true; });
      await opener.click();
    };

    await expect(panel).toBeHidden();
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
    await expect(panel).toHaveJSProperty('inert', true);
    await expect.poll(() => panel.evaluate((element) => {
      const controls = [...element.querySelectorAll('button, input, [tabindex]')];
      controls.forEach((control) => control.focus());
      return controls.some((control) => document.activeElement === control);
    })).toBe(false);

    expect(await panel.evaluate((element) => [
      '#staffChatHeader', '#staffChatBody', '#chatQuickSuggestions',
      '#chatTypingWrapper', '.chat-footer'
    ]
      .every((selector) => element.querySelector(selector)?.parentElement === element))).toBe(true);

    await openChat();
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    await expect(panel).not.toHaveJSProperty('inert', true);
    await expect(input).toBeFocused();

    const geometry = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        position: getComputedStyle(element).position,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        documentWidth: document.documentElement.scrollWidth,
        mainInert: document.querySelector('#mainContent')?.inert ?? false,
        sidebarVisible: Boolean(document.querySelector('#sidebar')?.getClientRects().length)
      };
    });
    expect(geometry.position).toBe('fixed');
    expect(geometry.width).toBeLessThanOrEqual(400);
    expect(geometry.height).toBeLessThan(geometry.viewportHeight * 0.8);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
    expect(geometry.mainInert).toBe(false);
    expect(geometry.sidebarVisible).toBe(true);
    await expect(page.locator('#view-dashboard')).toBeVisible();

    const panelBeforeScroll = await panel.boundingBox();
    await page.mouse.wheel(0, 500);
    await expect.poll(() => page.evaluate(() => window.scrollY
      || document.querySelector('#mainContent')?.scrollTop
      || document.querySelector('#view-dashboard')?.scrollTop
      || 0)).toBeGreaterThan(0);
    const panelAfterScroll = await panel.boundingBox();
    expect(Math.abs(panelAfterScroll.y - panelBeforeScroll.y)).toBeLessThanOrEqual(1);

    await page.locator('#btnToggleChatPanel').click();
    await expect(panel).toBeHidden();
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
    await expect(panel).toHaveJSProperty('inert', true);

    await openChat();
    await expect(input).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(overflow.locator(':scope > summary')).toBeFocused();
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
    await expect(panel).toHaveJSProperty('inert', true);
  });
});
