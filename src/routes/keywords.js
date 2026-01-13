const { Router } = require('express')
const { getKeywords, addKeyword, removeKeyword } = require('../data/store')

const router = Router()

router.get('/', async (_req, res, next) => {
  try {
    const items = await getKeywords()
    res.json({ data: items })
  } catch (e) {
    next(e)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const { keyword, matchType, match_type } = req.body || {}
    if (!keyword || !String(keyword).trim()) {
      return res.status(400).json({ message: '缺少关键字' })
    }

    const item = await addKeyword(
      String(keyword).trim(),
      matchType || match_type
    )
    res.status(201).json({ data: item })
  } catch (e) {
    next(e)
  }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await removeKeyword(req.params.id)
    if (!deleted) return res.status(404).json({ message: '关键字不存在' })
    res.json({ ok: true })
  } catch (e) {
    next(e)
  }
})

module.exports = router
