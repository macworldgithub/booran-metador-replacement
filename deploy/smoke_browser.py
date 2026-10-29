"""Offline browser smoke test: no DealerSocket navigation or authentication."""
import asyncio
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as playwright:
        for headless in (True, False):
            browser = await playwright.chromium.launch(channel='chrome', headless=headless, chromium_sandbox=True)
            try:
                page = await browser.new_page()
                await page.set_content('<title>Cranbourne browser ready</title>')
                assert await page.title() == 'Cranbourne browser ready'
            finally:
                await browser.close()


if __name__ == '__main__':
    asyncio.run(main())
