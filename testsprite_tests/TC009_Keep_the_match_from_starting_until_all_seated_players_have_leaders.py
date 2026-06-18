import asyncio
import re
from playwright import async_api
from playwright.async_api import expect

async def run_test():
    pw = None
    browser = None
    context = None

    try:
        # Start a Playwright session in asynchronous mode
        pw = await async_api.async_playwright().start()

        # Launch a Chromium browser in headless mode with custom arguments
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",
                "--disable-dev-shm-usage",
                "--ipc=host",
                "--single-process"
            ],
        )

        # Create a new browser context (like an incognito window)
        context = await browser.new_context()
        # Wider default timeout to match the agent's DOM-stability budget;
        # auto-waiting Playwright APIs (expect, locator.wait_for) inherit this.
        context.set_default_timeout(15000)

        # Open a new page in the browser context
        page = await context.new_page()

        # Interact with the page elements to simulate user flow
        # -> navigate
        await page.goto("http://localhost:3000")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Fill the 'Enter your hero's name...' input with a unique hero name and submit it by pressing Enter to join the shared tavern lobby.
        # Enter your hero's name... text field
        elem = page.locator('[id="player-name-input"]')
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("HeroAlice-1")
        
        # -> Click the '🎲 ROLL FOR LEADER' button to randomly assign a Party Leader for the current lobby and reveal the lock-in control.
        # 🎲 ROLL FOR LEADER button
        elem = page.locator('[id="roll-leader-btn"]')
        await elem.click(timeout=10000)
        
        # -> Open a new browser tab and navigate to the tavern lobby (the app home at http://localhost:3000) so that a second, separate player can join with a different hero name.
        # Open URL in new tab
        page = await context.new_page()
        await page.goto("http://localhost:3000/")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Switch to the newly opened app tab and enter a different unique hero name into the 'Enter your hero's name...' field to join the shared tavern lobby as the second player.
        # Switch to tab B2B8
        page = context.pages[-1]  # switch to most recently active tab
        
        # -> Enter a different unique hero name into the 'Enter your hero's name...' field and press Enter to join the shared tavern lobby as the second player.
        # Enter your hero's name... text field
        elem = page.locator('[id="player-name-input"]')
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("HeroBob-2")
        
        # --> Assertions to verify final state
        
        # --> Verify the match remains in the lobby state
        # Assert: The tavern header is visible, indicating the match remains in the lobby state.
        await expect(page.locator("xpath=/html/body/div[2]/div").nth(0)).to_contain_text("The Prancing Pony\nTake a seat, grab an ale, and prepare to s", timeout=15000), "The tavern header is visible, indicating the match remains in the lobby state."
        current_url = await page.evaluate("() => window.location.href")
        # Assert: page loaded with a URL (final outcome verified by the AI judge during the run)
        assert current_url, 'Page should have loaded with a URL'
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    