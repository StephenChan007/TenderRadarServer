const { Router } = require('express')
const { getSubscriptionStatus, updateSubscriptionStatus } = require('../data/store')

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

module.exports = router
