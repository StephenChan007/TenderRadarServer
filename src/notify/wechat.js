const axios = require('axios')

const APP_ID =
  process.env.WEAPP_APPID ||
  process.env.WX_APPID ||
  process.env.MINIAPP_APPID ||
  ''
const APP_SECRET =
  process.env.WEAPP_SECRET ||
  process.env.WX_SECRET ||
  process.env.MINIAPP_SECRET ||
  ''

let cachedToken = {
  accessToken: null,
  expiresAt: 0
}

async function getAccessToken() {
  const now = Date.now()
  if (cachedToken.accessToken && cachedToken.expiresAt - now > 60 * 1000) {
    return cachedToken.accessToken
  }
  if (!APP_ID || !APP_SECRET) {
    throw new Error('缺少小程序 AppID 或 Secret')
  }
  const url = 'https://api.weixin.qq.com/cgi-bin/token'
  const res = await axios.get(url, {
    params: {
      grant_type: 'client_credential',
      appid: APP_ID,
      secret: APP_SECRET
    },
    timeout: 10000
  })
  const data = res.data || {}
  if (data.errcode) {
    throw new Error(`获取 access_token 失败：${data.errmsg || data.errcode}`)
  }
  cachedToken = {
    accessToken: data.access_token,
    expiresAt: now + (data.expires_in || 7000) * 1000
  }
  return cachedToken.accessToken
}

async function code2Session(code) {
  if (!APP_ID || !APP_SECRET) {
    throw new Error('缺少小程序 AppID 或 Secret')
  }
  if (!code) throw new Error('缺少登录 code')
  const url = 'https://api.weixin.qq.com/sns/jscode2session'
  const res = await axios.get(url, {
    params: {
      grant_type: 'authorization_code',
      appid: APP_ID,
      secret: APP_SECRET,
      js_code: code
    },
    timeout: 10000
  })
  const data = res.data || {}
  if (data.errcode) {
    throw new Error(`code2session 失败：${data.errmsg || data.errcode}`)
  }
  return data
}

async function sendSubscribeMessage({ openid, templateId, page, data }) {
  if (!openid || !templateId) return { ok: false, message: '缺少openid或模板ID' }
  const accessToken = await getAccessToken()
  const url = `https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=${accessToken}`
  const res = await axios.post(
    url,
    {
      touser: openid,
      template_id: templateId,
      page: page || 'pages/index/index',
      data
    },
    { timeout: 10000 }
  )
  const payload = res.data || {}
  if (payload.errcode === 0) return { ok: true }
  return {
    ok: false,
    message: payload.errmsg || payload.errcode || '发送失败'
  }
}

module.exports = {
  code2Session,
  getAccessToken,
  sendSubscribeMessage
}
