# 推荐阅读[如何提高项目构建效率](https://developers.weixin.qq.com/miniprogram/dev/wxcloudrun/src/scene/build/speed.html)
FROM node:20-bullseye-slim

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    CHROMIUM_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json /app/

# npm 源（国内加速）
RUN npm config set registry https://registry.npmmirror.com/

# 系统依赖：Chromium（瘦身版，国内源）
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list \
 && apt-get update \
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
