const crypto = require('crypto')
const mysql = require('mysql2/promise')
const Redis = require('ioredis')

const DB_URL = process.env.DB_URL || process.env.MYSQL_URL
const REDIS_URL = process.env.REDIS_URL

let pool = null
let redis = null

if (DB_URL) {
  try {
    pool = mysql.createPool(DB_URL)
    console.log('[DB] MySQL pool created')
  } catch (e) {
    console.error('[DB] Failed to init pool:', e.message)
  }
}

if (REDIS_URL) {
  try {
    redis = new Redis(REDIS_URL)
    redis.on('error', err => console.error('[Redis] error', err.message))
    console.log('[Redis] client created')
  } catch (e) {
    console.error('[Redis] Failed to init:', e.message)
  }
}

function handleDbError(context, error) {
  console.error(
    `[DB] ${context} failed (falling back to in-memory store):`,
    error?.message || error
  )
  pool = null
}

const notices = [
  {
    id: 1,
    title: '示例公告：智慧园区弱电工程招标',
    site_name: '中国政府采购网',
    publishDate: '2026-01-12',
    content: '此处为公告正文示例。实际内容由爬虫入库后返回。',
    source_url: 'https://example.com/notice/1'
  },
  {
    id: 2,
    title: '示例公告：数据中心机房建设项目',
    site_name: '公共资源交易平台',
    publishDate: '2026-01-13',
    content: '公告正文示例，用于前端调试详情页。',
    source_url: 'https://example.com/notice/2'
  }
]

const keywords = [
  { id: 1, keyword: '弱电', match_type: 'contain' },
  { id: 2, keyword: '数据中心', match_type: 'contain' }
]

const sites = [
  {
    id: 1,
    site_name: '中国政府采购网',
    site_url: 'http://www.ccgp.gov.cn',
    list_page_url: 'http://www.ccgp.gov.cn/cggg/dfgg/',
    crawler_type: 'static',
    selector_config: {
      listSelector: '.vT_detail_list > ul > li, .vT_detail_llist > ul > li',
      titleSelector: 'a',
      linkSelector: 'a',
      dateSelector: 'span'
    },
    status: 1
  },
  {
    id: 2,
    site_name: '全国公共资源交易平台',
    site_url: 'http://deal.ggzy.gov.cn',
    list_page_url: 'http://deal.ggzy.gov.cn/ds/deal/dealList.html',
    crawler_type: 'static',
    selector_config: {
      listSelector: '.ewb-list-node',
      titleSelector: '.ewb-list-node-title a',
      linkSelector: '.ewb-list-node-title a',
      dateSelector: '.ewb-list-node-time'
    },
    status: 1
  }
]

const subscriptionStatus = {
  enabled: true,
  tmplIds: ['Ft5i7ufxHlPJm4ISDxKPef6w8Bm4quRcbBbYQukII4s']
}

let userProfile = {
  nickname: '',
  avatar: ''
}

function nextId(list) {
  if (!Array.isArray(list) || list.length === 0) return 1
  return Math.max(...list.map(item => Number(item.id) || 0)) + 1
}

function paginate(list, page = 1, pageSize = 20) {
  const p = Math.max(Number(page) || 1, 1)
  const size = Math.max(Number(pageSize) || 20, 1)
  const start = (p - 1) * size
  const end = start + size
  return {
    data: list.slice(start, end),
    page: p,
    pageSize: size,
    total: list.length
  }
}

async function getNotices({ page = 1, pageSize = 20, keyword } = {}) {
  if (pool) {
    try {
      const p = Math.max(Number(page) || 1, 1)
      const size = Math.max(Number(pageSize) || 20, 1)
      const offset = (p - 1) * size
      const where = []
      const params = []
      if (keyword) {
        const kw = `%${keyword}%`
        where.push('(title LIKE ? OR site_name LIKE ? OR content LIKE ?)')
        params.push(kw, kw, kw)
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const [rows] = await pool.query(
        `SELECT id, title, site_name, source_url, DATE_FORMAT(publish_time, '%Y-%m-%d') as publishDate, content
         FROM notices
         ${whereSql}
         ORDER BY publish_time DESC, id DESC
         LIMIT ? OFFSET ?`,
        [...params, size, offset]
      )
      const [countRows] = await pool.query(
        `SELECT COUNT(*) as total FROM notices ${whereSql}`,
        params
      )
      return {
        data: rows,
        page: p,
        pageSize: size,
        total: countRows?.[0]?.total || 0
      }
    } catch (e) {
      handleDbError('getNotices', e)
    }
  }

  let list = notices
  if (keyword) {
    const kw = String(keyword).trim()
    list = list.filter(
      item =>
        item.title.includes(kw) ||
        item.site_name.includes(kw) ||
        (item.content && item.content.includes(kw))
    )
  }
  return paginate(list, page, pageSize)
}

async function hasNotice(title, sourceUrl) {
  if (pool) {
    try {
      const titleHash = title ? md5(title) : null
      const [rows] = await pool.query(
        `SELECT id FROM notices WHERE source_url = ? OR title_hash = ? LIMIT 1`,
        [sourceUrl || '', titleHash || '']
      )
      return rows.length > 0
    } catch (e) {
      handleDbError('hasNotice', e)
    }
  }
  return notices.some(
    n =>
      (title && n.title === title) ||
      (sourceUrl && n.source_url && n.source_url === sourceUrl)
  )
}

async function getNoticeById(id) {
  if (pool) {
    try {
      const [rows] = await pool.query(
        `SELECT id, title, site_name, source_url, DATE_FORMAT(publish_time, '%Y-%m-%d') as publishDate, content
         FROM notices
         WHERE id = ?
         LIMIT 1`,
        [id]
      )
      return rows?.[0] || null
    } catch (e) {
      handleDbError('getNoticeById', e)
    }
  }
  return notices.find(item => Number(item.id) === Number(id))
}

async function getKeywords() {
  if (pool) {
    try {
      const [rows] = await pool.query(
        `SELECT id, keyword, match_type FROM keywords WHERE status IS NULL OR status = 1 ORDER BY id DESC`
      )
      return rows
    } catch (e) {
      handleDbError('getKeywords', e)
    }
  }
  return keywords
}

async function addKeyword(keyword, matchType = 'contain') {
  if (pool) {
    try {
      const [result] = await pool.query(
        `INSERT INTO keywords (user_id, keyword, match_type, status) VALUES (?, ?, ?, 1)`,
        [0, keyword, matchType || 'contain']
      )
      return {
        id: result.insertId,
        keyword,
        match_type: matchType || 'contain'
      }
    } catch (e) {
      handleDbError('addKeyword', e)
    }
  }
  const id = nextId(keywords)
  const item = { id, keyword, match_type: matchType || 'contain' }
  keywords.push(item)
  return item
}

async function removeKeyword(id) {
  if (pool) {
    try {
      await pool.query(`UPDATE keywords SET status = 0 WHERE id = ?`, [id])
      return { id }
    } catch (e) {
      handleDbError('removeKeyword', e)
    }
  }
  const idx = keywords.findIndex(k => Number(k.id) === Number(id))
  if (idx === -1) return null
  const [removed] = keywords.splice(idx, 1)
  return removed
}

async function getSites() {
  if (pool) {
    try {
      const [rows] = await pool.query(
        `SELECT id, site_name, site_url, list_page_url, crawler_type, selector_config, status
         FROM monitor_sites
         ORDER BY id ASC`
      )
      return rows.map(row => ({
        ...row,
        selector_config: parseSelectorConfig(row.selector_config)
      }))
    } catch (e) {
      handleDbError('getSites', e)
    }
  }
  return sites
}

async function updateSiteStatus(id, status) {
  if (pool) {
    try {
      await pool.query(`UPDATE monitor_sites SET status = ? WHERE id = ?`, [
        status ? 1 : 0,
        id
      ])
      const [rows] = await pool.query(
        `SELECT id, site_name, site_url, list_page_url, crawler_type, selector_config, status
         FROM monitor_sites
         WHERE id = ? LIMIT 1`,
        [id]
      )
      if (!rows.length) return null
      const site = rows[0]
      return {
        ...site,
        selector_config: parseSelectorConfig(site.selector_config)
      }
    } catch (e) {
      handleDbError('updateSiteStatus', e)
    }
  }
  const site = sites.find(s => Number(s.id) === Number(id))
  if (!site) return null
  site.status = status ? 1 : 0
  return site
}

async function getSubscriptionStatus() {
  if (redis) {
    const cached = await redis.get('subscription:status')
    if (cached) {
      try {
        return JSON.parse(cached)
      } catch (_e) {
        return subscriptionStatus
      }
    }
  }
  return subscriptionStatus
}

async function updateSubscriptionStatus({ enabled, tmplIds }) {
  if (typeof enabled !== 'undefined') subscriptionStatus.enabled = !!enabled
  if (Array.isArray(tmplIds) && tmplIds.length) {
    subscriptionStatus.tmplIds = tmplIds.filter(Boolean)
  }
  if (redis) {
    await redis.set('subscription:status', JSON.stringify(subscriptionStatus))
  }
  return subscriptionStatus
}

async function getUserProfile() {
  if (redis) {
    const cached = await redis.get('user:profile:default')
    if (cached) {
      try {
        return JSON.parse(cached)
      } catch (_e) {
        return userProfile
      }
    }
  }
  return userProfile
}

async function updateUserProfile({ nickname, avatar }) {
  userProfile = { nickname: nickname || '', avatar: avatar || '' }
  if (redis) {
    await redis.set('user:profile:default', JSON.stringify(userProfile))
  }
  return userProfile
}

function md5(text) {
  return crypto.createHash('md5').update(text || '').digest('hex')
}

async function addNotice(notice) {
  if (pool) {
    try {
      const titleHash = md5(notice.title)
      const contentHash = md5(notice.content || notice.title || '')
      const now = new Date()
      const publish = notice.publishDate
        ? new Date(notice.publishDate)
        : now
      const [result] = await pool.query(
        `INSERT INTO notices
        (notice_uid, site_id, site_name, title, content, source_url, publish_time, crawl_time, title_hash, content_hash, simhash64, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')
        ON DUPLICATE KEY UPDATE id = id`,
        [
          `${notice.site_id || 0}_${titleHash}`,
          notice.site_id || 0,
          notice.site_name || '',
          notice.title || '',
          notice.content || '',
          notice.source_url || '',
          publish,
          now,
          titleHash,
          contentHash,
          0
        ]
      )
      const insertedId = result.insertId || null
      return {
        id: insertedId,
        title: notice.title,
        site_name: notice.site_name,
        publishDate: notice.publishDate,
        content: notice.content,
        source_url: notice.source_url
      }
    } catch (e) {
      handleDbError('addNotice', e)
    }
  }
  const id = nextId(notices)
  const data = {
    id,
    title: notice.title,
    site_name: notice.site_name,
    publishDate:
      notice.publishDate || new Date().toISOString().slice(0, 10),
    content: notice.content || '',
    source_url: notice.source_url || ''
  }
  notices.unshift(data)
  return data
}

function parseSelectorConfig(cfg) {
  if (!cfg) return null
  if (typeof cfg === 'object') return cfg
  try {
    return JSON.parse(cfg)
  } catch (_e) {
    return null
  }
}

module.exports = {
  getNotices,
  addNotice,
  hasNotice,
  getNoticeById,
  getKeywords,
  addKeyword,
  removeKeyword,
  getSites,
  updateSiteStatus,
  getSubscriptionStatus,
  updateSubscriptionStatus,
  getUserProfile,
  updateUserProfile,
  paginate
}
