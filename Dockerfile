# Image
FROM node:16.10.0-alpine

# Set up work directory
WORKDIR /var/www/frontend/

# Configure host
ENV HOST 0.0.0.0

# Init command
CMD ["sh", "-c", "yarn install && yarn build && yarn start"]
# CMD ["sh", "-c", "yarn install && yarn dev"]