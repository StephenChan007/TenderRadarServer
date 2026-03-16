const { createApp } = require('./src/app')
const { startSchedulerIfEnabled } = require('./src/crawler/scheduler')
const { cleanup: cleanupStore } = require('./src/data/store')
const { cleanup: cleanupAuth } = require('./src/middlewares/auth')

const app = createApp()
const PORT = process.env.PORT || 80

const server = app.listen(PORT, () => {
  console.log(`TenderRadar backend listening on http://localhost:${PORT}`)
})

startSchedulerIfEnabled()

// 优雅停机
function gracefulShutdown(signal) {
  console.log(`\n[Shutdown] Received ${signal}, closing gracefully...`)
  server.close(async () => {
    console.log('[Shutdown] HTTP server closed')
    try {
      cleanupAuth()
      await cleanupStore()
      console.log('[Shutdown] Resources cleaned up')
    } catch (e) {
      console.error('[Shutdown] Cleanup error:', e.message)
    }
    process.exit(0)
  })
  // 如果 10 秒内未能关闭，强制退出
  setTimeout(() => {
    console.error('[Shutdown] Forced exit after timeout')
    process.exit(1)
  }, 10000)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))
