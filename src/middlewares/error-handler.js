function notFoundHandler(_req, res, _next) {
  res.status(404).json({ message: '接口不存在' })
}

function errorHandler(err, _req, res, _next) {
  console.error(err)
  if (res.headersSent) return
  const status = err.status || 500
  const message = err.message || '服务器异常'
  res.status(status).json({ message })
}

module.exports = {
  notFoundHandler,
  errorHandler
}
