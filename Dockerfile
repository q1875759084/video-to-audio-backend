# ==================== 第一阶段：构建 ====================
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ==================== 第二阶段：运行 ====================
# 基础镜像：node:20-alpine + ffmpeg + yt-dlp
FROM node:20-alpine AS runner

WORKDIR /app

# 安装系统依赖：ffmpeg（转码）+ python3/pip（yt-dlp 依赖）
RUN apk add --no-cache ffmpeg python3 py3-pip \
  && pip3 install --break-system-packages yt-dlp \
  # 验证安装成功
  && ffmpeg -version | head -1 \
  && yt-dlp --version

# 只安装生产依赖
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 从构建阶段复制编译产物
COPY --from=builder /app/dist ./dist

# 持久化目录：音频文件存储
# 容器内路径：/app/files，由 Docker Volume 挂载
VOLUME ["/app/files"]

# 临时文件目录：yt-dlp 下载 + 分片上传暂存
# 无需持久化，容器内 /tmp/vta 即可
RUN mkdir -p /tmp/vta/uploads

EXPOSE 3000

CMD ["node", "dist/app.js"]
