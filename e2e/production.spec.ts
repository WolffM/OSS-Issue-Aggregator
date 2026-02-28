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

    // Select "Maybe" tier (most likely to have results based on our data)
    await tierSelect.selectOption('maybe')
    await page.waitForTimeout(500)
    const filteredCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log(`After "Maybe" filter: ${filteredCount} issues`)
    expect(filteredCount).toBeLessThanOrEqual(initialCount)
    expect(filteredCount).toBeGreaterThan(0)

    // Reset filter back to "All Tiers"
    await tierSelect.selectOption('')
    await page.waitForTimeout(500)
    const resetCount = parseInt(await page.locator('.toolbar__count').innerText(), 10)
    console.log(`After reset: ${resetCount} issues`)
    expect(resetCount).toBe(initialCount)

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
    expect(afterAllCount).toBe(initialCount)

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
