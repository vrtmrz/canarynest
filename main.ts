const storage_path = Deno.env.get("CN_PATH") || "./storage/";
const authToken = Deno.env.get("CN_AUTH") || "";

function stripFirstSlash(path: string) {
  return path.startsWith("/") ? path.substring(1) : path;
}
function requestURIToStoragePath(requestEvent: Deno.RequestEvent) {
  const url = new URL(requestEvent.request.url);
  const filepath = decodeURIComponent(url.pathname);
  return storage_path + encodeURIComponent(stripFirstSlash(filepath));
}
function relativePath(requestEvent: Deno.RequestEvent) {
  const url = new URL(requestEvent.request.url);
  const filepath = decodeURIComponent(url.pathname);
  return stripFirstSlash(filepath);
}

type requestHandler = (requestEvent: Deno.RequestEvent) => Promise<boolean>;
class HandleRequestError extends Error {
  status = 500;
  constructor(message: string, status?: number) {
    super(message);
    if (status) {
      this.status = status;
    }
  }
}

function addCORSHeader(response: Response, requestEvent: Deno.RequestEvent) {
  const origin = requestEvent.request.headers.get("Origin") || requestEvent.request.headers.get("origin") || "";
  response.headers.set("Access-Control-Allow-Origin", origin);
  return response;
}
/**
 * 
 * @param handler 
 * @returns if handled, return true;
 */
function wrapRequest(handler: requestHandler): requestHandler {
  return async function wrappedRequest(requestEvent: Deno.RequestEvent) {
    try {
      if (await handler(requestEvent)) {
        return true;
      }
      return false;
    } catch (ex) {
      console.dir(ex);
      if (ex instanceof HandleRequestError) {
        const errorResponse = new Response(ex.message, { status: ex.status });
        console.log(ex.message)
        await requestEvent.respondWith(addCORSHeader(errorResponse, requestEvent));
        return true;
      }
      const errorResponse = new Response("Something happened while processing your request!", { status: 500 });
      await requestEvent.respondWith(addCORSHeader(errorResponse, requestEvent));
      return true;
    }
  }
}

async function serveFile(requestEvent: Deno.RequestEvent) {
  if (requestEvent.request.method.toLowerCase() != "get") {
    return false;
  }
  // Try opening the file
  let file;
  try {
    const storagePath = requestURIToStoragePath(requestEvent);
    console.log(`${storagePath}`);
    file = await Deno.open(storagePath, { read: true });
  } catch {
    throw new HandleRequestError("404 not found", 404);
  }

  // Build a readable stream so the file doesn't have to be fully loaded into
  // memory while we send it
  const readableStream = file.readable;

  // Build and send the response
  const response = new Response(readableStream);
  await requestEvent.respondWith(addCORSHeader(response, requestEvent));
  return true;
}
async function putFile(requestEvent: Deno.RequestEvent) {
  if (requestEvent.request.method.toLowerCase() != "put") {
    return false;
  }
  // Try opening the file
  let file;
  try {
    const storagePath = requestURIToStoragePath(requestEvent);
    console.log(`${storagePath}`);
    file = await Deno.open(storagePath, { write: true, create: true });
  } catch {
    throw new HandleRequestError("Could not open file for write", 500);
  }
  const writableStream = file.writable;
  await requestEvent.request.body?.pipeTo(writableStream);
  // file.close();
  const okResponse = new Response("OK", { status: 200 });
  await requestEvent.respondWith(addCORSHeader(okResponse, requestEvent));
  notify(relativePath(requestEvent));
  return true;
}

async function missingHandler(requestEvent: Deno.RequestEvent): Promise<boolean> {
  throw new HandleRequestError("Missing handler", 404);
  // return true;
}

const notifiers = new Set<ReadableStreamDefaultController>();
function notify(path: string) {
  for (const controller of notifiers) {
    try {
      controller.enqueue(new TextEncoder().encode(`event: file\ndata: ${path}\n\n`));
    } catch (ex) {
      console.dir(ex);
    }
  }
}

async function handleSSERequest(requestEvent: Deno.RequestEvent) {
  // const request = requestEvent.request;
  if (relativePath(requestEvent).toLowerCase() != "_watch") {
    return false;
  }
  let timer: number | undefined = undefined;
  let _controller: ReadableStreamDefaultController | undefined = undefined;
  const body = new ReadableStream({
    start(controller) {
      _controller = controller;
      notifiers.add(_controller);
      timer = setInterval(() => {
        try {
          const message = `event: ping\ndata: ${new Date().toISOString()}\n\n`;
          controller.enqueue(new TextEncoder().encode(message));
        } catch (ex) {
          console.dir(ex)
        }
      }, 10000);
    },
    cancel() {
      if (_controller !== undefined) {
        notifiers.delete(_controller)
      }
      if (timer !== undefined) {
        clearInterval(timer);
      }
      console.log("Cancelled!");
    },
  });
  const origin = requestEvent.request.headers.get("Origin") || requestEvent.request.headers.get("origin") || "";
  requestEvent.respondWith(new Response(body, {
    headers: {
      "cache-control": "no-store",
      "content-type": "text/event-stream",
      "x-content-type-options": "nosniff",
      "Access-Control-Allow-Origin": origin,
    },
  })).then(() => {
    console.log("SSE EXIT")
  }).catch(() => {
    console.log("SSE ERROR")
  });
  return true;

}

async function tokenCheck(requestEvent: Deno.RequestEvent): Promise<boolean> {
  const token = requestEvent.request.headers.get("authorization");
  if (`Bearer ${authToken}` != token) {
    const url = new URL(requestEvent.request.url);
    if (url.searchParams.get("q") != authToken) {
      throw new HandleRequestError("Could not authenticate", 403)
    }
  }
  return false;
  // return true;
}

const handlers = [wrapRequest(tokenCheck), wrapRequest(handleSSERequest), wrapRequest(serveFile), wrapRequest(putFile), wrapRequest(missingHandler)]

async function handlerRequest(requestEvent: Deno.RequestEvent) {
  for (const handler of handlers) {
    if (await handler(requestEvent)) return;
  }
}

function writeLog(conn: Deno.Conn, requestEvent: Deno.RequestEvent) {
  const method = requestEvent.request.method;
  const dt = new Date().toISOString();
  const uri = requestEvent.request.url;
  const ip = conn.remoteAddr.transport == "tcp" ? conn.remoteAddr.hostname : "";
  const forwarded = requestEvent.request.headers.get("x-forwarded-for");
  console.log(`ACCESS\t${dt}\t${ip}\t${forwarded}\t${method}\t${uri}`);
}
async function handleHttp(conn: Deno.Conn) {
  const httpConn = Deno.serveHttp(conn);
  for await (const requestEvent of httpConn) {
    writeLog(conn, requestEvent);
    await handlerRequest(requestEvent);
  }
}

// Start listening on port 8080 of localhost.
const server = Deno.listen({ port: 8080 });
console.log("File server running on http://localhost:8080/");

for await (const conn of server) {
  handleHttp(conn).catch(console.error);
}
