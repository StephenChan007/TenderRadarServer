const axios = require('axios')
const cheerio = require('cheerio')
const fs = require('fs')
const { addNotice, hasNotice, getKeywords, getSites } = require('../data/store')

const HN_COOKIE = process.env.HUANENG_COOKIE || process.env.HN_COOKIE || ''
const HN_TOKEN = process.env.HUANENG_TOKEN || process.env.HN_TOKEN || ''
const HN_JSON_PATH =
  process.env.HUANENG_JSON_PATH || process.env.HN_JSON_PATH || '/tmp/huaneng.json'
const CHINALCO_SITE_GUID = '7eb5f7f1-9041-43ad-8e13-8fcb82ea831a'
const TANG_COOKIE = process.env.TANG_COOKIE || ''
const TANG_JSON_PATH =
  process.env.TANG_JSON_PATH || process.env.TANG_COOKIE_PATH || '/tmp/tang.json'

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

async function crawlHuanengApi(site) {
  const { cookie, token } = loadHuanengCreds()
  if (!cookie || !token) {
    console.warn(
      'Huaneng crawler skipped: set HUANENG_COOKIE/HUANENG_TOKEN or HUANENG_JSON_PATH'
    )
    return []
  }
  const url = `https://ec.chng.com.cn/scm-uiaoauth-web/s/business/uiaouth/queryAnnouncementByTitle?kbfJdf1e=${encodeURIComponent(
    token
  )}`
  console.log('[Huaneng] Fetching list with token prefix:', token.slice(0, 6))
  const res = await axios.post(
    url,
    { type: '103' },
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
  const data = res.data
  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.rows)
        ? data.rows
        : Array.isArray(data?.body?.data)
          ? data.body.data
          : []
  console.log('[Huaneng] API rows:', rows.length)
  const items = []
  for (const row of rows) {
    const title = row.title || row.noticeTitle || row.announcementTitle
    const link =
      row.url || row.noticeUrl || row.detailUrl || row.href || row.link
    const date =
      row.publishDate ||
      row.releaseDate ||
      row.date ||
      row.release_time ||
      row.publish_time
    if (!title || !link) continue
    items.push({
      title,
      source_url: normalizeUrl(
        link,
        site.site_url || 'https://ec.chng.com.cn'
      ),
      publishDate: toISODate(date),
      site_id: site.id,
      site_name: site.site_name
    })
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
