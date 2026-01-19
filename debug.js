const { crawlSite } = require('./src/crawler/crawlerService')
const { getSites } = require('./src/data/store')

async function main() {
  const sites = await getSites()
  const active = sites.filter(s => s.status !== 0)
  if (!active.length) throw new Error('未找到站点配置')

  for (const site of active) {
    console.log(`开始抓取：${site.site_name} (${site.crawler_type})`)
    await crawlSite(site)
  }
  console.log('所有站点抓取完成')
}

main().catch(err => {
  console.error('执行出错：', err)
  process.exit(1)
})
