const { Router } = require('express')
const { getUserProfile, updateUserProfile } = require('../data/store')

const router = Router()

router.post('/profile', async (req, res, next) => {
  try {
    const { nickname, avatar } = req.body || {}
    const profile = await updateUserProfile({ nickname, avatar })
    res.json({ data: profile })
  } catch (e) {
    next(e)
  }
})

router.get('/profile', async (_req, res, next) => {
  try {
    const data = await getUserProfile()
    res.json({ data })
  } catch (e) {
    next(e)
  }
})

module.exports = router
