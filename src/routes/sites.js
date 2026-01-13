const { Router } = require('express')
const { getSites, updateSiteStatus } = require('../data/store')

const router = Router()

router.get('/', async (_req, res, next) => {
  try {
    const data = await getSites()
    res.json({ data })
  } catch (e) {
    next(e)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const { status } = req.body || {}
    if (typeof status === 'undefined') {
      return res.status(400).json({ message: '缺少状态字段' })
    }

    const site = await updateSiteStatus(req.params.id, status)
    if (!site) return res.status(404).json({ message: '站点不存在' })
    res.json({ data: site })
  } catch (e) {
    next(e)
  }
})

module.exports = router
