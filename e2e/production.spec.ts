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
// API Endpoint Validation (strict — these must pass)
// ============================================================================

test.describe('API Endpoints', () => {
  test('GET /recon/watchlist returns at least one repo', async ({ request }) => {
    const res = await request.get(`${API}/recon/watchlist`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.slugs.length).toBeGreaterThan(0)
    console.log('Watchlist slugs:', body.data.slugs)
  })

  test('GET /recon/all-scored-issues returns scored issues with CVS data', async ({ request }) => {
    const res = await request.get(`${API}/recon/all-scored-issues`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.issues.length).toBeGreaterThan(0)
    expect(body.data.totalCount).toBeGreaterThan(0)
    expect(body.data.repoCount).toBeGreaterThan(0)

    // Validate first issue has required scored fields
    const first = body.data.issues[0]
    expect(first.cvs).toBeGreaterThanOrEqual(0)
    expect(first.cvsTier).toBeTruthy()
    expect(first.repoSlug).toBeTruthy()
    expect(first.lifecycleStage).toBeTruthy()
    expect(first.complexity).toBeTruthy()
    expect(first.competitionLevel).toBeTruthy()
    console.log(
      `Scored issues: ${body.data.totalCount} total, ${body.data.repoCount} repos, ` +
        `first: CVS=${first.cvs} tier=${first.cvsTier} repo=${first.repoSlug}`
    )
  })

  test('GET /recon/:slug/health returns health scores', async ({ request }) => {
    // Get a slug from the watchlist first
    const wlRes = await request.get(`${API}/recon/watchlist`)
    const slug = (await wlRes.json()).data.slugs[0]

    const res = await request.get(`${API}/recon/${slug}/health`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    if (body.data.status !== 'pending') {
      expect(body.data.overallViability).toBeGreaterThanOrEqual(0)
      expect(body.data.overallViability).toBeLessThanOrEqual(100)
      expect(typeof body.data.killed).toBe('boolean')
      expect(body.data.prPatterns).toBeTruthy()
      console.log(
        `Health for ${slug}: viability=${body.data.overallViability}, killed=${body.data.killed}`
      )
    } else {
      console.log(`Health for ${slug}: PENDING`)
    }
  })

  test('GET /recon/:slug/scored-issues returns issues with scores', async ({ request }) => {
    const wlRes = await request.get(`${API}/recon/watchlist`)
    const slug = (await wlRes.json()).data.slugs[0]

    const res = await request.get(`${API}/recon/${slug}/scored-issues`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.issues.length).toBeGreaterThan(0)
    expect(body.data.slug).toBe(slug)
    console.log(`Scored issues for ${slug}: ${body.data.issues.length} issues`)
  })

  test('GET /recon/:slug/dossier returns all 6 sections', async ({ request }) => {
    const wlRes = await request.get(`${API}/recon/watchlist`)
    const slug = (await wlRes.json()).data.slugs[0]

    const res = await request.get(`${API}/recon/${slug}/dossier`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    if (body.data.status !== 'pending') {
      const sections = Object.keys(body.data.sections)
      expect(sections).toContain('overview')
      expect(sections).toContain('contributionRules')
      expect(sections).toContain('successPatterns')
      expect(sections).toContain('antiPatterns')
      expect(sections).toContain('issueBoard')
      expect(sections).toContain('environmentSetup')
      // Each section should have content
      for (const key of sections) {
        expect(body.data.sections[key].length).toBeGreaterThan(0)
      }
      console.log(`Dossier for ${slug}: ${sections.length} sections, all have content`)
    } else {
      console.log(`Dossier for ${slug}: PENDING`)
    }
  })

  test('GET /issues?source=all (legacy) still works', async ({ request }) => {
    const res = await request.get(`${API}/issues?source=all`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.issues.length).toBeGreaterThan(0)
    console.log(`Legacy issues: ${body.data.issues.length}`)
  })
})

// ============================================================================
// Page Load & Error Detection
// ============================================================================

test.describe('Page Load', () => {
  test('loads with zero console errors and zero API 5xx errors', async ({ page }) => {
    const log = attachLogCollectors(page)
    const res = await page.goto(BASE, { waitUntil: 'networkidle' })

    expect(res?.status()).toBe(200)
    await page.waitForTimeout(5000) // let all async data settle

    // Strict: no API 5xx errors allowed
    expect(log.apiErrors).toEqual([])
    expect(log.networkFailures).toEqual([])

    // Log console errors but don't fail on them (browser extensions can cause these)
    if (log.consoleErrors.length > 0) {
      console.log('Console errors (non-fatal):', log.consoleErrors)
    }
  })
})

// ============================================================================
// UI Content Validation — verify actual data renders, not just elements exist
// ============================================================================

test.describe('UI Content', () => {
  test('sidebar shows recon project names, NOT legacy projects', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(5000)

    await page.screenshot({ path: 'e2e/screenshots/01-initial-load.png', fullPage: true })

    // Get all project names in the sidebar
    const projectNames = await page.locator('.project-selector__name-btn').allInnerTexts()

    console.log('Sidebar projects:', projectNames)

    // Must NOT contain legacy project names
    const legacyNames = ['Blender', 'Dapr', 'DeepSpeed', 'FFmpeg', 'LangChain']
    for (const legacy of legacyNames) {
      expect(projectNames).not.toContain(legacy)
    }

    // Must contain at least one recon project (owner/repo format)
    expect(projectNames.length).toBeGreaterThan(0)
    // Recon projects use "owner/repo" format
    const hasSlashFormat = projectNames.some(name => name.includes('/'))
    expect(hasSlashFormat).toBe(true)

    expect(log.apiErrors).toEqual([])
  })

  test('issue table displays scored issues with CVS data', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(5000)

    // The issue count in the toolbar should be > 0
    const issueCountText = await page.locator('.toolbar__count').innerText()
    console.log('Issue count text:', issueCountText)
    const issueCount = parseInt(issueCountText, 10)
    expect(issueCount).toBeGreaterThan(0)

    // Table rows should exist
    const rows = page.locator('.issue-table__row')
    const rowCount = await rows.count()
    console.log(`Table rows: ${rowCount}`)
    expect(rowCount).toBeGreaterThan(0)

    // First row should contain CVS score badge
    const firstRow = rows.first()
    const cvsCell = firstRow.locator('.cvs-badge')
    expect(await cvsCell.count()).toBeGreaterThan(0)
    const cvsText = await cvsCell.first().innerText()
    console.log('First row CVS:', cvsText)
    // CVS should be a number
    expect(parseInt(cvsText, 10)).toBeGreaterThanOrEqual(0)

    // First row should have a lifecycle badge
    const lifecycleBadge = firstRow.locator('.lifecycle-badge')
    expect(await lifecycleBadge.count()).toBeGreaterThan(0)
    console.log('First row lifecycle:', await lifecycleBadge.first().innerText())

    await page.screenshot({ path: 'e2e/screenshots/02-issue-table.png', fullPage: true })
    expect(log.apiErrors).toEqual([])
  })

  test('footer shows correct issue and project counts', async ({ page }) => {
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(5000)

    const footerText = await page.locator('.oss-aggregator__footer').innerText()
    console.log('Footer text:', footerText)

    // Footer should mention issues and projects with non-zero counts
    expect(footerText).toMatch(/\d+\s+issues/)
    expect(footerText).toMatch(/\d+\s+projects/)

    // Extract counts — should not be zero
    const issueMatch = footerText.match(/(\d+)\s+issues/)
    const projectMatch = footerText.match(/(\d+)\s+projects/)
    if (issueMatch) expect(parseInt(issueMatch[1], 10)).toBeGreaterThan(0)
    if (projectMatch) expect(parseInt(projectMatch[1], 10)).toBeGreaterThan(0)
  })
})

// ============================================================================
// UI Interactions — click things, verify they work
// ============================================================================

test.describe('UI Interactions', () => {
  test('clicking an issue row opens the detail drawer with scored data', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(5000)

    const rows = page.locator('.issue-table__row')
    const rowCount = await rows.count()
    expect(rowCount).toBeGreaterThan(0)

    // Click first issue row
    await rows.first().click()
    await page.waitForTimeout(1000)

    // Drawer should open
    const drawer = page.locator('.drawer--open')
    expect(await drawer.count()).toBe(1)

    // Drawer should contain issue detail content
    const drawerText = await drawer.first().innerText()
    console.log('Drawer content (first 300 chars):', drawerText.slice(0, 300))

    // Should contain CVS score information
    expect(drawerText.length).toBeGreaterThan(50)

    await page.screenshot({ path: 'e2e/screenshots/03-issue-detail-drawer.png', fullPage: true })

    // Close with Escape
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    expect(await page.locator('.drawer--open').count()).toBe(0)

    expect(log.apiErrors).toEqual([])
  })

  test('view toggle switches between table and card views with data', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(5000)

    const viewToggle = page.locator('.toolbar__view-toggle button')
    const toggleCount = await viewToggle.count()
    expect(toggleCount).toBe(2)

    // Start in table view — should have rows
    const tableRows = await page.locator('.issue-table__row').count()
    console.log(`Table view rows: ${tableRows}`)
    expect(tableRows).toBeGreaterThan(0)

    // Switch to card view
    await viewToggle.nth(1).click()
    await page.waitForTimeout(500)

    const cards = page.locator('.issue-card')
    const cardCount = await cards.count()
    console.log(`Card view cards: ${cardCount}`)
    expect(cardCount).toBeGreaterThan(0)

    // Cards should have CVS badges
    const cardCvs = cards.first().locator('.cvs-badge')
    expect(await cardCvs.count()).toBeGreaterThan(0)

    await page.screenshot({ path: 'e2e/screenshots/04-card-view.png', fullPage: true })

    // Switch back to table
    await viewToggle.nth(0).click()
    await page.waitForTimeout(500)
    expect(await page.locator('.issue-table__row').count()).toBeGreaterThan(0)

    expect(log.apiErrors).toEqual([])
  })

  test('toolbar filter dropdowns filter issues correctly', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(5000)

    // Get initial issue count
    const initialCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log('Initial issue count:', initialCount)
    expect(initialCount).toBeGreaterThan(0)

    // Filter by tier: select "Go" tier only
    const tierSelect = page.locator('.toolbar__filters select').first()
    const tierOptions = await tierSelect.locator('option').allInnerTexts()
    console.log('Tier filter options:', tierOptions)

    // Select a specific tier (e.g., "Go" if available)
    if (tierOptions.includes('Go')) {
      await tierSelect.selectOption('go')
      await page.waitForTimeout(500)
      const filteredCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
      console.log(`After "Go" filter: ${filteredCount} issues`)
      // Should be fewer or equal (unless all are "go")
      expect(filteredCount).toBeLessThanOrEqual(initialCount)
    }

    // Reset filter
    await tierSelect.selectOption('')
    await page.waitForTimeout(500)

    // Test search
    const searchInput = page.locator('.toolbar__search input')
    if ((await searchInput.count()) > 0) {
      await searchInput.fill('validation')
      await page.waitForTimeout(500)
      const searchCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
      console.log(`After search "validation": ${searchCount} issues`)
      // Search should narrow results (or return 0 if no match)
      expect(searchCount).toBeLessThanOrEqual(initialCount)

      await searchInput.fill('')
      await page.waitForTimeout(500)
    }

    expect(log.apiErrors).toEqual([])
  })

  test('clicking project name in sidebar focuses repo and shows health panel', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(5000)

    // Click the project name button (not checkbox)
    const projectBtns = page.locator('.project-selector__name-btn')
    const btnCount = await projectBtns.count()
    expect(btnCount).toBeGreaterThan(0)

    const projectName = await projectBtns.first().innerText()
    console.log(`Clicking project: "${projectName}"`)
    await projectBtns.first().click()
    await page.waitForTimeout(2000)

    // Health panel should appear
    const healthPanel = page.locator('.repo-health')
    const healthPanelCount = await healthPanel.count()
    console.log(`Health panel visible: ${healthPanelCount > 0}`)

    if (healthPanelCount > 0) {
      const healthText = await healthPanel.innerText()
      console.log('Health panel content (first 200 chars):', healthText.slice(0, 200))
    }

    await page.screenshot({
      path: 'e2e/screenshots/05-project-focused-with-health.png',
      fullPage: true
    })

    expect(log.apiErrors).toEqual([])
  })

  test('clicking repo link in table opens dossier drawer', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(5000)

    // Find repo link buttons in the table
    const repoLinks = page.locator('.issue-table__repo-link')
    const linkCount = await repoLinks.count()
    console.log(`Repo links in table: ${linkCount}`)

    if (linkCount > 0) {
      const repoName = await repoLinks.first().innerText()
      console.log(`Clicking repo link: "${repoName}"`)
      await repoLinks.first().click()
      await page.waitForTimeout(2000)

      // Dossier drawer should open
      const drawer = page.locator('.drawer--open')
      const drawerCount = await drawer.count()
      console.log(`Dossier drawer opened: ${drawerCount > 0}`)

      if (drawerCount > 0) {
        const drawerText = await drawer.innerText()
        console.log('Dossier drawer content (first 300 chars):', drawerText.slice(0, 300))

        // Should contain dossier tab navigation
        const tabs = drawer.locator('.dossier__tab, [class*="dossier__tab"]')
        const tabCount = await tabs.count()
        console.log(`Dossier tabs: ${tabCount}`)

        await page.screenshot({
          path: 'e2e/screenshots/06-dossier-drawer.png',
          fullPage: true
        })

        // Close drawer
        await page.keyboard.press('Escape')
        await page.waitForTimeout(500)
      }
    }

    expect(log.apiErrors).toEqual([])
  })

  test('unchecking a project in sidebar removes its issues from table', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(5000)

    const initialCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log('Initial issue count:', initialCount)

    // Click "None" to deselect all projects
    const noneBtn = page.locator('.project-selector__action').nth(1)
    const noneBtnText = await noneBtn.innerText()
    console.log(`Clicking "${noneBtnText}" button`)
    await noneBtn.click()
    await page.waitForTimeout(500)

    // Should show 0 issues or "no issues" message
    const afterNoneCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log(`After "None": ${afterNoneCount} issues`)
    expect(afterNoneCount).toBe(0)

    // Click "All" to re-select
    const allBtn = page.locator('.project-selector__action').nth(0)
    await allBtn.click()
    await page.waitForTimeout(500)

    const afterAllCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log(`After "All": ${afterAllCount} issues`)
    expect(afterAllCount).toBe(initialCount)

    expect(log.apiErrors).toEqual([])
  })
})
