FROM lukechannings/deno:v1.36.3
WORKDIR /app
ADD .
deno cache main.ts
deno run -A main.ts