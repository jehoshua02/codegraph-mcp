FROM node:20
WORKDIR /tool
COPY package.json ./
RUN npm install
COPY src/ src/
COPY test/ test/
ENTRYPOINT ["node"]
