const { Router } = require('express')
const {
  getSubscriptionStatus,
  updateSubscriptionStatus,
  upsertSubscriber
} = require('../data/store')
const { code2Session } = require('../notify/wechat')

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
    const { code, tmplIds } = req.body || {}
    if (!code) {
      return res.status(400).json({ message: '缺少登录code' })
    }
    const session = await code2Session(code)
    const openid = session?.openid
    if (!openid) {
      return res.status(400).json({ message: '未获取到openid' })
    }
    const saved = await upsertSubscriber({ openid, tmplIds })
    res.json({ data: saved })
  } catch (e) {
    next(e)
  }
})

module.exports = router
