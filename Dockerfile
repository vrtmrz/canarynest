FROM lukechannings/deno:v1.36.3
RUN apt-get update && apt-get install -y procps tini
ENTRYPOINT ["/usr/bin/tini", "--"]
WORKDIR /app
COPY . /app/
RUN deno cache main.ts
EXPOSE 8080
CMD ["/bin/deno","run","-A","main.ts"]