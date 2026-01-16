const axios = require('axios')
const cheerio = require('cheerio')
const fs = require('fs')
const { chromium } = require('playwright-chromium')
const { addNotice, hasNotice, getKeywords, getSites } = require('../data/store')

const HN_COOKIE = process.env.HUANENG_COOKIE || process.env.HN_COOKIE || ''
const HN_TOKEN = process.env.HUANENG_TOKEN || process.env.HN_TOKEN || ''
const HN_JSON_PATH =
  process.env.HUANENG_JSON_PATH || process.env.HN_JSON_PATH || '/tmp/huaneng.json'
const CHINALCO_SITE_GUID = '7eb5f7f1-9041-43ad-8e13-8fcb82ea831a'
const TANG_COOKIE = process.env.TANG_COOKIE || ''
const TANG_JSON_PATH =
  process.env.TANG_JSON_PATH || process.env.TANG_COOKIE_PATH || '/tmp/tang.json'
const DEFAULT_HUANENG_URL = 'https://ec.chng.com.cn/channel/home/'

function resolveChromiumPath() {
  const bundled = chromium.executablePath && chromium.executablePath()
  const bundledPath = bundled && fs.existsSync(bundled) ? bundled : null
  const candidates = [
    bundledPath,
    process.env.CHROMIUM_PATH,
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium-browser',
    '/usr/lib/chromium/chrome'
  ].filter(Boolean)
  return candidates.find(p => fs.existsSync(p)) || null
}

function loadHuanengCreds() {
  let cookie = HN_COOKIE
  let token = HN_TOKEN
  if ((!cookie || !token) && HN_JSON_PATH) {
    try {
      const raw = fs.readFileSync(HN_JSON_PATH, 'utf8')
      const parsed = JSON.parse(raw)
      if (!cookie && parsed?.cookie) cookie = parsed.cookie
      if (!token && parsed?.token) token = parsed.token
    } catch (_e) {
      // ignore
    }
  }
  return { cookie, token }
}

function loadTangCookie() {
  let cookie = TANG_COOKIE
  if (!cookie && TANG_JSON_PATH) {
    try {
      const raw = fs.readFileSync(TANG_JSON_PATH, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed?.cookie) cookie = parsed.cookie
    } catch (_e) {
      // ignore
    }
  }
  return cookie
}

function normalizeUrl(url, base) {
  if (!url) return ''
  if (url.startsWith('http')) return url
  if (url.startsWith('//')) return `https:${url}`
  if (url.startsWith('/')) {
    try {
      return new URL(url, base).href
    } catch (_e) {
      return url
    }
  }
  return `${base.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`
}

function toISODate(str) {
  if (!str) return null
  const trimmed = String(str).trim()
  const patterns = [
    /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/,
    /(\d{1,2})[-/](\d{1,2})/
  ]
  for (const p of patterns) {
    const m = trimmed.match(p)
    if (m) {
      if (m[1].length === 4) {
        return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
      }
      const y = new Date().getFullYear()
      return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
    }
  }
  return null
}

async function matchKeywords(title, content) {
  const kws = await getKeywords()
  const text = `${title || ''} ${content || ''}`
  const matched = []
  for (const k of kws) {
    if (!k?.keyword) continue
    const kw = String(k.keyword).trim()
    if (!kw) continue
    const type = k.match_type || 'contain'
    if (type === 'regex') {
      try {
        if (new RegExp(kw, 'i').test(text)) matched.push(k)
      } catch (_e) {
        continue
      }
    } else if (type === 'exact') {
      if (text === kw) matched.push(k)
    } else {
      if (text.includes(kw)) matched.push(k)
    }
  }
  return matched
}

async function fetchDetailContent(url) {
  if (!url) return ''
  try {
    const res = await axios.get(url, {
      timeout: 20000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    const $ = cheerio.load(res.data || '')
    const possibleSelectors = [
      '.content',
      '.article-content',
      '#content',
      '.article',
      '.main',
      'body'
    ]
    for (const sel of possibleSelectors) {
      const text = $(sel).text().trim()
      if (text && text.length > 50) return text
    }
    return $('body').text().trim().slice(0, 4000)
  } catch (e) {
    console.error('Fetch detail failed', e.message)
    return ''
  }
}

async function crawlStaticSite(site) {
  const { selector_config: cfgRaw, list_page_url, site_url } = site
  if (!cfgRaw) return []
  let cfg = cfgRaw
  if (typeof cfgRaw === 'string') {
    try {
      cfg = JSON.parse(cfgRaw)
    } catch (_e) {
      return []
    }
  }
  if (!cfg.listSelector) return []

  const res = await axios.get(list_page_url, {
    timeout: 20000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  })
  const $ = cheerio.load(res.data || '')
  const items = []
  $(cfg.listSelector).each((_idx, el) => {
    const title = $(el).find(cfg.titleSelector || 'a').text().trim()
    const link = $(el).find(cfg.linkSelector || 'a').attr('href')
    const dateText = cfg.dateSelector
      ? $(el).find(cfg.dateSelector).text().trim()
      : ''
    if (!title || !link) return
    items.push({
      title,
      source_url: normalizeUrl(link, site_url || list_page_url),
      publishDate: toISODate(dateText),
      site_id: site.id,
      site_name: site.site_name
    })
  })
  return items
}

async function crawlChinalcoApi(site) {
  const all = []
  for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
    const url =
      'https://zb.chinalco.com.cn/EWB-FRONT/rest/secaction/getSecInfoListYzmstr'
    const body = new URLSearchParams({
      siteGuid: CHINALCO_SITE_GUID,
      categoryNum: '001003',
      content: '',
      pageIndex: String(pageIndex),
      pageSize: '10',
      startdate: '',
      enddate: ''
    }).toString()
    try {
      const res = await axios.post(url, body, {
        timeout: 20000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://zb.chinalco.com.cn/zbxx/001003/bid_goods.html',
          Origin: 'https://zb.chinalco.com.cn',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/javascript, */*; q=0.01'
        }
      })
      const data = res.data
      const items = Array.isArray(data?.data?.rows) ? data.data.rows : []
      if (!items.length) break
      all.push(
        ...items.map(row => ({
          title: row.title || row.infoname || '',
          source_url: row.url || row.infourl || '',
          publishDate: toISODate(
            row.infodate || row.publish_date || row.releasetime
          ),
          site_id: site.id,
          site_name: site.site_name
        }))
      )
    } catch (e) {
      console.error('Chinalco page fetch failed', e.message)
      break
    }
  }
  return all
}

function buildTangDetailUrl(row) {
  if (!row?.id) return ''
  const base = 'https://tang.cdt-ec.com'
  const id = row.id
  const mt = row.message_type || row.messageType
  const title = row.message_title || row.messageTitle || ''
  if (mt === '4' || mt === '5' || mt === '23' || mt === '24' || mt === '26') {
    return `${base}/notice/moreController/xjdhtml?id=${id}`
  }
  if (mt === '31') {
    return `${base}/home/moreall.html?id=${id}&message_type=${mt}&message_title=${encodeURIComponent(
      title
    )}`
  }
  return `${base}/notice/moreController/moreall?id=${id}`
}

async function crawlTangApi(site) {
  const cookie = loadTangCookie()
  if (!cookie) {
    console.warn('Tang crawler skipped: set TANG_COOKIE or TANG_JSON_PATH')
    return []
  }
  const url = 'https://tang.cdt-ec.com/notice/moreController/getList'
  const all = []
  for (let pageIndex = 0; pageIndex < 3; pageIndex++) {
    const body = new URLSearchParams({
      pageIndex: String(pageIndex),
      pageSize: '20',
      globleType: '0'
    }).toString()
    try {
      const res = await axios.post(url, body, {
        timeout: 20000,
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer:
            site.list_page_url || site.site_url || 'https://tang.cdt-ec.com',
          Origin: 'https://tang.cdt-ec.com',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/javascript, */*; q=0.01'
        }
      })
      const data = res.data
      const list =
        Array.isArray(data?.data?.data) || Array.isArray(data?.data?.list)
          ? data.data.data || data.data.list
          : Array.isArray(data?.data)
            ? data.data
            : Array.isArray(data?.list)
              ? data.list
              : []
      if (!list.length) break
      all.push(
        ...list
          .map(row => ({
            title: row.message_title || row.title || '',
            source_url: buildTangDetailUrl(row),
            publishDate:
              toISODate(row.deadline || row.releasetime || row.publish_date) ||
              null,
            site_id: site.id,
            site_name: site.site_name
          }))
          .filter(item => item.title && item.source_url)
      )
    } catch (e) {
      console.error('Tang page fetch failed', e.message)
      break
    }
  }
  return all
}

function parseHuanengRows(data) {
  return Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.rows)
        ? data.rows
        : Array.isArray(data?.body?.data)
          ? data.body.data
          : []
}

function normalizeHuanengRow(row, site) {
  const title = row.title || row.noticeTitle || row.announcementTitle
  const link = row.url || row.noticeUrl || row.detailUrl || row.href || row.link
  const date =
    row.publishDate ||
    row.releaseDate ||
    row.date ||
    row.release_time ||
    row.publish_time
  if (!title || !link) return null
  return {
    title,
    source_url: normalizeUrl(link, site.site_url || 'https://ec.chng.com.cn'),
    publishDate: toISODate(date),
    site_id: site.id,
    site_name: site.site_name
  }
}

function collectHuanengRows(rows, site, added, target) {
  for (const row of rows) {
    const normalized = normalizeHuanengRow(row, site)
    if (!normalized) continue
    const key = `${normalized.title}__${normalized.source_url}`
    if (added.has(key)) continue
    added.add(key)
    target.push(normalized)
  }
}

async function tryExtractHuanengToken(page) {
  try {
    const res = await page.evaluate(async () => {
      let found = null
      try {
        const r = await fetch(
          '/scm-uiaoauth-web/s/business/uiaouth/queryAnnouncementByTitle?kbfJdf1e=',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: '' })
          }
        )
        const url = r?.url || ''
        const m = url.match(/kbfJdf1e=([^&]+)/)
        if (m) found = m[1]
      } catch (_e) {
        // ignore
      }
      if (!found) {
        const scripts = Array.from(document.scripts || [])
        for (const s of scripts) {
          const txt = s.textContent || ''
          const m = txt.match(/kbfJdf1e["']?\s*[:=]\s*["']([^"']+)["']/)
          if (m) {
            found = m[1]
            break
          }
        }
      }
      return found
    })
    return res || null
  } catch (_e) {
    return null
  }
}

async function crawlHuanengWithBrowser(site) {
  const executablePath = resolveChromiumPath()
  const added = new Set()
  const items = []
  const targetTypes = ['103', '107']
  const seenTypes = new Set()
  let token = null
  let browser = null
  let context = null
  let page = null

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: executablePath || undefined,
      args: ['--no-sandbox']
    })
  } catch (e) {
    console.error('[华能] 浏览器启动失败：', e.message)
    return { items, token: null, cookie: null }
  }

  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
      extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' }
    })
    page = await context.newPage()

    page.on('request', req => {
      const url = req.url()
      if (!url.includes('queryAnnouncementByTitle')) return
      try {
        const parsed = new URL(url)
        const t = parsed.searchParams.get('kbfJdf1e')
        if (t && !token) token = t
      } catch (_e) {
        // ignore
      }
    })

    page.on('response', async res => {
      if (!page || page.isClosed()) return
      if (res.status && res.status() >= 400) return
      const url = res.url()
      if (!url.includes('queryAnnouncementByTitle')) return
      try {
        const req = res.request()
        const body = req.postData() || ''
        let reqType = null
        if (body) {
          try {
            const parsed = JSON.parse(body)
            if (parsed?.type) reqType = String(parsed.type)
          } catch (_e) {
            const m = body.match(/type=([^&]+)/)
            if (m) reqType = decodeURIComponent(m[1])
          }
        }
        const data = await res.json()
        collectHuanengRows(parseHuanengRows(data), site, added, items)
        if (reqType) seenTypes.add(reqType)
        if (!token) {
          try {
            const parsed = new URL(url)
            const t = parsed.searchParams.get('kbfJdf1e')
            if (t) token = t
          } catch (_e) {
            // ignore
          }
        }
      } catch (e) {
        console.error('[华能] 解析响应失败：', e.message)
      }
    })

    const targetUrl = site.list_page_url || site.site_url || DEFAULT_HUANENG_URL
    try {
      await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 })
    } catch (e) {
      console.error('[华能] 页面打开失败：', e.message)
    }

    await page.waitForTimeout(4000)
    if (!items.length) {
      await page.waitForTimeout(2000)
    }

    if (targetTypes.some(t => !seenTypes.has(t))) {
      const tokenValue = token || (await tryExtractHuanengToken(page))
      if (tokenValue) {
        token = tokenValue
        for (const t of targetTypes) {
          if (seenTypes.has(t)) continue
          const apiUrl = `https://ec.chng.com.cn/scm-uiaoauth-web/s/business/uiaouth/queryAnnouncementByTitle?kbfJdf1e=${encodeURIComponent(
            tokenValue
          )}`
          try {
            const resp = await page.request.post(apiUrl, {
              data: { type: t },
              headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/plain, */*'
              },
              timeout: 20000
            })
            const json = await resp.json()
            collectHuanengRows(parseHuanengRows(json), site, added, items)
            seenTypes.add(t)
          } catch (e) {
            console.error(`[华能] 类型${t}补拉失败：`, e.message)
          }
        }
      }
    }

    const cookieStr = context
      ? (await context.cookies('https://ec.chng.com.cn'))
          .map(c => `${c.name}=${c.value}`)
          .join('; ')
      : null

    if (items.length) {
      console.log(`[华能] 浏览器抓取得到 ${items.length} 条数据`)
    } else {
      console.warn('[华能] 浏览器抓取未获取到数据')
    }

    return { items, token, cookie: cookieStr }
  } catch (e) {
    const cookieStr = context
      ? (await context.cookies('https://ec.chng.com.cn'))
          .map(c => `${c.name}=${c.value}`)
          .join('; ')
      : null
    console.error('[华能] 浏览器抓取异常：', e.message)
    return { items, token: token || null, cookie: cookieStr }
  } finally {
    if (browser) {
      try {
        await browser.close()
      } catch (_e) {
        // ignore
      }
    }
  }
}

async function crawlHuanengApi(site) {
  const {
    items: browserItems,
    token: browserToken,
    cookie: browserCookie
  } = (await crawlHuanengWithBrowser(site)) || { items: [], token: null, cookie: null }
  if (Array.isArray(browserItems) && browserItems.length) return browserItems

  const { cookie: envCookie, token: envToken } = loadHuanengCreds()
  const token = browserToken || envToken
  const cookie = browserCookie || envCookie
  if (!cookie || !token) {
    console.warn(
      '华能抓取跳过：浏览器模式无数据且未配置 HUANENG_COOKIE/HUANENG_TOKEN 或 HUANENG_JSON_PATH'
    )
    return []
  }

  console.warn('[华能] 启用接口回退方式获取数据')
  const types = ['103', '107']
  const items = []
  const added = new Set()
  for (const t of types) {
    const url = `https://ec.chng.com.cn/scm-uiaoauth-web/s/business/uiaouth/queryAnnouncementByTitle?kbfJdf1e=${encodeURIComponent(
      token
    )}`
    console.log(`[华能] 接口抓取类型 ${t}，token 前缀：${token.slice(0, 6)}`)
    try {
      const res = await axios.post(
        url,
        { type: t },
        {
          timeout: 20000,
          headers: {
            Cookie: cookie,
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            Referer: 'https://ec.chng.com.cn/channel/home/',
            'Content-Type': 'application/json',
            Accept: 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9'
          }
        }
      )
      const rows = parseHuanengRows(res.data)
      console.log(`[华能] 类型 ${t} 返回 ${rows.length} 条`)
      collectHuanengRows(rows, site, added, items)
    } catch (e) {
      console.error(`[华能] 接口类型 ${t} 失败：`, e.message)
    }
  }
  return items
}

async function processNotice(raw, site) {
  if (!raw?.title || !raw?.source_url) return
  if (await hasNotice(raw.title, raw.source_url)) {
    return
  }
  const content = await fetchDetailContent(raw.source_url)
  const matched = await matchKeywords(raw.title, content)
  if (!matched.length) return
  await addNotice({
    title: raw.title,
    site_name: site.site_name,
    site_id: site.id,
    publishDate: raw.publishDate || new Date().toISOString().slice(0, 10),
    content: content || raw.title,
    source_url: raw.source_url
  })
}

async function crawlSite(site) {
  if (!site || site.status === 0) return
  try {
    let notices = []
    if (site.crawler_type === 'huaneng_api') {
      notices = await crawlHuanengApi(site)
    } else if (site.crawler_type === 'chinalco_api') {
      notices = await crawlChinalcoApi(site)
    } else if (site.crawler_type === 'tang_api') {
      notices = await crawlTangApi(site)
    } else {
      notices = await crawlStaticSite(site)
    }
    for (const n of notices) {
      await processNotice(n, site)
    }
    console.log(
      `Crawled site ${site.site_name}: got ${notices.length} items (after filters)`
    )
  } catch (e) {
    console.error(`Crawl failed for ${site.site_name}:`, e.message)
  }
}

async function crawlAllSites() {
  const sites = (await getSites()).filter(s => s.status !== 0)
  for (const site of sites) {
    await crawlSite(site)
  }
}

module.exports = {
  crawlAllSites,
  crawlSite
}
