import { test, expect } from '@playwright/test'

const BASE = 'https://hadoku.me/aggregator/'
const API = 'https://hadoku.me/oss/api'

// ============================================================================
// Collect console errors and network failures during each test
// ============================================================================

interface PageLog {
  consoleErrors: string[]
  networkFailures: string[]
  apiErrors: { url: string; status: number; body: string }[]
}

function attachLogCollectors(page: import('@playwright/test').Page): PageLog {
  const log: PageLog = { consoleErrors: [], networkFailures: [], apiErrors: [] }

  page.on('console', msg => {
    if (msg.type() === 'error') {
      log.consoleErrors.push(msg.text())
    }
  })

  page.on('requestfailed', req => {
    log.networkFailures.push(`${req.method()} ${req.url()} - ${req.failure()?.errorText}`)
  })

  page.on('response', async res => {
    if (res.url().includes('/oss/api/') && res.status() >= 500) {
      let body = ''
      try {
        body = await res.text()
      } catch {
        body = '(could not read body)'
      }
      log.apiErrors.push({ url: res.url(), status: res.status(), body })
    }
  })

  return log
}

// ============================================================================
// Page Load & Basic Rendering
// ============================================================================

test.describe('Page Load', () => {
  test('loads the aggregator page successfully', async ({ page }) => {
    const log = attachLogCollectors(page)
    const res = await page.goto(BASE, { waitUntil: 'networkidle' })

    expect(res?.status()).toBe(200)

    // Page should have a title or header
    const title = await page.title()
    expect(title).toBeTruthy()

    // Log any issues found
    if (log.consoleErrors.length > 0) {
      console.log('Console errors:', log.consoleErrors)
    }
    if (log.apiErrors.length > 0) {
      console.log('API errors:', log.apiErrors)
    }
  })

  test('renders the sidebar with ProjectSelector', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' })

    // Look for sidebar or project selector elements
    const sidebar = page.locator('.sidebar, [class*="sidebar"], [class*="project-selector"]')
    const sidebarCount = await sidebar.count()

    // Log what we find
    console.log(`Found ${sidebarCount} sidebar elements`)

    // The page should have rendered something
    const bodyText = await page.locator('body').innerText()
    expect(bodyText.length).toBeGreaterThan(0)
  })

  test('renders the toolbar', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' })

    const toolbar = page.locator('.toolbar, [class*="toolbar"]')
    const toolbarCount = await toolbar.count()
    console.log(`Found ${toolbarCount} toolbar elements`)

    if (toolbarCount > 0) {
      // Check for search input
      const searchInput = toolbar.locator('input[type="text"], input[type="search"]')
      const searchCount = await searchInput.count()
      console.log(`Found ${searchCount} search inputs in toolbar`)
    }
  })
})

// ============================================================================
// API Endpoint Health Checks
// ============================================================================

test.describe('API Endpoints', () => {
  test('GET /recon/watchlist returns valid response', async ({ request }) => {
    const res = await request.get(`${API}/recon/watchlist`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data.slugs)).toBe(true)
    console.log('Watchlist:', body.data.slugs)
  })

  test('GET /recon/all-scored-issues returns response', async ({ request }) => {
    const res = await request.get(`${API}/recon/all-scored-issues`)
    const status = res.status()
    const body = await res.text()

    console.log(`all-scored-issues: status=${status}, body=${body.slice(0, 300)}`)

    if (status === 200) {
      const json = JSON.parse(body)
      expect(json.success).toBe(true)
      console.log(`Total issues: ${json.data.totalCount}, Repos: ${json.data.repoCount}`)
    } else {
      console.log(`SERVER ERROR: all-scored-issues returned ${status}: ${body}`)
    }
  })

  test('GET /recon/:slug/health returns response', async ({ request }) => {
    const res = await request.get(`${API}/recon/fastify-fastify/health`)
    const status = res.status()
    const body = await res.text()

    console.log(`health: status=${status}, body=${body.slice(0, 300)}`)

    if (status === 200) {
      const json = JSON.parse(body)
      if (json.data?.status === 'pending') {
        console.log('Health: PENDING (no data in KV yet)')
      } else {
        console.log(`Health: viability=${json.data.overallViability}, killed=${json.data.killed}`)
      }
    } else {
      console.log(`SERVER ERROR: health returned ${status}: ${body}`)
    }
  })

  test('GET /recon/:slug/scored-issues returns response', async ({ request }) => {
    const res = await request.get(`${API}/recon/fastify-fastify/scored-issues`)
    const status = res.status()
    const body = await res.text()

    console.log(`scored-issues: status=${status}, body=${body.slice(0, 300)}`)

    if (status === 200) {
      const json = JSON.parse(body)
      console.log(`Scored issues count: ${json.data.issues?.length ?? 0}`)
    } else {
      console.log(`SERVER ERROR: scored-issues returned ${status}: ${body}`)
    }
  })

  test('GET /recon/:slug/dossier returns response', async ({ request }) => {
    const res = await request.get(`${API}/recon/fastify-fastify/dossier`)
    const status = res.status()
    const body = await res.text()

    console.log(`dossier: status=${status}, body=${body.slice(0, 300)}`)

    if (status === 200) {
      const json = JSON.parse(body)
      if (json.data?.status === 'pending') {
        console.log('Dossier: PENDING')
      } else {
        const sections = Object.keys(json.data.sections || {})
        console.log(`Dossier sections: ${sections.join(', ')}`)
      }
    } else {
      console.log(`SERVER ERROR: dossier returned ${status}: ${body}`)
    }
  })

  test('GET /issues?source=all (legacy) still works', async ({ request }) => {
    const res = await request.get(`${API}/issues?source=all`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.issues.length).toBeGreaterThan(0)
    console.log(`Legacy issues: ${body.data.issues.length} issues loaded`)
  })
})

// ============================================================================
// UI Interactions
// ============================================================================

test.describe('UI Interactions', () => {
  test('captures all console errors and API failures on load', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })

    // Wait a bit for any async data to load
    await page.waitForTimeout(3000)

    // Report everything we found
    console.log('=== CONSOLE ERRORS ===')
    if (log.consoleErrors.length === 0) {
      console.log('(none)')
    } else {
      for (const err of log.consoleErrors) {
        console.log(`  ERROR: ${err}`)
      }
    }

    console.log('=== NETWORK FAILURES ===')
    if (log.networkFailures.length === 0) {
      console.log('(none)')
    } else {
      for (const fail of log.networkFailures) {
        console.log(`  FAIL: ${fail}`)
      }
    }

    console.log('=== API ERRORS (5xx) ===')
    if (log.apiErrors.length === 0) {
      console.log('(none)')
    } else {
      for (const err of log.apiErrors) {
        console.log(`  ${err.status} ${err.url}: ${err.body.slice(0, 200)}`)
      }
    }
  })

  test('view toggle switches between table and card views', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Look for view toggle buttons
    const viewToggle = page.locator('.toolbar__view-toggle button, [class*="view-toggle"] button')
    const toggleCount = await viewToggle.count()
    console.log(`Found ${toggleCount} view toggle buttons`)

    if (toggleCount >= 2) {
      // Click the second toggle (should switch to card view)
      await viewToggle.nth(1).click()
      await page.waitForTimeout(500)

      const cardGrid = page.locator('.issue-card-grid, [class*="card-grid"]')
      const cardCount = await cardGrid.count()
      console.log(`After toggle: found ${cardCount} card grid elements`)

      // Click back to table view
      await viewToggle.nth(0).click()
      await page.waitForTimeout(500)

      const table = page.locator('.issue-table, [class*="issue-table"]')
      const tableCount = await table.count()
      console.log(`After toggle back: found ${tableCount} table elements`)
    }

    if (log.consoleErrors.length > 0) {
      console.log('Console errors during toggle:', log.consoleErrors)
    }
  })

  test('project selector is clickable and shows projects', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Look for project items in sidebar
    const projects = page.locator(
      '.project-selector__item, [class*="project-selector"] button, [class*="project-selector"] li'
    )
    const projectCount = await projects.count()
    console.log(`Found ${projectCount} project items`)

    if (projectCount > 0) {
      // Click the first project
      const firstProject = projects.nth(0)
      const projectText = await firstProject.innerText()
      console.log(`First project: "${projectText}"`)
      await firstProject.click()
      await page.waitForTimeout(1000)

      // Check if health panel appeared
      const healthPanel = page.locator('.repo-health, [class*="repo-health"]')
      const healthCount = await healthPanel.count()
      console.log(`After click: found ${healthCount} health panel elements`)
    }

    if (log.consoleErrors.length > 0) {
      console.log('Console errors:', log.consoleErrors)
    }
  })

  test('toolbar filter dropdowns work', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)

    // Find select/dropdown elements in toolbar
    const selects = page.locator('.toolbar select, .toolbar__filters select')
    const selectCount = await selects.count()
    console.log(`Found ${selectCount} filter dropdowns`)

    for (let i = 0; i < selectCount; i++) {
      const options = await selects.nth(i).locator('option').allInnerTexts()
      console.log(`Dropdown ${i}: ${options.join(', ')}`)
    }

    // Find search input
    const search = page.locator('.toolbar__search input, .toolbar input[type="text"]')
    const searchCount = await search.count()
    console.log(`Found ${searchCount} search inputs`)

    if (searchCount > 0) {
      await search.first().fill('test search')
      await page.waitForTimeout(500)
      console.log('Search input filled successfully')
    }

    if (log.consoleErrors.length > 0) {
      console.log('Console errors:', log.consoleErrors)
    }
  })

  test('clicking an issue row opens detail drawer', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)

    // Look for issue rows
    const rows = page.locator(
      '.issue-table__row, [class*="issue-table"] tr:not(:first-child), .issue-card'
    )
    const rowCount = await rows.count()
    console.log(`Found ${rowCount} issue rows/cards`)

    if (rowCount > 0) {
      await rows.first().click()
      await page.waitForTimeout(1000)

      // Check if drawer opened
      const drawer = page.locator('.drawer--open, [class*="drawer"][class*="open"]')
      const drawerCount = await drawer.count()
      console.log(`After click: found ${drawerCount} open drawers`)

      if (drawerCount > 0) {
        const drawerText = await drawer.first().innerText()
        console.log(`Drawer content preview: ${drawerText.slice(0, 200)}`)

        // Try to close drawer with Escape
        await page.keyboard.press('Escape')
        await page.waitForTimeout(500)
        const afterEsc = await page.locator('.drawer--open').count()
        console.log(`After Escape: ${afterEsc} open drawers`)
      }
    }

    if (log.consoleErrors.length > 0) {
      console.log('Console errors:', log.consoleErrors)
    }
    if (log.apiErrors.length > 0) {
      console.log('API errors:', log.apiErrors)
    }
  })

  test('take full page screenshot for visual inspection', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)

    await page.screenshot({
      path: 'e2e/screenshots/full-page.png',
      fullPage: true
    })
    console.log('Screenshot saved to e2e/screenshots/full-page.png')
  })
})
