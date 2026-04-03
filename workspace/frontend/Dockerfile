FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy application code
COPY . .

# Build
ARG NEXT_PUBLIC_API_URL=http://localhost:8700
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

# Run
EXPOSE 3000
CMD ["npm", "start"]
