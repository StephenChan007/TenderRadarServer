const crypto = require('crypto')
const { code2Session } = require('../notify/wechat')

// 简易 session 存储（生产环境应使用 Redis）
const sessions = new Map()
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000 // 7 天
const MAX_SESSIONS = 10000

function generateToken() {
  return crypto.randomBytes(24).toString('hex')
}

function cleanExpiredSessions() {
  const now = Date.now()
  for (const [token, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL) {
      sessions.delete(token)
    }
  }
}

// 每小时清理过期 session
const sessionCleanupTimer = setInterval(cleanExpiredSessions, 60 * 60 * 1000)

/**
 * 登录接口：用 wx.login code 换取 openid，生成 session token
 */
async function loginHandler(req, res, next) {
  try {
    const { code } = req.body || {}
    if (!code) {
      return res.status(400).json({ message: '缺少登录 code' })
    }
    const session = await code2Session(code)
    const openid = session?.openid
    if (!openid) {
      return res.status(400).json({ message: '登录失败，未获取到 openid' })
    }
    // 防止 session 数量无限增长
    if (sessions.size >= MAX_SESSIONS) {
      cleanExpiredSessions()
      if (sessions.size >= MAX_SESSIONS) {
        return res.status(503).json({ message: '服务繁忙，请稍后重试' })
      }
    }
    const token = generateToken()
    sessions.set(token, {
      openid,
      sessionKey: session.session_key,
      createdAt: Date.now()
    })
    res.json({ data: { token, openid } })
  } catch (e) {
    next(e)
  }
}

/**
 * 鉴权中间件：从 header 读取 token，校验 session
 */
function authMiddleware(req, res, next) {
  const token = req.headers['x-auth-token'] || ''
  if (!token) {
    return res.status(401).json({ message: '未登录' })
  }
  const session = sessions.get(token)
  if (!session || Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(token)
    return res.status(401).json({ message: '登录已过期，请重新登录' })
  }
  req.openid = session.openid
  next()
}

function cleanup() {
  clearInterval(sessionCleanupTimer)
  sessions.clear()
}

module.exports = {
  loginHandler,
  authMiddleware,
  sessions,
  cleanup
}
