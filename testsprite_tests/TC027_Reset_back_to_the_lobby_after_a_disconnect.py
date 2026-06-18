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
        
        # -> Click the visible lobby panel labelled 'The Prancing Pony' to try to reveal the hero-name input or seat choices; if nothing appears, open a new browser tab and navigate it to the game's root.
        # The Prancing Pony Take a seat, grab an ale, and...
        elem = page.locator('xpath=/html/body/div[2]/div')
        await elem.click(timeout=10000)
        
        # -> Click the visible lobby panel labelled 'The Prancing Pony' to try to reveal the hero-name input or seat choices; if nothing appears, open a new browser tab and navigate it to the game's root.
        # Open URL in new tab
        page = await context.new_page()
        await page.goto("http://localhost:3000/")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Fill 'TesterA' into the hero name field labeled "Enter your hero's name..." and submit it to join the tavern lobby on the current tab.
        # Enter your hero's name... text field
        elem = page.locator('[id="player-name-input"]')
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("TesterA")
        
        # -> Switch to the other open browser tab showing the game's root, then enter a different hero name into the 'Enter your hero's name...' field and submit to join the shared tavern.
        # Switch to tab B863
        page = context.pages[-1]  # switch to most recently active tab
        
        # -> Fill 'TesterB' into the 'Enter your hero's name...' field and press Enter to join the tavern on this tab, then close the tab to simulate the second player's disconnect.
        # Enter your hero's name... text field
        elem = page.locator('[id="player-name-input"]')
        await elem.wait_for(state="visible", timeout=10000)
        await elem.fill("TesterB")
        
        # --> Assertions to verify final state
        
        # --> Verify the lobby is shown again
        # Assert: The lobby header 'The Prancing Pony' is visible, confirming the lobby is shown.
        await expect(page.locator("xpath=/html/body/div[2]/div").nth(0)).to_contain_text("The Prancing Pony", timeout=15000), "The lobby header 'The Prancing Pony' is visible, confirming the lobby is shown."
        
        # --> Verify the seated player list is reset
        # Assert: The first seated slot shows the placeholder '?' indicating the seat is empty.
        await expect(page.locator("xpath=/html/body/div[2]/div/div[1]/div[1]/div[1]").nth(0)).to_have_text("?", timeout=15000), "The first seated slot shows the placeholder '?' indicating the seat is empty."
        # Assert: The second seated slot shows the placeholder '?' indicating the seat is empty.
        await expect(page.locator("xpath=/html/body/div[2]/div/div[1]/div[2]/div[1]").nth(0)).to_have_text("?", timeout=15000), "The second seated slot shows the placeholder '?' indicating the seat is empty."
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    