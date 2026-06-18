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
        
        # -> Fill the 'Enter your hero's name...' field with a unique hero name and click the '🎲 ROLL FOR LEADER' button to roll a Party Leader.
        # Enter your hero's name... text field
        elem = page.locator('[id="player-name-input"]')
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("HostHero_20260614_A")
        
        # -> Fill the 'Enter your hero's name...' field with a unique hero name and click the '🎲 ROLL FOR LEADER' button to roll a Party Leader.
        # 🎲 ROLL FOR LEADER button
        elem = page.locator('[id="roll-leader-btn"]')
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> Verify the game transitions out of the lobby
        # Assert: Expected the page to show a Start control so the host could start the game.
        await expect(page.locator("xpath=/html/body/div[2]/div").nth(0)).to_contain_text("Start", timeout=15000), "Expected the page to show a Start control so the host could start the game."
        # Assert: Expected the active play UI to display monsters and players after the game started.
        await expect(page.locator("xpath=/html/body/div[2]/div").nth(0)).to_contain_text("monsters", timeout=15000), "Expected the active play UI to display monsters and players after the game started."
        
        # --> Verify active play begins with players and monsters displayed
        # Assert: Expected players to be shown as ready in active play.
        await expect(page.locator("xpath=/html/body/div[2]/div").nth(0)).to_contain_text("\u2713 Ready", timeout=15000), "Expected players to be shown as ready in active play."
        # Assert: Expected monsters to be displayed when active play begins.
        await expect(page.locator("xpath=/html/body/div[2]/div").nth(0)).to_contain_text("Monsters", timeout=15000), "Expected monsters to be displayed when active play begins."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    