const cron = require('node-cron')
const { crawlAllSites } = require('./crawlerService')

function startSchedulerIfEnabled() {
  const enabled = String(process.env.ENABLE_CRAWLER || '').toLowerCase() === 'true'
  if (!enabled) {
    console.log('Crawler scheduler disabled (set ENABLE_CRAWLER=true to enable)')
    return
  }

  const cronExpr = process.env.CRAWL_CRON || '*/30 * * * *'
  try {
    cron.schedule(cronExpr, async () => {
      console.log('[Crawler] Start task', new Date().toISOString())
      await crawlAllSites()
    })
    console.log(`[Crawler] Scheduler started with cron "${cronExpr}"`)
  } catch (e) {
    console.error('[Crawler] Failed to start scheduler:', e.message)
  }
}

module.exports = {
  startSchedulerIfEnabled
}
