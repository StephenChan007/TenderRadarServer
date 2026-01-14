const { Router } = require('express')
const { getSites, updateSiteStatus, addSite } = require('../data/store')

const router = Router()

router.get('/', async (_req, res, next) => {
  try {
    const data = await getSites()
    res.json({ data })
  } catch (e) {
    next(e)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const {
      site_name,
      site_url,
      list_page_url,
      crawler_type,
      selector_config,
      status
    } = req.body || {}

    if (!site_name || !list_page_url) {
      return res
        .status(400)
        .json({ message: '缺少必要参数 site_name 或 list_page_url' })
    }

    const created = await addSite({
      site_name,
      site_url,
      list_page_url,
      crawler_type,
      selector_config,
      status
    })
    res.status(201).json({ data: created })
  } catch (e) {
    next(e)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const { status } = req.body || {}
    if (typeof status === 'undefined') {
      return res.status(400).json({ message: '缺少状态字段 status' })
    }

    const site = await updateSiteStatus(req.params.id, status)
    if (!site) return res.status(404).json({ message: '站点不存在' })
    res.json({ data: site })
  } catch (e) {
    next(e)
  }
})

module.exports = router
