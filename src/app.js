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

function createApp() {
  const app = express()

  app.use(helmet())
  app.use(cors())
  app.use(express.json())
  app.use(morgan('dev'))

  app.use('/health', healthRouter)
  app.use('/api/notices', noticesRouter)
  app.use('/api/keywords', keywordsRouter)
  app.use('/api/sites', sitesRouter)
  app.use('/api/subscription', subscriptionRouter)
  app.use('/api/users', usersRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

module.exports = { createApp }
