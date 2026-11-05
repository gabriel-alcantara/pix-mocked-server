FROM node:20 AS base
RUN npm i -g @nestjs/cli 

FROM base AS init
WORKDIR /app
COPY package.json .
RUN npm i

FROM init AS build
COPY tsconfig.build.json .
COPY tsconfig.json .
COPY nest-cli.json .
COPY jest.config.ts .
COPY src/ ./src/
RUN npm run build

FROM node:20.16.0-alpine AS final
WORKDIR /app
COPY --from=init /app/node_modules/ ./node_modules/
COPY --from=build /app/dist/ .
EXPOSE 3000 3001
ENTRYPOINT ["node", "src/main.js"]
