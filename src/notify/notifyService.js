const { getSubscribers } = require('../data/store')
const { sendSubscribeMessage } = require('./wechat')

const DEFAULT_TEMPLATE_IDS = String(
  process.env.WEAPP_TEMPLATE_IDS || ''
)
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

function buildTemplateData(notice, matchedKeywords) {
  const keysEnv =
    process.env.WEAPP_TEMPLATE_FIELDS || process.env.WEAPP_TEMPLATE_KEYS || ''
  let customKeys = null
  if (keysEnv) {
    try {
      customKeys = JSON.parse(keysEnv)
    } catch (_e) {
      customKeys = null
    }
  }
  const fields =
    customKeys || {
      thing1: '标题',
      thing2: '来源',
      time1: '时间',
      thing3: '关键词'
    }
  const data = {}
  const title = notice.title || ''
  const site = notice.site_name || notice.siteName || '未知来源'
  const date =
    notice.publishDate ||
    notice.publish_time ||
    notice.publish_date ||
    new Date().toISOString().slice(0, 10)
  const kw =
    matchedKeywords && matchedKeywords.length
      ? matchedKeywords.map(k => k.keyword || '').filter(Boolean).join(',')
      : ''
  Object.keys(fields).forEach(k => {
    if (!fields[k]) return
    let value = ''
    const label = String(fields[k] || '').toLowerCase()
    const keyLower = k.toLowerCase()
    if (keyLower.includes('title') || label.includes('标') || label.includes('标题')) {
      value = title
    } else if (keyLower.includes('site') || label.includes('来源')) {
      value = site
    } else if (keyLower.includes('time') || keyLower.includes('date') || label.includes('时间') || label.includes('日期')) {
      value = date
    } else {
      value = kw || title
    }
    data[k] = { value }
  })
  return data
}

async function notifyMatchedNotice(notice, matchedKeywords) {
  try {
    const subscribers = await getSubscribers()
    if (!Array.isArray(subscribers) || !subscribers.length) return
    const data = buildTemplateData(notice, matchedKeywords)
    const templateIds = notice.templateIds || DEFAULT_TEMPLATE_IDS
    for (const sub of subscribers) {
      const ids = Array.isArray(sub.tmplIds) && sub.tmplIds.length ? sub.tmplIds : templateIds
      for (const tid of ids) {
        const res = await sendSubscribeMessage({
          openid: sub.openid,
          templateId: tid,
          page: notice.page || 'pages/detail/detail?id=' + (notice.id || ''),
          data
        })
        if (!res.ok) {
          console.error('[通知] 发送失败：', res.message || '')
        }
      }
    }
  } catch (e) {
    console.error('[通知] 发送异常：', e.message)
  }
}

module.exports = {
  notifyMatchedNotice
}
