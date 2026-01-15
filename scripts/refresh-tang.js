const { chromium } = require('playwright-chromium')
const fs = require('fs')
const path = require('path')

const OUTPUT_PATH =
  process.env.TANG_JSON_PATH || process.env.TANG_COOKIE_PATH || '/tmp/tang.json'

async function main() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/lib/chromium/chrome'
  ].filter(Boolean)
  const executablePath = candidates.find(p => fs.existsSync(p))
  if (!executablePath) {
    console.warn('[Tang] chromium executable not found, skip refresh')
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

  await page.goto(
    'https://tang.cdt-ec.com/notice/moreController/toMore?globleType=0',
    { waitUntil: 'networkidle', timeout: 20000 }
  )
  await page.waitForTimeout(4000)

  const cookies = await context.cookies('https://tang.cdt-ec.com')
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ')

  await browser.close()

  const result = { cookie: cookieStr }
  if (OUTPUT_PATH) {
    try {
      const resolved = path.resolve(OUTPUT_PATH)
      fs.mkdirSync(path.dirname(resolved), { recursive: true })
      fs.writeFileSync(resolved, JSON.stringify(result, null, 2), 'utf8')
      console.log(`Saved to ${resolved}`)
    } catch (e) {
      console.error('Write TANG_JSON_PATH failed:', e.message)
    }
  }

  console.log(JSON.stringify(result, null, 2))
  if (cookieStr) {
    console.log('\nExport example:')
    console.log(`TANG_COOKIE="${cookieStr}"`)
  }
}

main().catch(err => {
  console.error('Tang refresh failed', err.message || err)
})
