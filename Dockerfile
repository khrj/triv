FROM node:alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm config set registry https://registry.npmjs.com/
RUN npm ci

COPY . .

RUN npm run build

EXPOSE 3000

CMD [ "node", "app.js" ]
