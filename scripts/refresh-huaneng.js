const { chromium } = require('playwright-chromium')
const fs = require('fs')
const path = require('path')

const OUTPUT_PATH =
  process.env.HUANENG_JSON_PATH ||
  process.env.HN_JSON_PATH ||
  '/tmp/huaneng.json'

async function main() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium-browser',
    '/usr/lib/chromium/chrome'
  ].filter(Boolean)
  const executablePath = candidates.find(p => fs.existsSync(p))

  if (!executablePath) {
    console.warn('[Huaneng] chromium executable not found, skip refresh')
    return
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox']
  })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' }
  })
  const page = await context.newPage()

  let token = null
  const tokenRequests = []

  page.on('request', req => {
    const url = req.url()
    if (url.includes('queryAnnouncementByTitle')) {
      try {
        const parsed = new URL(url)
        token = token || parsed.searchParams.get('kbfJdf1e')
        tokenRequests.push(url)
      } catch (_e) {
        return
      }
    }
  })

  await page.goto('https://ec.chng.com.cn/channel/home/', {
    waitUntil: 'networkidle',
    timeout: 60000
  })
  await page.waitForTimeout(8000)
  if (!token) {
    await page.waitForTimeout(5000)
  }

  const cookies = await context.cookies('https://ec.chng.com.cn')
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')

  await browser.close()

  const result = {
    cookie: cookieStr,
    token,
    capturedRequests: tokenRequests
  }

  if (OUTPUT_PATH) {
    try {
      const resolved = path.resolve(OUTPUT_PATH)
      fs.mkdirSync(path.dirname(resolved), { recursive: true })
      fs.writeFileSync(resolved, JSON.stringify(result, null, 2), 'utf8')
      console.log(`Saved to ${resolved}`)
    } catch (e) {
      console.error('Write HUANENG_JSON_PATH failed:', e.message)
    }
  }

  console.log(JSON.stringify(result, null, 2))
  if (token) {
    console.log('\nExport example:')
    console.log(`HUANENG_COOKIE="${cookieStr}"`)
    console.log(`HUANENG_TOKEN="${token}"`)
  } else {
    console.error('Token not captured, will proceed without updating env.')
  }
}

main().catch(err => {
  console.error('Refresh failed', err.message || err)
})
