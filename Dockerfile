# syntax=docker/dockerfile:1.6
FROM buildpack-deps:jessie

ADD --checksum=sha256:1952d92af83b1bd7ffdb4735999f93a91e0d34ba1315ea1210f16f2e411125e4 https://nodejs.org/dist/v4.3.1/node-v4.3.1-linux-x64.tar.xz /tmp/node.tar.xz
RUN tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
 && rm /tmp/node.tar.xz \
 && node -v && npm -v

WORKDIR /usr/src/app

COPY package.json npm-shrinkwrap.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
