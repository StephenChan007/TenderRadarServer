# 推荐阅读[如何提高项目构建效率](https://developers.weixin.qq.com/miniprogram/dev/wxcloudrun/src/scene/build/speed.html)
FROM node:20-bullseye-slim

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    CHROMIUM_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json /app/

# npm 源，可按需替换为国内源
RUN npm config set registry https://registry.npmjs.org/

# 系统依赖与 Chromium（瘦身版，无建议依赖）
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

# 仅安装生产依赖
RUN npm ci --omit=dev \
 && rm -rf /root/.npm/_cacache

COPY . /app

CMD ["npm", "run", "start:auto"]
