const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const morgan = require('morgan')

const healthRouter = require('./routes/health')
const noticesRouter = require('./routes/notices')
const keywordsRouter = require('./routes/keywords')
const sitesRouter = require('./routes/sites')
const subscriptionRouter = require('./routes/subscription')
const usersRouter = require('./routes/users')
const { errorHandler, notFoundHandler } = require('./middlewares/error-handler')
const { loginHandler, authMiddleware } = require('./middlewares/auth')

function createApp() {
  const app = express()

  app.use(helmet())
  app.use(cors())
  app.use(express.json({ limit: '100kb' }))
  app.use(morgan('dev'))

  // 公开接口
  app.use('/health', healthRouter)
  app.post('/api/login', loginHandler)

  // 需要鉴权的接口
  app.use('/api/notices', authMiddleware, noticesRouter)
  app.use('/api/keywords', authMiddleware, keywordsRouter)
  app.use('/api/sites', authMiddleware, sitesRouter)
  app.use('/api/subscription', authMiddleware, subscriptionRouter)
  app.use('/api/users', authMiddleware, usersRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

module.exports = { createApp }
