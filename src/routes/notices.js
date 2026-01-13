const { Router } = require('express')
const { getNotices, getNoticeById } = require('../data/store')

const router = Router()

router.get('/', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 20, keyword } = req.query
    const result = await getNotices({ page, pageSize, keyword })
    res.json(result)
  } catch (e) {
    next(e)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const id = req.params.id
    const item = await getNoticeById(id)
    if (!item) return res.status(404).json({ message: '公告不存在' })
    res.json({ data: item })
  } catch (e) {
    next(e)
  }
})

module.exports = router
