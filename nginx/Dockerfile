FROM node:20-alpine AS frontend_builder

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
ARG VITE_API_URL=""
ARG VITE_WS_URL=""
ARG VITE_FALLBACK_URLS=""
ENV VITE_API_URL=$VITE_API_URL \
    VITE_WS_URL=$VITE_WS_URL \
    VITE_FALLBACK_URLS=$VITE_FALLBACK_URLS

RUN npm run build

FROM nginx:alpine
COPY --from=frontend_builder /frontend/dist /usr/share/nginx/html
EXPOSE 80 443

