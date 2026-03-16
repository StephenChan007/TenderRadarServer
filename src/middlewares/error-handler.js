function notFoundHandler(_req, res, _next) {
  res.status(404).json({ message: '接口不存在' })
}

function errorHandler(err, _req, res, _next) {
  console.error(err)
  if (res.headersSent) return
  const status = err.status || 500
  // 仅客户端错误(4xx)返回具体信息，服务端错误(5xx)返回通用提示，避免泄露内部信息
  const message = status < 500
    ? (err.message || '请求错误')
    : '服务器异常，请稍后重试'
  res.status(status).json({ message })
}

module.exports = {
  notFoundHandler,
  errorHandler
}
