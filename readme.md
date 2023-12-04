# Canary Nest

Canary Nest; The server that delivers canaries to [Canary Perch](https://github.com/vrtmrz/canaryperch) on our Obsidian.

## How to prepare

Launch this server anywhere you like.

```bash
$ fly launch --auto-confirm --generate-name --detach --no-deploy --region nrt
$ fly secrets set CN_AUTH=das9u3rFAHU
$ fly deploy
```

## How to use

### Configure Canary Perch

1. Set the `Canary nest URL` to the endpoint of our server.
   This should be `https://example.fly.io/_watch?q=das9u3rFAHU`.

2. Set the `Interesting paths` as you want to receive updates. This is a regular expression. If you want to test TagFolder (very honourable for me), you should set this `^plugins/obsidian-tagfolder`.

3. The `Auto restart plugin` is as you like. If enabled, the plugin (TagFolder) will be restarted when the file has arrived.

### Configure your development environment

You can send the file with a simple HTTP REST API.

```
$ curl --upload-file main.js https://example.fly.io/plugins/obsidian-tagfolder/main.js?q=das9u3rFAHU
$ curl --upload-file styles.css https://example.fly.io/plugins/obsidian-tagfolder/styles.css?q=das9u3rFAHU
$ curl --upload-file manifest.json https://example.fly.io/plugins/obsidian-tagfolder/ manifest.json?q=das9u3rFAHU
```

Alternatively, you can write a small plugin to automate the process in esbuild.

You can see the real example on [esbuild.config.mjs in canaryperch]()
```javascript
/** @type esbuild.Plugin */
const sendToCanaryNest = {
  name: "send-to-canary-nest",
  setup(build) {
    build.onEnd(async (result) => {
      if (nestURL) {
        console.log("Sending for canary nest..");
        try {
          await Promise.all(
            ["main.js", "styles.css", "manifest.json"].map(
              async (e) =>
                await await fetch(`${nestURL}/${e}?q=${nestToken}`, {
                  method: "PUT",
                  body: await readFile(e),
                })
            )
          );
        } catch (ex) {
          console.error(ex);
        }
        console.log("Sending done!");
      }
    });
  },
};
```
