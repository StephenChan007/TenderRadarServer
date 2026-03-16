const { Router } = require('express')
const {
  getSubscriptionStatus,
  updateSubscriptionStatus,
  upsertSubscriber
} = require('../data/store')

const router = Router()

router.get('/status', async (_req, res, next) => {
  try {
    const data = await getSubscriptionStatus()
    res.json({ data })
  } catch (e) {
    next(e)
  }
})

router.post('/status', async (req, res, next) => {
  try {
    const { enabled, tmplIds } = req.body || {}
    const updated = await updateSubscriptionStatus({ enabled, tmplIds })
    res.json({ data: updated })
  } catch (e) {
    next(e)
  }
})

router.post('/consent', async (req, res, next) => {
  try {
    const { tmplIds } = req.body || {}
    // openid 已由 auth 中间件从 session 中注入，无需再次调用 code2Session
    const openid = req.openid
    if (!openid) {
      return res.status(401).json({ message: '未登录，无法获取用户标识' })
    }
    const saved = await upsertSubscriber({ openid, tmplIds })
    res.json({ data: saved })
  } catch (e) {
    next(e)
  }
})

module.exports = router
