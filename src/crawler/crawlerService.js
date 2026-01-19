const axios = require('axios')
const cheerio = require('cheerio')
const fs = require('fs')
const { chromium } = require('playwright-chromium')
const { addNotice, hasNotice, getKeywords, getSites } = require('../data/store')
const { notifyMatchedNotice } = require('../notify/notifyService')

const HN_COOKIE = process.env.HUANENG_COOKIE || process.env.HN_COOKIE || ''
const HN_TOKEN = process.env.HUANENG_TOKEN || process.env.HN_TOKEN || ''
const HN_JSON_PATH =
  process.env.HUANENG_JSON_PATH || process.env.HN_JSON_PATH || '/tmp/huaneng.json'
const CHINALCO_SITE_GUID = '7eb5f7f1-9041-43ad-8e13-8fcb82ea831a'
const HUADIAN_COOKIE = process.env.HUADIAN_COOKIE || process.env.HD_COOKIE || ''
const HUADIAN_COOKIE_PATH =
  process.env.HUADIAN_COOKIE_PATH || process.env.HD_JSON_PATH || '/tmp/huadian.json'
const TANG_COOKIE = process.env.TANG_COOKIE || ''
const TANG_JSON_PATH =
  process.env.TANG_JSON_PATH || process.env.TANG_COOKIE_PATH || '/tmp/tang.json'
const DEFAULT_HUANENG_URL = 'https://ec.chng.com.cn/channel/home/'
const HN_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'
const HN_ANNOUNCEMENT_URL = 'https://ec.chng.com.cn/#/announcement'
let latestHuanengCookie = ''
let latestHuadianCookie = ''

function resolveChromiumPath() {
  const bundled =
    typeof chromium.executablePath === 'function'
      ? chromium.executablePath()
      : null
  const bundledPath = bundled && fs.existsSync(bundled) ? bundled : null
  const candidates = [
    bundledPath,
    process.env.CHROMIUM_PATH,
    process.env.CHROMIUM_PATH,
    '/usr/bin/chromium',
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

function loadHuadianCookie() {
  let cookie = HUADIAN_COOKIE || latestHuadianCookie
  if (!cookie && HUADIAN_COOKIE_PATH) {
    try {
      const raw = fs.readFileSync(HUADIAN_COOKIE_PATH, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed?.cookie) cookie = parsed.cookie
    } catch (_e) {
      // ignore
    }
  }
  return cookie
}

async function axiosInPage(page, url, data) {
  return await page.evaluate(
    async ({ url, data }) => {
      const runFetch = async () => {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/plain, */*'
          },
          body: JSON.stringify(data || {})
        })
        if (!res.ok) {
          throw new Error(`fetch status ${res.status}`)
        }
        return await res.json()
      }
      if (window.axios) {
        const res = await window.axios.post(url, data)
        return res?.data || null
      }
      return await runFetch()
    },
    { url, data }
  )
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
  let cookieHeader = ''
  let referer = null
  let extraHeaders = {}
  try {
    const parsed = new URL(url)
    if (parsed.hostname.includes('ec.chng.com.cn')) {
      const envCookie = loadHuanengCreds().cookie || ''
      cookieHeader = latestHuanengCookie || envCookie
      referer = 'https://ec.chng.com.cn/'
    } else if (parsed.hostname.includes('chdtp.com.cn')) {
      referer = 'https://www.chdtp.com.cn/pages/wzglS/cgxx/caigou.jsp'
      cookieHeader = loadHuadianCookie() || ''
      extraHeaders = {
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        Connection: 'keep-alive',
        Host: parsed.host,
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
        'sec-ch-ua':
          '"Google Chrome";v="114", "Chromium";v="114", "Not A(Brand";v="24"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"'
      }
    }
  } catch (_e) {
    // ignore parse error
  }
  try {
    const res = await axios.get(url, {
      timeout: 20000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        ...(referer ? { Referer: referer } : {}),
        ...extraHeaders
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
    if (e?.response?.status === 412) {
      console.warn(`Fetch detail 412: ${url}`)
    } else {
      console.error('Fetch detail failed', e.message)
    }
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

function parseHuadianHtml(html, site) {
  const $ = cheerio.load(html || '')
  const added = new Set()
  const items = []
  $('a').each((_idx, el) => {
    const href = $(el).attr('href') || ''
    const match = href.match(/toGetContent\(['"]([^'"]+)['"]\)/)
    if (!match) return
    const path = match[1]
    const title = $(el).text().trim()
    if (!title || !path) return
    const tr = $(el).closest('tr')
    const dateText = tr
      .find('span')
      .last()
      .text()
      .replace(/\[|\]/g, '')
      .trim()
    const link = normalizeUrl(
      `/staticPage/${path}`,
      site.site_url || site.list_page_url
    )
    const key = `${title}__${link}`
    if (added.has(key)) return
    added.add(key)
    items.push({
      title,
      source_url: link,
      publishDate: toISODate(dateText),
      site_id: site.id,
      site_name: site.site_name
    })
  })
  return items
}

async function crawlHuadianSite(site) {
  try {
    const sendRequest = async url => {
      let host = null
      try {
        host = new URL(url).host
      } catch (_e) {
        host = 'www.chdtp.com.cn'
      }
      const cookie = loadHuadianCookie()
      return await axios.get(url, {
        timeout: 20000,
        headers: {
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          Connection: 'keep-alive',
          Host: host,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
          Referer: site.list_page_url || site.site_url || 'https://www.chdtp.com.cn/',
          'Sec-Fetch-Dest': 'iframe',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin',
          'Upgrade-Insecure-Requests': '1',
          'sec-ch-ua':
            '"Google Chrome";v="114", "Chromium";v="114", "Not A(Brand";v="24"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          ...(cookie ? { Cookie: cookie } : {})
        }
      })
    }

    let res = null
    try {
      res = await sendRequest(site.list_page_url)
    } catch (_e) {
      const fallback =
        (site.site_url || 'https://www.chdtp.com.cn').replace(/\/$/, '') +
        '/webs/queryWebZbgg.action?zbggType=1'
      try {
        res = await sendRequest(fallback)
      } catch (__e) {
        res = null
      }
    }
    if (!res || res.status === 412) {
      console.warn('华电页面返回 412，尝试浏览器抓取绕过校验')
      const browserItems = await crawlHuadianWithBrowser(site)
      if (browserItems.length) return browserItems
    }

    return parseHuadianHtml(res.data, site)
  } catch (e) {
    console.error('华电页面抓取失败', e.message)
    const browserItems = await crawlHuadianWithBrowser(site)
    if (browserItems.length) return browserItems
    return []
  }
}

async function crawlHuadianWithBrowser(site) {
  const executablePath = resolveChromiumPath()
  let browser = null
  let page = null
  const added = new Set()
  const results = []
  const cookie = loadHuadianCookie()
  const pushItems = list => {
    for (const item of list || []) {
      const key = `${item.title}__${item.source_url}`
      if (added.has(key)) continue
      added.add(key)
      results.push(item)
    }
  }
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: executablePath || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    })
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      extraHTTPHeaders: {
        'Accept-Language': 'zh-CN,zh;q=0.9'
      },
      ...(cookie
        ? {
            storageState: {
              cookies: [
                ...cookie
                  .split(';')
                  .map(c => c.trim())
                  .filter(Boolean)
                  .map(kv => {
                    const [name, ...rest] = kv.split('=')
                    return {
                      name,
                      value: rest.join('='),
                      domain: '.chdtp.com.cn',
                      path: '/',
                      httpOnly: false,
                      secure: true
                    }
                  })
              ]
            }
          }
        : {})
    })
    page = await context.newPage()
    page.on('response', async res => {
      const url = res.url()
      if (!url.includes('chdtp.com.cn')) return
      if (
        !/queryWebZbgg\.action|caigou\.jsp|cgxx/.test(url) &&
        res.request().resourceType() !== 'document'
      )
        return
      try {
        const body = await res.text()
        const items = parseHuadianHtml(body, site)
        pushItems(items)
      } catch (_e) {
        // ignore parse error
      }
    })
    const targetUrl =
      site.list_page_url ||
      site.site_url ||
      'https://www.chdtp.com.cn/pages/wzglS/cgxx/caigou.jsp'
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(3000)
    try {
      const cookieStr = (
        await context.cookies('https://www.chdtp.com.cn')
      )
        .map(c => `${c.name}=${c.value}`)
        .join('; ')
      if (cookieStr) latestHuadianCookie = cookieStr
    } catch (_e) {
      // ignore
    }
    if (!results.length) {
      const html = await page.content()
      pushItems(parseHuadianHtml(html, site))
    }
    if (results.length) {
      console.log(`[华电] 浏览器抓取到 ${results.length} 条`)
    } else {
      console.warn('[华电] 浏览器抓取未获取到数据')
    }
    return results
  } catch (e) {
    console.error('[华电] 浏览器抓取失败：', e.message)
    return []
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

async function crawlChnenergySite(site) {
  try {
    const res = await axios.get(site.list_page_url, {
      timeout: 20000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    })
    const $ = cheerio.load(res.data || '')
    const added = new Set()
    const items = []
    $('a.infolink').each((_idx, el) => {
      const a = $(el)
      const title = a.text().trim()
      const link = a.attr('href')
      if (!title || !link) return
      const li = a.closest('li')
      const dateText = li.find('span.r').first().text().trim()
      const source = normalizeUrl(
        link,
        site.site_url || site.list_page_url
      )
      const key = `${title}__${source}`
      if (added.has(key)) return
      added.add(key)
      items.push({
        title,
        source_url: source,
        publishDate: toISODate(dateText),
        site_id: site.id,
        site_name: site.site_name
      })
    })
    return items
  } catch (e) {
    console.error('国家能源招标网抓取失败', e.message)
    return []
  }
}

function buildSgccDetailUrl(row, site) {
  const docId = row.firstPageDocId || row.noticeId || row.id
  if (!docId) return ''
  const noticeType = row.noticeType || ''
  const cfg =
    typeof site.selector_config === 'string'
      ? (() => {
          try {
            return JSON.parse(site.selector_config)
          } catch (_e) {
            return null
          }
        })()
      : site.selector_config
  const menuId =
    row.firstPageMenuId || (cfg && cfg.firstPageMenuId) || ''
  const params = [docId, noticeType, menuId].filter(Boolean).join('_')
  const origin = site.site_url || 'https://ecp.sgcc.com.cn'
  const portalBase =
    (site.list_page_url && site.list_page_url.split('#')[0]) ||
    `${origin.replace(/\/$/, '')}/ecp2.0//portal/`
  return `${portalBase}#/content/${params}`
}

async function crawlSgccApi(site) {
  const cfg =
    typeof site.selector_config === 'string'
      ? (() => {
          try {
            return JSON.parse(site.selector_config)
          } catch (_e) {
            return null
          }
        })()
      : site.selector_config
  const payload = {
    index: 1,
    size: 20,
    firstPageMenuId: (cfg && cfg.firstPageMenuId) || '2018032700291334',
    purOrgStatus: '',
    purOrgCode: '',
    purType: '',
    noticeType: '',
    orgId: '',
    key: '',
    orgName: ''
  }
  try {
    const res = await axios.post(
      'https://ecp.sgcc.com.cn/ecp2.0/ecpwcmcore//index/noteList',
      payload,
      {
        timeout: 20000,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Origin: site.site_url || 'https://ecp.sgcc.com.cn',
          Referer:
            site.list_page_url ||
            site.site_url ||
            'https://ecp.sgcc.com.cn/ecp2.0//portal/',
          Accept: 'application/json, text/plain, */*'
        }
      }
    )
    const data = res.data
    const list = Array.isArray(data?.resultValue?.noteList)
      ? data.resultValue.noteList
      : Array.isArray(data?.noteList)
        ? data.noteList
        : []
    return list
      .map(row => {
        const title = row.title || row.noticeTitle || ''
        const source_url = buildSgccDetailUrl(row, site)
        if (!title || !source_url) return null
        return {
          title,
          source_url,
          publishDate: toISODate(
            row.noticePublishTime || row.publish_time || row.topBeginTime
          ),
          site_id: site.id,
          site_name: site.site_name
        }
      })
      .filter(Boolean)
  } catch (e) {
    console.error('国家电网接口抓取失败', e.message)
    return []
  }
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
      const items = Array.isArray(data?.data?.rows)
        ? data.data.rows
        : Array.isArray(data?.custom?.infodata)
          ? data.custom.infodata
          : Array.isArray(data?.data?.data)
            ? data.data.data
            : []
      if (!items.length) break
      all.push(
        ...items.map(row => ({
          title: row.title || row.infoname || '',
          source_url: normalizeUrl(
            row.url || row.infourl || '',
            site.site_url || site.list_page_url
          ),
          publishDate: toISODate(
            row.infodate || row.publish_date || row.releasetime || row.startdate
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

function parseTangList(list, site) {
  return (list || [])
    .map(row => ({
      title: row.message_title || row.title || '',
      source_url: buildTangDetailUrl(row),
      publishDate:
        toISODate(
          row.publish_time || row.deadline || row.releasetime || row.publish_date
        ) || null,
      site_id: site.id,
      site_name: site.site_name
    }))
    .filter(item => item.title && item.source_url)
}

async function crawlTangWithBrowser(site) {
  const executablePath = resolveChromiumPath()
  let browser = null
  let page = null
  const added = new Set()
  const items = []
  const collect = list => {
    for (const n of parseTangList(list, site)) {
      const key = `${n.title}__${n.source_url}`
      if (added.has(key)) continue
      added.add(key)
      items.push(n)
    }
  }
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: executablePath || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    })
  } catch (e) {
    console.error('[成达通] 浏览器启动失败：', e.message)
    return []
  }

  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' }
    })
    page = await context.newPage()
    page.on('response', async res => {
      const url = res.url()
      if (!url.includes('/notice/moreController/getList')) return
      try {
        const data = await res.json()
        const list = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.list)
            ? data.list
            : Array.isArray(data?.data?.data)
              ? data.data.data
              : Array.isArray(data?.data?.list)
                ? data.data.list
                : []
        collect(list)
      } catch (_e) {
        // ignore parse error
      }
    })

    const home = site.site_url || 'https://tang.cdt-ec.com'
    const targetUrl =
      site.list_page_url ||
      `${home.replace(/\/$/, '')}/notice/moreController/toMore?globleType=0`

    try {
      await page.goto(home, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(2000)
    } catch (_e) {
      // ignore home load errors
    }

    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 })
    await page.waitForTimeout(4000)

    if (!items.length) {
      try {
        const data = await page.evaluate(async () => {
          const body = new URLSearchParams({
            page: '1',
            limit: '10',
            messagetype: '0',
            startDate: '',
            endDate: ''
          }).toString()
          const res = await fetch(
            'https://tang.cdt-ec.com/notice/moreController/getList',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
              },
              credentials: 'include',
              body
            }
          )
          return await res.json()
        })
        const list = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.list)
            ? data.list
            : Array.isArray(data?.data?.data)
              ? data.data.data
              : Array.isArray(data?.data?.list)
                ? data.data.list
                : []
        collect(list)
      } catch (_e) {
        // ignore
      }
    }
    if (items.length) {
      console.log(`[成达通] 浏览器抓取到 ${items.length} 条`)
    } else {
      console.warn('[成达通] 浏览器抓取未获取到数据')
    }
    return items
  } catch (e) {
    console.error('[成达通] 浏览器抓取失败：', e.message)
    return []
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

async function crawlTangApi(site) {
  const url = 'https://tang.cdt-ec.com/notice/moreController/getList'
  const all = []
  const browserItems = await crawlTangWithBrowser(site)
  if (browserItems.length) return browserItems

  for (let pageIndex = 1; pageIndex <= 3; pageIndex++) {
    const buildBody = fallback =>
      new URLSearchParams(
        fallback
          ? {
              pageIndex: String(pageIndex - 1),
              pageSize: '20',
              globleType: '0'
            }
          : {
              page: String(pageIndex),
              limit: '10',
              messagetype: '0',
              startDate: '',
              endDate: ''
            }
      ).toString()
    const bodies = [buildBody(false), buildBody(true)]
    try {
      let list = []
      let lastData = null
      for (const body of bodies) {
        const res = await axios.post(url, body, {
          timeout: 20000,
          headers: {
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
        lastData = data
        list = Array.isArray(data?.data)
          ? data.data
          : Array.isArray(data?.list)
            ? data.list
            : Array.isArray(data?.data?.data)
              ? data.data.data
              : Array.isArray(data?.data?.list)
                ? data.data.list
                : []
        if (list.length) break
      }

      if (!list.length) {
        console.warn(
          `Tang 返回空列表，响应片段: ${JSON.stringify(lastData || {}).slice(0, 200)}`
        )
        break
      }

      all.push(...parseTangList(list, site))
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
    : Array.isArray(data?.root)
      ? data.root
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.rows)
        ? data.rows
        : Array.isArray(data?.body?.data)
          ? data.body.data
          : []
}

function normalizeHuanengRow(row, site) {
  const title =
    row.title ||
    row.noticeTitle ||
    row.announcementTitle ||
    row.message_title ||
    row.projectName
  const link =
    row.url ||
    row.noticeUrl ||
    row.detailUrl ||
    row.href ||
    row.link ||
    row.announcementUrl
  const id =
    row.announcementId ||
    row.noticeId ||
    row.id ||
    row.notice_id ||
    row.noticeid
  const resolvedLink =
    link ||
    (id
      ? `https://ec.chng.com.cn/#/announcement/detail?announcementId=${id}`
      : null)
  const date =
    row.publishDate ||
    row.releaseDate ||
    row.date ||
    row.release_time ||
    row.publish_time
  if (!title || !resolvedLink) return null
  return {
    title,
    source_url: normalizeUrl(
      resolvedLink,
      site.site_url || 'https://ec.chng.com.cn'
    ),
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

async function handleHuanengResponse(response, site, added, items, seenTypes) {
  const url = response.url()
  if (!url.includes('queryAnnouncementByTitle')) return
  try {
    const req = response.request()
    let type = null
    try {
      const body = req.postData()
      if (body) {
        const parsed = JSON.parse(body)
        type = parsed?.type || parsed?.noticeType || null
      }
    } catch (_e) {
      // ignore parse errors
    }
    let tokenFromUrl = null
    try {
      const parsedUrl = new URL(url)
      tokenFromUrl = parsedUrl.searchParams.get('kbfJdf1e') || null
    } catch (_e) {
      // ignore
    }
    const data = await response.json()
    const rows = parseHuanengRows(data)
    collectHuanengRows(rows, site, added, items)
    if (type) seenTypes.add(String(type))
    console.log(
      `[华能] 页面响应${type ? ` 类型 ${type}` : ''} 返回 ${rows.length} 条，token: ${tokenFromUrl ? tokenFromUrl.slice(0, 6) : '未知'}`
    )
  } catch (e) {
    console.error('[华能] 解析页面响应失败：', e.message)
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

async function fetchHuanengApiViaPage({
  page,
  types,
  token,
  site,
  added,
  items,
  seenTypes
}) {
  const baseUrl =
    'https://ec.chng.com.cn/scm-uiaoauth-web/s/business/uiaouth/queryAnnouncementByTitle'
  const referer = site.list_page_url || site.site_url || DEFAULT_HUANENG_URL
  for (const t of types) {
    const attempts = []
    if (token) attempts.push(`${baseUrl}?kbfJdf1e=${encodeURIComponent(token)}`)
    attempts.push(`${baseUrl}?kbfJdf1e=`)
    attempts.push(baseUrl)
    for (const url of attempts) {
      try {
        const json = await axiosInPage(page, url, { type: t })
        const rows = parseHuanengRows(json)
        const count = Array.isArray(rows) ? rows.length : 0
        if (!count) {
          const msg = json?.message || json?.msg || ''
          console.warn(
            `[华能] 页面接口类型 ${t} 返回 0 条，code: ${json?.code || ''} msg: ${msg}`
          )
          console.warn(`[华能] 页面接口类型 ${t} 原始响应: ${JSON.stringify(json).slice(0, 500)}`)
        }
        collectHuanengRows(rows, site, added, items)
        seenTypes.add(t)
        console.log(
          `[华能] 页面接口类型 ${t} 返回 ${items.length} 条 (累计)，使用 URL: ${url}`
        )
        break
      } catch (e) {
        console.error(`[华能] 页面接口类型 ${t} 请求失败（${url}）：`, e.message)
      }
    }
  }
}

async function crawlHuanengWithBrowser(site) {
  const executablePath = resolveChromiumPath()
  const added = new Set()
  const items = []
  const seenTypes = new Set()
  let token = null
  let browser = null
  let context = null
  let page = null
  const pendingResponses = new Set()

  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: executablePath || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled']
    })
  } catch (e) {
    console.error('[华能] 浏览器启动失败：', e.message)
    return { items, token: null, cookie: null }
  }

  try {
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: HN_USER_AGENT,
      extraHTTPHeaders: {
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
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
    page.on('response', res => {
      const p = handleHuanengResponse(res, site, added, items, seenTypes)
      if (p && typeof p.then === 'function') {
        pendingResponses.add(p)
        p.finally(() => pendingResponses.delete(p))
      }
    })

    const targetUrl =
      site.list_page_url || site.site_url || HN_ANNOUNCEMENT_URL || DEFAULT_HUANENG_URL
    try {
      await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 })
    } catch (e) {
      console.error('[华能] 页面打开失败：', e.message)
    }

    try {
      await page.waitForResponse(
        r => r.url().includes('queryAnnouncementByTitle') && r.status() === 200,
        { timeout: 3000 }
      )
    } catch (_e) {
      // ignore
    }
    await page.waitForTimeout(3000)

    if (pendingResponses.size) {
      await Promise.all([...pendingResponses])
    }
    if (!token) {
      const tokenValue = await tryExtractHuanengToken(page)
      token = tokenValue || null
    }

    const cookieStr = context
      ? (await context.cookies('https://ec.chng.com.cn'))
          .map(c => `${c.name}=${c.value}`)
          .join('; ')
      : null
    if (cookieStr) latestHuanengCookie = cookieStr

    if (items.length) {
      console.log(`[华能] 浏览器监听获取 ${items.length} 条数据`)
    } else {
      console.warn('[华能] 浏览器监听未捕获到数据')
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
  if (!cookie) {
    console.warn(
      '华能抓取跳过：无可用 Cookie，浏览器和环境均未提供'
    )
    return []
  }

  console.warn('[华能] 启用接口回退方式获取数据')
  const types = ['103', '107']
  const items = []
  const added = new Set()
  const referer = site.list_page_url || site.site_url || DEFAULT_HUANENG_URL
  for (const t of types) {
    const url = `https://ec.chng.com.cn/scm-uiaoauth-web/s/business/uiaouth/queryAnnouncementByTitle?kbfJdf1e=${encodeURIComponent(
      token || ''
    )}`
    const tokenPrefix = token ? token.slice(0, 6) : 'empty'
    console.log(`[华能] 接口抓取类型 ${t}，token 前缀：${tokenPrefix}`)
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
            Referer: referer,
            Origin: 'https://ec.chng.com.cn',
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
  const saved = await addNotice({
    title: raw.title,
    site_name: site.site_name,
    site_id: site.id,
    publishDate: raw.publishDate || new Date().toISOString().slice(0, 10),
    content: content || raw.title,
    source_url: raw.source_url
  })
  if (saved) {
    await notifyMatchedNotice(saved, matched)
  }
}

async function crawlSite(site) {
  if (!site || site.status === 0) return
  try {
    let notices = []
    if (site.crawler_type === 'huaneng_api') {
      notices = await crawlHuanengApi(site)
    } else if (site.crawler_type === 'huadian_html') {
      notices = await crawlHuadianSite(site)
    } else if (site.crawler_type === 'chnenergy_html') {
      notices = await crawlChnenergySite(site)
    } else if (site.crawler_type === 'sgcc_api') {
      notices = await crawlSgccApi(site)
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
    if (notices.length) {
      const preview = notices
        .slice(0, 5)
        .map(n => `${n.title} | ${n.publishDate || ''} | ${n.source_url}`)
      console.log(`示例（前 ${preview.length} 条）：`)
      for (const line of preview) console.log(line)
    }
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
