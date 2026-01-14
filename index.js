const { createApp } = require('./src/app')
const { startSchedulerIfEnabled } = require('./src/crawler/scheduler')

const app = createApp()
const PORT = process.env.PORT || 80

app.listen(PORT, () => {
  console.log(`TenderRadar backend listening on http://localhost:${PORT}`)
})

startSchedulerIfEnabled()
