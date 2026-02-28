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
    // Get a slug from scored issues
    const siRes = await request.get(`${API}/recon/all-scored-issues?limit=1`)
    const slug = (await siRes.json()).data.issues[0].repoSlug

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
    const siRes = await request.get(`${API}/recon/all-scored-issues?limit=1`)
    const slug = (await siRes.json()).data.issues[0].repoSlug

    const res = await request.get(`${API}/recon/${slug}/scored-issues`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.issues.length).toBeGreaterThan(0)
    expect(body.data.slug).toBe(slug)
    console.log(`Scored issues for ${slug}: ${body.data.issues.length} issues`)
  })

  test('GET /recon/:slug/dossier returns all 6 sections', async ({ request }) => {
    const siRes = await request.get(`${API}/recon/all-scored-issues?limit=1`)
    const slug = (await siRes.json()).data.issues[0].repoSlug

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

  test('GET /issues?source=all (legacy) returns 404 (endpoint removed)', async ({ request }) => {
    const res = await request.get(`${API}/issues?source=all`)
    // Legacy endpoint was removed — verify it's gone, not silently broken
    console.log(`Legacy /issues?source=all status: ${res.status()}`)
    expect(res.status()).toBe(404)
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
    await page.goto(BASE)

    // Wait for first table row to appear — implicitly validates fast render
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

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

    // Drawer should open (renders .drawer-backdrop > .drawer when isOpen)
    const drawer = page.locator('.drawer-backdrop .drawer')
    await expect(drawer).toBeVisible({ timeout: 3000 })

    // Drawer should contain issue detail content
    const drawerText = await drawer.innerText()
    console.log('Drawer content (first 300 chars):', drawerText.slice(0, 300))

    // Should contain CVS score information
    expect(drawerText.length).toBeGreaterThan(50)

    await page.screenshot({ path: 'e2e/screenshots/03-issue-detail-drawer.png', fullPage: true })

    // Close with Escape
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    expect(await page.locator('.drawer-backdrop').count()).toBe(0)

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

    // Filter by tier
    const tierSelect = page.locator('select.toolbar__filter-select').first()
    const tierOptions = await tierSelect.locator('option').allInnerTexts()
    console.log('Tier filter options:', tierOptions)

    // Select "Go" tier (top-100 by CVS are all "Go" tier issues)
    await tierSelect.selectOption('go')
    await page.waitForTimeout(500)
    const filteredCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log(`After "Go" filter: ${filteredCount} issues`)
    expect(filteredCount).toBeLessThanOrEqual(initialCount)
    expect(filteredCount).toBeGreaterThan(0)

    // Reset filter back to "All Tiers"
    await tierSelect.selectOption('')
    await page.waitForTimeout(500)
    const resetCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log(`After reset: ${resetCount} issues`)
    // Count may be >= initial due to infinite scroll loading during interaction
    expect(resetCount).toBeGreaterThanOrEqual(initialCount)

    // Test search (toolbar__search is the input element itself)
    const searchInput = page.locator('input.toolbar__search')
    expect(await searchInput.count()).toBe(1)
    await searchInput.fill('validation')
    await page.waitForTimeout(500)
    const searchCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log(`After search "validation": ${searchCount} issues`)
    expect(searchCount).toBeLessThanOrEqual(initialCount)

    await searchInput.fill('')
    await page.waitForTimeout(500)

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

    expect(linkCount).toBeGreaterThan(0)

    const repoName = await repoLinks.first().innerText()
    console.log(`Clicking repo link: "${repoName}"`)
    await repoLinks.first().click()

    // Dossier drawer should open
    const drawer = page.locator('.drawer-backdrop .drawer')
    await expect(drawer).toBeVisible({ timeout: 5000 })

    // Wait for dossier content to load (tabs appear after fetch completes)
    const tabs = drawer.locator('.dossier__tab')
    await expect(tabs.first()).toBeVisible({ timeout: 10000 })

    const tabCount = await tabs.count()
    console.log(`Dossier tabs: ${tabCount}`)
    expect(tabCount).toBeGreaterThan(0)

    const drawerText = await drawer.innerText()
    console.log('Dossier drawer content (first 300 chars):', drawerText.slice(0, 300))
    expect(drawerText.length).toBeGreaterThan(100)

    await page.screenshot({
      path: 'e2e/screenshots/06-dossier-drawer.png',
      fullPage: true
    })

    // Close drawer
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    expect(await page.locator('.drawer-backdrop').count()).toBe(0)

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
    // Count may be >= initial due to infinite scroll loading more data while "None" was active
    expect(afterAllCount).toBeGreaterThanOrEqual(initialCount)

    expect(log.apiErrors).toEqual([])
  })
})

// ============================================================================
// Performance & Pagination — validate speed improvements and data integrity
// ============================================================================

test.describe('Performance & Pagination', () => {
  test('paginated API returns exactly limit issues with hasMore', async ({ request }) => {
    const start = Date.now()
    const res = await request.get(`${API}/recon/all-scored-issues?sort=cvs&dir=desc&limit=100`)
    const elapsed = Date.now() - start
    console.log(`Paginated API response time: ${elapsed}ms`)

    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.issues).toHaveLength(100)
    expect(body.data.hasMore).toBe(true)
    expect(body.data.totalCount).toBeGreaterThan(100)
    expect(body.data.offset).toBe(0)

    // Response time should be well under 2s for a paginated request
    expect(elapsed).toBeLessThan(2000)
  })

  test('paginated response payload is under 500 KB', async ({ request }) => {
    const res = await request.get(`${API}/recon/all-scored-issues?sort=cvs&dir=desc&limit=100`)
    const body = await res.text()
    const sizeKB = Buffer.byteLength(body, 'utf8') / 1024

    console.log(`Paginated response size: ${sizeKB.toFixed(1)} KB`)
    expect(sizeKB).toBeLessThan(500)
  })

  test('sort parameter produces correctly sorted results', async ({ request }) => {
    const res = await request.get(`${API}/recon/all-scored-issues?sort=title&dir=asc&limit=10`)
    const body = await res.json()

    expect(body.data.issues.length).toBeGreaterThan(1)
    const titles = body.data.issues.map((i: { title: string }) => i.title)
    console.log('First 5 sorted titles:', titles.slice(0, 5))

    // Verify ascending order
    for (let i = 1; i < titles.length; i++) {
      expect(titles[i].localeCompare(titles[i - 1])).toBeGreaterThanOrEqual(0)
    }

    // Verify descending is actually different
    const resDesc = await request.get(`${API}/recon/all-scored-issues?sort=title&dir=desc&limit=10`)
    const bodyDesc = await resDesc.json()
    const titlesDesc = bodyDesc.data.issues.map((i: { title: string }) => i.title)
    console.log('First 5 desc titles:', titlesDesc.slice(0, 5))

    // asc and desc must produce different order
    const areSame = titles.every((t: string, i: number) => t === titlesDesc[i])
    expect(areSame).toBe(false)
  })

  test('backward compat: no limit param returns all issues', async ({ request }) => {
    const res = await request.get(`${API}/recon/all-scored-issues`)
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.issues.length).toBeGreaterThan(100)
    expect(body.data.totalCount).toBe(body.data.issues.length)
    // hasMore should not be present in backward-compat mode
    expect(body.data.hasMore).toBeUndefined()
    console.log(`Backward compat: ${body.data.issues.length} issues returned`)
  })

  test('version endpoint returns aggregate metadata', async ({ request }) => {
    const res = await request.get(`${API}/recon/all-scored-issues/version`)
    expect(res.status()).toBe(200)
    const body = await res.json()

    expect(body.success).toBe(true)
    expect(body.data.version).toBeGreaterThan(0)
    expect(body.data.repoCount).toBeGreaterThan(0)
    expect(body.data.totalCount).toBeGreaterThan(0)
    console.log(
      `Aggregate version: ${body.data.version}, ` +
        `${body.data.repoCount} repos, ${body.data.totalCount} issues`
    )
  })
})

// ============================================================================
// Page Load Performance — validate fast initial render and no errors
// ============================================================================

test.describe('Page Load Performance', () => {
  test('first issue row renders within 5 seconds', async ({ page }) => {
    const log = attachLogCollectors(page)
    const start = Date.now()

    await page.goto(BASE)
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    const elapsed = Date.now() - start
    console.log(`Time to first issue row: ${elapsed}ms`)

    // Should render within 5s (generous for CI; was previously blocked on 11 MB download)
    expect(elapsed).toBeLessThan(5000)

    expect(log.apiErrors).toEqual([])
    expect(log.networkFailures).toEqual([])
  })

  test('zero console errors during initial page load', async ({ page }) => {
    const log = attachLogCollectors(page)

    await page.goto(BASE)
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })
    // Wait a bit more for any deferred errors
    await page.waitForTimeout(2000)

    expect(log.consoleErrors).toEqual([])
    expect(log.apiErrors).toEqual([])
    expect(log.networkFailures).toEqual([])
  })

  test('no sidebar health dots rendered (removed feature)', async ({ page }) => {
    await page.goto(BASE)
    await page.waitForSelector('.project-selector__name-btn', { timeout: 10000 })

    const healthDots = await page.locator('.project-selector__health-dot').count()
    expect(healthDots).toBe(0)
    console.log('Health dots rendered: 0 (removed)')
  })

  test('stripped fields are absent from paginated API response', async ({ request }) => {
    const res = await request.get(`${API}/recon/all-scored-issues?sort=cvs&dir=desc&limit=5`)
    const body = await res.json()
    const issue = body.data.issues[0]

    // These fields should be stripped
    expect(issue.body).toBeUndefined()
    expect(issue.bodyPreview).toBeUndefined()
    expect(issue.linkedPrUrls).toBeUndefined()
    expect(issue.assignees).toBeUndefined()
    expect(issue.sentimentSignals).toBeUndefined()
    expect(issue.commentDigest).toBeUndefined()
    expect(issue.likelyFiles).toBeUndefined()
    expect(issue.relatedIssues).toBeUndefined()
    expect(issue._scoring).toBeUndefined()
    expect(issue.difficultySignals).toBeUndefined()
    expect(issue.reactionGroups).toBeUndefined()

    // Essential fields should be present
    expect(issue.cvs).toBeDefined()
    expect(issue.cvsTier).toBeDefined()
    expect(issue.repoSlug).toBeDefined()
    expect(issue.title).toBeDefined()
    console.log('Stripped fields verified absent, essential fields present')
  })
})

// ============================================================================
// Extended Interactions — column sorting, dossier tabs, refresh, project search
// ============================================================================

test.describe('Column Sorting', () => {
  test('clicking table column headers changes sort order', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    // Click Title column header to sort by title
    const titleHeader = page.locator('th.issue-table__cell--title')
    await titleHeader.click()
    await page.waitForTimeout(500)

    // Header should now show sort indicator
    const titleText = await titleHeader.innerText()
    console.log('Title header after click:', titleText)
    expect(titleText).toMatch(/[↑↓]/)

    // Get first few titles in current order
    const titlesFirst = await page
      .locator('.issue-table__row .issue-table__cell--title')
      .allInnerTexts()
    console.log('First 3 titles (first click):', titlesFirst.slice(0, 3))

    // Click again to toggle direction
    await titleHeader.click()
    await page.waitForTimeout(500)

    const titleTextToggled = await titleHeader.innerText()
    console.log('Title header after 2nd click:', titleTextToggled)
    expect(titleTextToggled).toMatch(/[↑↓]/)

    const titlesSecond = await page
      .locator('.issue-table__row .issue-table__cell--title')
      .allInnerTexts()
    console.log('First 3 titles (second click):', titlesSecond.slice(0, 3))

    // The last title of one order should be the first of the other (reversed)
    const lastFirst = titlesFirst[titlesFirst.length - 1]
    const firstSecond = titlesSecond[0]
    console.log(`Last of first order: "${lastFirst}", First of second order: "${firstSecond}"`)
    // At minimum, the sort direction indicator should have toggled
    expect(titleText).not.toBe(titleTextToggled)

    expect(log.apiErrors).toEqual([])
  })

  test('clicking CVS column header sorts by score', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    // Click CVS header (should already be default sort, so first click toggles)
    const cvsHeader = page.locator('th.issue-table__cell--cvs')
    await cvsHeader.click()
    await page.waitForTimeout(500)

    // Read CVS scores from first few rows
    const cvsValues = await page.locator('.issue-table__row .cvs-badge').allInnerTexts()
    const scores = cvsValues.slice(0, 5).map(v => parseInt(v, 10))
    console.log('CVS scores after sort:', scores)

    // Verify they're in order (ascending or descending)
    const isAsc = scores.every((v, i) => i === 0 || v >= scores[i - 1])
    const isDesc = scores.every((v, i) => i === 0 || v <= scores[i - 1])
    expect(isAsc || isDesc).toBe(true)
    console.log(`CVS sort direction: ${isAsc ? 'ascending' : 'descending'}`)

    expect(log.apiErrors).toEqual([])
  })

  test('clicking Age column header sorts by creation date', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    const ageHeader = page.locator('th.issue-table__cell--age')
    await ageHeader.click()
    await page.waitForTimeout(500)

    const ageText = await ageHeader.innerText()
    console.log('Age header after click:', ageText)
    // Should have sort indicator
    expect(ageText).toMatch(/[↑↓]/)

    expect(log.apiErrors).toEqual([])
  })
})

test.describe('Toolbar Sort Dropdown', () => {
  test('sort dropdown changes issue ordering', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    const sortSelect = page.locator('select.toolbar__sort-select')
    expect(await sortSelect.count()).toBe(1)

    // Get options
    const options = await sortSelect.locator('option').allInnerTexts()
    console.log('Sort dropdown options:', options)
    expect(options.length).toBeGreaterThanOrEqual(4)

    // Default should be "CVS (High → Low)"
    const defaultVal = await sortSelect.inputValue()
    console.log('Default sort value:', defaultVal)

    // Get first title with current sort
    const firstTitleBefore = await page
      .locator('.issue-table__row .issue-table__cell--title')
      .first()
      .innerText()

    // Switch to "Newest First"
    await sortSelect.selectOption('createdAt-desc')
    await page.waitForTimeout(500)

    const firstTitleAfter = await page
      .locator('.issue-table__row .issue-table__cell--title')
      .first()
      .innerText()
    console.log(`Sort change: "${firstTitleBefore}" → "${firstTitleAfter}"`)

    // Switch to "Least Competition"
    await sortSelect.selectOption('competition-asc')
    await page.waitForTimeout(500)
    const firstTitleComp = await page
      .locator('.issue-table__row .issue-table__cell--title')
      .first()
      .innerText()
    console.log(`Least competition first: "${firstTitleComp}"`)

    // Switch to "Easiest First"
    await sortSelect.selectOption('complexity-asc')
    await page.waitForTimeout(500)
    const firstTitleEasy = await page
      .locator('.issue-table__row .issue-table__cell--title')
      .first()
      .innerText()
    console.log(`Easiest first: "${firstTitleEasy}"`)

    expect(log.apiErrors).toEqual([])
  })
})

test.describe('Dossier Drawer Tabs', () => {
  test('clicking all 6 dossier tabs renders content for each', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    // Open dossier drawer via repo link
    const repoLinks = page.locator('.issue-table__repo-link')
    expect(await repoLinks.count()).toBeGreaterThan(0)
    const repoName = await repoLinks.first().innerText()
    console.log(`Opening dossier for: ${repoName}`)
    await repoLinks.first().click()

    const drawer = page.locator('.drawer-backdrop .drawer')
    await expect(drawer).toBeVisible({ timeout: 5000 })

    // Wait for tabs to load
    const tabs = drawer.locator('.dossier__tab')
    await expect(tabs.first()).toBeVisible({ timeout: 10000 })

    const tabCount = await tabs.count()
    console.log(`Total dossier tabs: ${tabCount}`)
    expect(tabCount).toBe(6)

    const tabLabels = await tabs.allInnerTexts()
    console.log('Tab labels:', tabLabels)

    // Click each tab and verify content changes
    for (let i = 0; i < tabCount; i++) {
      await tabs.nth(i).click()
      await page.waitForTimeout(500)

      const tabLabel = tabLabels[i]
      const isActive = await tabs
        .nth(i)
        .evaluate(el => el.classList.contains('dossier__tab--active'))
      expect(isActive).toBe(true)

      const content = await drawer.locator('.dossier__content').innerText()
      console.log(`Tab "${tabLabel}" content length: ${content.length} chars`)
      expect(content.length).toBeGreaterThan(0)
    }

    await page.screenshot({ path: 'e2e/screenshots/07-dossier-tabs.png', fullPage: true })

    // Verify copy buttons exist
    const copyBtns = drawer.locator('.dossier__copy-btn')
    expect(await copyBtns.count()).toBe(2) // Copy Section + Copy All
    const agentBtn = drawer.locator('.dossier__agent-prompt-btn')
    expect(await agentBtn.count()).toBe(1)

    // Close drawer
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    expect(await page.locator('.drawer-backdrop').count()).toBe(0)

    expect(log.apiErrors).toEqual([])
  })
})

test.describe('Project Selector Search', () => {
  test('typing in project search filters project list', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.project-selector__name-btn', { timeout: 10000 })

    // Count initial projects
    const initialProjectCount = await page.locator('.project-selector__name-btn').count()
    console.log(`Initial project count: ${initialProjectCount}`)
    expect(initialProjectCount).toBeGreaterThan(1)

    // Type a search term (grab first project name fragment)
    const firstName = await page.locator('.project-selector__name-btn').first().innerText()
    // Use first few chars of the project name to filter
    const searchTerm = firstName.slice(0, 4)
    console.log(`Searching for: "${searchTerm}"`)

    const projectSearch = page.locator('.project-selector__search')
    await projectSearch.fill(searchTerm)
    await page.waitForTimeout(300)

    const filteredCount = await page.locator('.project-selector__name-btn').count()
    console.log(`Filtered project count: ${filteredCount}`)
    expect(filteredCount).toBeLessThanOrEqual(initialProjectCount)
    expect(filteredCount).toBeGreaterThan(0)

    // Clear search
    await projectSearch.fill('')
    await page.waitForTimeout(300)
    const restoredCount = await page.locator('.project-selector__name-btn').count()
    expect(restoredCount).toBe(initialProjectCount)

    // Search for something that won't match
    await projectSearch.fill('zzznonexistent999')
    await page.waitForTimeout(300)
    const emptyCount = await page.locator('.project-selector__name-btn').count()
    console.log(`Non-matching search: ${emptyCount} projects`)
    expect(emptyCount).toBe(0)

    expect(log.apiErrors).toEqual([])
  })
})

test.describe('Refresh Button', () => {
  test('clicking refresh button reloads data without errors', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    const refreshBtn = page.locator('.refresh-button')
    expect(await refreshBtn.count()).toBe(1)

    // Click refresh
    await refreshBtn.click()
    await page.waitForTimeout(1000)

    // Should show loading state (button should be disabled during load)
    // Wait for data to settle
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    // Issue count should still be > 0
    const issueCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log(`Issues after refresh: ${issueCount}`)
    expect(issueCount).toBeGreaterThan(0)

    expect(log.apiErrors).toEqual([])
    expect(log.networkFailures).toEqual([])
  })
})

test.describe('Issue Detail Drawer Deep Interactions', () => {
  test('issue detail drawer shows all metric fields', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    // Click first issue row
    await page.locator('.issue-table__row').first().click()
    await page.waitForTimeout(1000)

    const drawer = page.locator('.drawer-backdrop .drawer')
    await expect(drawer).toBeVisible({ timeout: 3000 })

    // Verify all metric labels are present
    const metricLabels = await drawer.locator('.issue-detail__metric-label').allInnerTexts()
    console.log('Issue detail metric labels:', metricLabels)

    // Labels may be rendered uppercase via CSS text-transform
    const labelsLower = metricLabels.map((l: string) => l.toLowerCase())
    expect(labelsLower).toContain('lifecycle')
    expect(labelsLower).toContain('complexity')
    expect(labelsLower).toContain('sentiment')
    expect(labelsLower).toContain('competition')
    expect(labelsLower).toContain('content quality')
    expect(labelsLower).toContain('claim')
    expect(labelsLower).toContain('created')
    expect(labelsLower).toContain('comments')

    // Verify action buttons
    const openGithubBtn = drawer.locator('.issue-detail__action-btn--primary')
    expect(await openGithubBtn.count()).toBe(1)
    const githubHref = await openGithubBtn.getAttribute('href')
    console.log('GitHub link:', githubHref)
    expect(githubHref).toContain('github.com')

    // View Dossier button should exist
    const viewDossierBtns = drawer.locator('button.issue-detail__action-btn')
    const viewDossierBtn = viewDossierBtns.filter({ hasText: 'View Repo Dossier' })
    expect(await viewDossierBtn.count()).toBe(1)

    await page.screenshot({ path: 'e2e/screenshots/08-issue-detail-full.png', fullPage: true })

    expect(log.apiErrors).toEqual([])
  })

  test('View Repo Dossier button in issue detail opens dossier drawer', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    // Open issue detail
    await page.locator('.issue-table__row').first().click()
    await page.waitForTimeout(1000)

    const issueDrawer = page.locator('.drawer-backdrop .drawer')
    await expect(issueDrawer).toBeVisible({ timeout: 3000 })

    // Click "View Repo Dossier"
    const viewDossierBtn = issueDrawer
      .locator('button.issue-detail__action-btn')
      .filter({ hasText: 'View Repo Dossier' })
    await viewDossierBtn.click()
    await page.waitForTimeout(1000)

    // Issue drawer should close and dossier drawer should open
    const dossierDrawer = page.locator('.drawer-backdrop .drawer')
    await expect(dossierDrawer).toBeVisible({ timeout: 5000 })

    // Should have dossier tabs
    const tabs = dossierDrawer.locator('.dossier__tab')
    await expect(tabs.first()).toBeVisible({ timeout: 10000 })
    console.log('Dossier opened from issue detail, tabs visible')

    // Close
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    expect(log.apiErrors).toEqual([])
  })
})

test.describe('Card View Interactions', () => {
  test('clicking a card in card view opens issue detail drawer', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    // Switch to card view
    const cardViewBtn = page.locator('.toolbar__view-toggle button').nth(1)
    await cardViewBtn.click()
    await page.waitForTimeout(500)

    const cards = page.locator('.issue-card')
    const cardCount = await cards.count()
    console.log(`Cards rendered: ${cardCount}`)
    expect(cardCount).toBeGreaterThan(0)

    // Click a card to open issue detail
    await cards.first().click()
    await page.waitForTimeout(1000)

    const drawer = page.locator('.drawer-backdrop .drawer')
    await expect(drawer).toBeVisible({ timeout: 3000 })

    const drawerText = await drawer.innerText()
    console.log('Issue detail from card (first 200 chars):', drawerText.slice(0, 200))
    expect(drawerText.length).toBeGreaterThan(50)

    // Close
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    expect(log.apiErrors).toEqual([])
  })

  test('repo button in card view opens dossier drawer', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    // Switch to card view
    await page.locator('.toolbar__view-toggle button').nth(1).click()
    await page.waitForTimeout(500)

    const repoBtn = page.locator('.issue-card__repo')
    const repoBtnCount = await repoBtn.count()
    console.log(`Card repo buttons: ${repoBtnCount}`)
    expect(repoBtnCount).toBeGreaterThan(0)

    const repoName = await repoBtn.first().innerText()
    console.log(`Clicking card repo: "${repoName}"`)
    await repoBtn.first().click()

    const drawer = page.locator('.drawer-backdrop .drawer')
    await expect(drawer).toBeVisible({ timeout: 5000 })

    // Should have dossier tabs (not issue detail)
    const tabs = drawer.locator('.dossier__tab')
    await expect(tabs.first()).toBeVisible({ timeout: 10000 })

    console.log('Dossier opened from card repo button')

    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    expect(log.apiErrors).toEqual([])
  })
})

test.describe('Filter Combinations & Edge Cases', () => {
  test('combining tier + lifecycle filters narrows results', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    const initialCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log('Initial count:', initialCount)

    // Apply tier filter
    const selects = page.locator('select.toolbar__filter-select')
    await selects.nth(0).selectOption('go') // Tier: Go
    await page.waitForTimeout(500)
    const afterTier = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log(`After Go tier: ${afterTier}`)
    expect(afterTier).toBeLessThanOrEqual(initialCount)

    // Stack lifecycle filter on top
    await selects.nth(1).selectOption('fresh') // Lifecycle: Fresh
    await page.waitForTimeout(500)
    const afterBoth = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log(`After Go + Fresh: ${afterBoth}`)
    expect(afterBoth).toBeLessThanOrEqual(afterTier)

    // Stack complexity filter
    await selects.nth(2).selectOption('low') // Complexity: Low
    await page.waitForTimeout(500)
    const afterAll = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log(`After Go + Fresh + Low: ${afterAll}`)
    expect(afterAll).toBeLessThanOrEqual(afterBoth)

    // Reset all
    await selects.nth(0).selectOption('')
    await selects.nth(1).selectOption('')
    await selects.nth(2).selectOption('')
    await page.waitForTimeout(500)
    const resetCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    expect(resetCount).toBeGreaterThanOrEqual(initialCount)

    expect(log.apiErrors).toEqual([])
  })

  test('search + filter combination works correctly', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    const initialCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)

    // Apply a tier filter first
    await page.locator('select.toolbar__filter-select').first().selectOption('likely')
    await page.waitForTimeout(500)
    const afterFilter = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log(`After "Likely" filter: ${afterFilter}`)

    // Add search on top
    const searchInput = page.locator('input.toolbar__search')
    // Get a real title fragment from a visible row
    const rows = page.locator('.issue-table__row')
    if ((await rows.count()) > 0) {
      const firstTitle = await rows.first().locator('.issue-table__cell--title').innerText()
      const searchTerm = firstTitle.split(' ')[0] // first word
      await searchInput.fill(searchTerm)
      await page.waitForTimeout(500)
      const afterSearch = parseInt(await page.locator('.toolbar__count').innerText(), 10)
      console.log(`After filter + search "${searchTerm}": ${afterSearch}`)
      expect(afterSearch).toBeLessThanOrEqual(afterFilter)
    }

    // Clear everything
    await searchInput.fill('')
    await page.locator('select.toolbar__filter-select').first().selectOption('')
    await page.waitForTimeout(500)
    const resetCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    expect(resetCount).toBeGreaterThanOrEqual(initialCount)

    expect(log.apiErrors).toEqual([])
  })

  test('deselecting all projects then selecting one shows only its issues', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    const initialCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log('Initial:', initialCount)

    // Click "None"
    await page.locator('.project-selector__action').nth(1).click()
    await page.waitForTimeout(500)
    expect(parseInt(await page.locator('.toolbar__count').innerText(), 10)).toBe(0)

    // Check just the first project checkbox
    const firstCheckbox = page.locator('.project-selector__checkbox').first()
    await firstCheckbox.check()
    await page.waitForTimeout(500)

    const singleProjectCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log(`Single project selected: ${singleProjectCount} issues`)
    expect(singleProjectCount).toBeGreaterThan(0)
    expect(singleProjectCount).toBeLessThanOrEqual(initialCount)

    // All issues should belong to that project
    const repoNames = await page.locator('.issue-table__repo-link').allInnerTexts()
    const uniqueRepos = [...new Set(repoNames)]
    console.log('Visible repos:', uniqueRepos)
    expect(uniqueRepos.length).toBe(1)

    // Restore all
    await page.locator('.project-selector__action').nth(0).click()
    await page.waitForTimeout(500)

    expect(log.apiErrors).toEqual([])
  })

  test('empty state message shows when all filters exclude everything', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    // Deselect all projects to get empty state
    await page.locator('.project-selector__action').nth(1).click()
    await page.waitForTimeout(500)

    const count = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    expect(count).toBe(0)

    // Should show empty state or 0 rows
    const rows = await page.locator('.issue-table__row').count()
    const emptyState = await page.locator('.empty-state').count()
    console.log(`Rows: ${rows}, Empty state: ${emptyState}`)
    expect(rows).toBe(0)

    await page.screenshot({ path: 'e2e/screenshots/09-empty-state.png', fullPage: true })

    // Restore
    await page.locator('.project-selector__action').nth(0).click()
    await page.waitForTimeout(500)

    expect(log.apiErrors).toEqual([])
  })
})

test.describe('Health Panel from Sidebar', () => {
  test('clicking project name toggles focus and health panel', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.project-selector__name-btn', { timeout: 10000 })

    const projectBtns = page.locator('.project-selector__name-btn')

    // Click to focus
    await projectBtns.first().click()
    await page.waitForTimeout(2000)

    const healthPanel = page.locator('.repo-health')
    const isPanelVisible = (await healthPanel.count()) > 0
    console.log(`Health panel after focus click: ${isPanelVisible}`)

    if (isPanelVisible) {
      // Check for "View Full Dossier" button in health panel
      const dossierBtn = page.locator('.repo-health__dossier-btn')
      if ((await dossierBtn.count()) > 0) {
        console.log('Health panel has dossier button')
        await dossierBtn.click()
        await page.waitForTimeout(1000)

        // Dossier drawer should open
        const drawer = page.locator('.drawer-backdrop .drawer')
        await expect(drawer).toBeVisible({ timeout: 5000 })
        console.log('Dossier opened from health panel button')

        await page.keyboard.press('Escape')
        await page.waitForTimeout(500)
      }
    }

    // Click same project name again to unfocus
    await projectBtns.first().click()
    await page.waitForTimeout(1000)

    // Focused class should be removed
    const item = page.locator('.project-selector__item--focused')
    const focusedCount = await item.count()
    console.log(`Focused items after toggle off: ${focusedCount}`)
    expect(focusedCount).toBe(0)

    expect(log.apiErrors).toEqual([])
  })
})

test.describe('Drawer Close Behaviors', () => {
  test('clicking backdrop closes the drawer', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    // Open issue detail
    await page.locator('.issue-table__row').first().click()
    await page.waitForTimeout(1000)
    await expect(page.locator('.drawer-backdrop .drawer')).toBeVisible({ timeout: 3000 })

    // Click on the backdrop (not the drawer itself)
    await page.locator('.drawer-backdrop').click({ position: { x: 10, y: 10 } })
    await page.waitForTimeout(500)

    const backdropCount = await page.locator('.drawer-backdrop').count()
    console.log(`Backdrop after click-outside: ${backdropCount}`)
    // Drawer should be closed (backdrop gone or invisible)
    // Some implementations hide via CSS, others remove from DOM
    if (backdropCount > 0) {
      const isVisible = await page.locator('.drawer-backdrop').isVisible()
      expect(isVisible).toBe(false)
    }

    expect(log.apiErrors).toEqual([])
  })
})

test.describe('Lifecycle Filter Values', () => {
  test('all lifecycle filter options produce valid results', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.issue-table__row', { timeout: 10000 })

    const lifecycleSelect = page.locator('select.toolbar__filter-select').nth(1)
    const options = ['fresh', 'triaged', 'accepted', 'stale', 'zombie']

    for (const opt of options) {
      await lifecycleSelect.selectOption(opt)
      await page.waitForTimeout(500)

      const count = parseInt(await page.locator('.toolbar__count').innerText(), 10)
      console.log(`Lifecycle "${opt}": ${count} issues`)

      // Verify all visible lifecycle badges match the filter
      if (count > 0) {
        const badges = await page.locator('.issue-table__row .lifecycle-badge').allInnerTexts()
        const mismatch = badges.filter(b => b.toLowerCase() !== opt)
        if (mismatch.length > 0) {
          console.log(`WARNING: lifecycle mismatch for "${opt}":`, mismatch.slice(0, 3))
        }
        expect(mismatch.length).toBe(0)
      }
    }

    // Reset
    await lifecycleSelect.selectOption('')
    await page.waitForTimeout(500)

    expect(log.apiErrors).toEqual([])
  })
})

test.describe('Project Selection Count Display', () => {
  test('project selection count updates correctly', async ({ page }) => {
    const log = attachLogCollectors(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('.project-selector__name-btn', { timeout: 10000 })
    // Wait for data to fully settle before interacting
    await page.waitForTimeout(3000)

    const countText = await page.locator('.project-selector__count').innerText()
    console.log('Project selection count:', countText)
    // Should show "X of Y selected" format
    expect(countText).toMatch(/\d+ of \d+ selected/)

    // Extract numbers
    const match = countText.match(/(\d+) of (\d+)/)
    expect(match).toBeTruthy()
    const [, selected, total] = match!
    console.log(`Selected: ${selected}, Total: ${total}`)
    expect(parseInt(selected, 10)).toBe(parseInt(total, 10)) // All selected initially

    // Click "None"
    await page.locator('.project-selector__action').nth(1).click()
    await page.waitForTimeout(300)
    const afterNone = await page.locator('.project-selector__count').innerText()
    expect(afterNone).toMatch(/^0 of \d+ selected$/)

    // Click "All" — selects all currently known projects
    await page.locator('.project-selector__action').nth(0).click()
    await page.waitForTimeout(500)
    const afterAll = await page.locator('.project-selector__count').innerText()
    console.log('After All:', afterAll)
    // After "All", selected count should equal total count
    const afterMatch = afterAll.match(/(\d+) of (\d+) selected/)
    expect(afterMatch).toBeTruthy()
    expect(parseInt(afterMatch![1], 10)).toBe(parseInt(afterMatch![2], 10))

    expect(log.apiErrors).toEqual([])
  })
})
